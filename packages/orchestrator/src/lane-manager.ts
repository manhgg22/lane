import { execSync, exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { get } from "node:http";
import { resolve, join } from "node:path";
import type { Database } from "./db.js";
import { insertLane, updateLane, getLaneById, getAllLanes } from "./db.js";
import type { Lane, LaneConfig, HarnessConfig } from "./types.js";

const LANES_DIR = "lanes";

function lanesDir(rootDir: string): string {
  const dir = resolve(rootDir, LANES_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function laneDir(rootDir: string, slug: string): string {
  return join(lanesDir(rootDir), slug);
}

export function cloneLane(
  rootDir: string,
  targetRepo: string,
  slug: string,
  integrationBranch: string,
): string {
  const dest = laneDir(rootDir, slug);
  if (existsSync(dest)) {
    console.log(`Lane dir already exists: ${dest}`);
    return dest;
  }

  const repoPath = resolve(rootDir, targetRepo);
  execSync(`git clone --no-hardlinks "${repoPath}" "${dest}"`, {
    stdio: "pipe",
  });

  try {
    execSync(`git -C "${dest}" checkout -b feat/${slug} ${integrationBranch}`, {
      stdio: "pipe",
    });
  } catch {
    execSync(`git -C "${dest}" checkout -b feat/${slug}`, { stdio: "pipe" });
  }

  return dest;
}

export function removeLaneDir(rootDir: string, slug: string): void {
  const dest = laneDir(rootDir, slug);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
}

export function allocatePort(basePort: number, db: Database): number {
  const lanes = getAllLanes(db);
  const usedPorts = new Set(lanes.map((l) => l.port));
  let port = basePort;
  while (usedPorts.has(port)) port++;
  return port;
}

export function renderDockerCompose(
  laneDir: string,
  slug: string,
  port: number,
  dbUrl: string,
): string {
  const content = `services:
  ${slug}:
    build: .
    container_name: harness-${slug}
    ports:
      - "${port}:${port}"
    environment:
      - PORT=${port}
      - DATABASE_URL=${dbUrl}
      - NODE_ENV=development
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "const h=require('http');h.get('http://localhost:${port}/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
`;
  const composePath = join(laneDir, "docker-compose.lane.yml");
  writeFileSync(composePath, content, "utf-8");
  return composePath;
}

export async function dockerUp(
  laneDir: string,
  slug: string,
  port: number,
  timeoutMs: number = 60000,
): Promise<void> {
  const composePath = join(laneDir, "docker-compose.lane.yml");
  execSync(`docker compose -f "${composePath}" up -d --build`, {
    stdio: "pipe",
    cwd: laneDir,
    timeout: 120000,
  });

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = get(`http://localhost:${port}/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Health check failed for lane ${slug} on port ${port} after ${timeoutMs}ms`);
}

export function dockerDown(laneDir: string): void {
  const composePath = join(laneDir, "docker-compose.lane.yml");
  if (existsSync(composePath)) {
    try {
      execSync(`docker compose -f "${composePath}" down -v --remove-orphans`, {
        stdio: "pipe",
        cwd: laneDir,
        timeout: 30000,
      });
    } catch (err) {
      console.error(`Failed to docker down in ${laneDir}:`, err);
    }
  }
}

export function getRunningHarnessContainers(): string[] {
  try {
    const output = execSync(
      'docker ps --filter "name=harness-" --format "{{.Names}}"',
      { encoding: "utf-8", stdio: "pipe" },
    );
    return output
      .trim()
      .split("\n")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export function reconcileOnBoot(rootDir: string, db: Database): void {
  const containers = getRunningHarnessContainers();
  const lanes = getAllLanes(db);
  const laneSlugs = new Set(lanes.map((l) => l.slug));

  for (const container of containers) {
    const slug = container.replace("harness-", "");
    if (!laneSlugs.has(slug)) {
      console.log(`Orphan container found: ${container}. Stopping...`);
      try {
        execSync(`docker rm -f ${container}`, { stdio: "pipe" });
      } catch {
        console.error(`Failed to remove orphan container: ${container}`);
      }
    }
  }
}

export async function createFullLane(
  rootDir: string,
  config: HarnessConfig,
  laneConfig: LaneConfig,
  db: Database,
): Promise<Lane> {
  const port = allocatePort(config.basePort, db);
  const dbUrl = `./data/app.db`;
  const branch = `feat/${laneConfig.slug}`;

  const dir = cloneLane(
    rootDir,
    config.targetRepo,
    laneConfig.slug,
    config.integrationBranch,
  );

  renderDockerCompose(dir, laneConfig.slug, port, dbUrl);

  const lane = insertLane(db, {
    title: laneConfig.title,
    slug: laneConfig.slug,
    branch,
    port,
    tags: laneConfig.tags,
    mode: "implement",
    dbUrl,
  });

  return lane;
}

export async function upLane(
  rootDir: string,
  lane: Lane,
): Promise<void> {
  const dir = laneDir(rootDir, lane.slug);
  await dockerUp(dir, lane.slug, lane.port);
}

export async function downLane(
  rootDir: string,
  lane: Lane,
): Promise<void> {
  const dir = laneDir(rootDir, lane.slug);
  dockerDown(dir);
}
