import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Database } from "./db.js";
import { getLaneById, updateLane, insertEvent, insertAudit } from "./db.js";
import type { Lane } from "@harness/types";

export interface LaunchOptions {
  credentialsFile: string;
  claudeJsonFile: string;
  pluginDir?: string;
  containerName?: string;
  maxBudgetUsd?: number;
  timeoutMinutes?: number;
}

export interface LaneSession {
  laneId: number;
  slug: string;
  sessionId?: string;
  process?: ChildProcess;
  ndjsonPath: string;
  statePath: string;
}

const activeSessions = new Map<number, LaneSession>();

export function getActiveSession(laneId: number): LaneSession | undefined {
  return activeSessions.get(laneId);
}

export function getAllActiveSessions(): LaneSession[] {
  return Array.from(activeSessions.values());
}

export function buildLaunchPrompt(lane: Lane): string {
  const criteria = lane.criteria?.length ? lane.criteria : lane.tags;
  const criteriaStr = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `Use the feature-workflow skill to deliver this task.
Title: ${lane.title}
Criteria:
${criteriaStr}
Report each stage via \`harness-report\`. Do NOT push to main; stop at watch PR.`;
}

export function launchLane(
  rootDir: string,
  lane: Lane,
  db: Database,
  opts: LaunchOptions,
): LaneSession {
  const laneDir = join(resolve(rootDir, "lanes"), lane.slug);
  const harnessDir = join(laneDir, ".harness");
  const logsDir = join(harnessDir, "logs");
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

  const ndjsonPath = join(logsDir, "agent.ndjson");
  const statePath = join(harnessDir, "state.json");

  const prompt = buildLaunchPrompt(lane);

  const claudeArgs = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (opts.pluginDir) claudeArgs.push("--plugin-dir", opts.pluginDir);
  if (opts.maxBudgetUsd) claudeArgs.push("--max-budget-usd", String(opts.maxBudgetUsd));

  const timeoutMs = (opts.timeoutMinutes ?? 480) * 60_000;

  const child = opts.containerName
    ? spawn("docker", ["exec", "-u", "lane", opts.containerName, "claude", ...claudeArgs], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        timeout: timeoutMs,
      })
    : spawn("claude", claudeArgs, {
        cwd: laneDir,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        timeout: timeoutMs,
        env: {
          ...process.env,
          HARNESS_PORT: process.env.HARNESS_PORT ?? "8090",
        },
      });

  const session: LaneSession = {
    laneId: lane.id,
    slug: lane.slug,
    ndjsonPath,
    statePath,
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const data = chunk.toString();
    try {
      writeFileSync(ndjsonPath, data, { flag: "a" });
    } catch {}

    for (const line of data.split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "system" && obj.session_id) {
          session.sessionId = obj.session_id;
        }
        if (obj.type === "result") {
          session.sessionId = obj.session_id;
        }
      } catch {}
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const errLog = join(logsDir, "agent.stderr.log");
    try { writeFileSync(errLog, chunk.toString(), { flag: "a" }); } catch {}
  });

  child.on("close", (code) => {
    insertAudit(db, "info", `Lane ${lane.slug} agent exited with code ${code}`, lane.id);
    insertEvent(db, lane.id, "action", {
      action: "agent_exit",
      exitCode: code,
      sessionId: session.sessionId,
    });
    activeSessions.delete(lane.id);
  });

  session.process = child;
  activeSessions.set(lane.id, session);

  insertAudit(db, "info", `Launched agent for lane ${lane.slug}`, lane.id);
  insertEvent(db, lane.id, "action", { action: "agent_launch" });

  return session;
}

export function resumeLane(
  rootDir: string,
  lane: Lane,
  db: Database,
  opts: LaunchOptions,
  instruction?: string,
): LaneSession | null {
  const session = activeSessions.get(lane.id);
  if (!session?.sessionId) return null;

  const laneDir = join(resolve(rootDir, "lanes"), lane.slug);
  const logsDir = join(laneDir, ".harness", "logs");

  const prompt = instruction ?? "Continue from where you left off.";
  const claudeArgs = [
    "-p", prompt,
    "--resume", session.sessionId,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];

  const timeoutMs = (opts.timeoutMinutes ?? 480) * 60_000;

  const child = opts.containerName
    ? spawn("docker", ["exec", "-u", "lane", opts.containerName, "claude", ...claudeArgs], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        timeout: timeoutMs,
      })
    : spawn("claude", claudeArgs, {
        cwd: laneDir,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        timeout: timeoutMs,
      });

  child.stdout.on("data", (chunk: Buffer) => {
    try {
      writeFileSync(session.ndjsonPath, chunk.toString(), { flag: "a" });
    } catch {}
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const errLog = join(logsDir, "agent.stderr.log");
    try { writeFileSync(errLog, chunk.toString(), { flag: "a" }); } catch {}
  });

  child.on("close", (code) => {
    insertAudit(db, "info", `Lane ${lane.slug} resumed agent exited with code ${code}`, lane.id);
    activeSessions.delete(lane.id);
  });

  session.process = child;
  activeSessions.set(lane.id, session);

  insertAudit(db, "info", `Resumed agent for lane ${lane.slug} (session=${session.sessionId})`, lane.id);
  return session;
}

