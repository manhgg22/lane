import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seedDemoData, loadConfig, reconcileOnBoot } from "@harness/orchestrator";
import { healthRoutes } from "./routes/health.js";
import { laneRoutes } from "./routes/lanes.js";
import { actionRoutes } from "./routes/actions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../../..");
const HARNESS_PORT = parseInt(process.env.HARNESS_PORT ?? "8090", 10);
const DB_PATH = process.env.DATABASE_PATH ?? resolve(ROOT_DIR, ".harness/db/harness.db");
const CONFIG_PATH = process.env.CONFIG_PATH ?? resolve(ROOT_DIR, "lanes.yaml");

const db = await openDb(DB_PATH);
seedDemoData(db);

const config = loadConfig(CONFIG_PATH);
console.log(`Loaded config: ${config.lanes.length} lane definitions, targetRepo=${config.targetRepo}`);

reconcileOnBoot(ROOT_DIR, db);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const webDir = resolve(__dirname, "../../web/public");
await app.register(fastifyStatic, {
  root: webDir,
  prefix: "/",
});

await healthRoutes(app);
await laneRoutes(app, db);
await actionRoutes(app, db, config, ROOT_DIR);

try {
  await app.listen({ port: HARNESS_PORT, host: "0.0.0.0" });
  console.log(`Harness API running on http://localhost:${HARNESS_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
