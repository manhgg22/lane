import Fastify from "fastify";
import cors from "@fastify/cors";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seedDemoData, loadConfig, reconcileOnBoot } from "@harness/orchestrator";
import { eventBus } from "./event-bus.js";
import { healthRoutes } from "./routes/health.js";
import { laneRoutes } from "./routes/lanes.js";
import { actionRoutes } from "./routes/actions.js";
import { stageRoutes } from "./routes/stage-routes.js";
import { sseRoutes } from "./routes/sse.js";
import { schedulerRoutes } from "./routes/scheduler.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { lockApiRoutes } from "./routes/lock-api.js";
import { laneSignalRoutes } from "./routes/lane-signal.js";
import { agentControlRoutes } from "./routes/agent-control.js";
import { stopScheduler } from "@harness/orchestrator/scheduler";
import { releaseAllLocks, getAllLanes, saveDb } from "@harness/orchestrator";

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

await app.register(cors, { origin: ["http://localhost:3100"] });

await healthRoutes(app);
await laneRoutes(app, db);
await actionRoutes(app, db, config, ROOT_DIR, eventBus);
await stageRoutes(app, db, eventBus);
await sseRoutes(app, eventBus);
await schedulerRoutes(app, db, config, eventBus);
await monitoringRoutes(app, db);
await lockApiRoutes(app, db);
await laneSignalRoutes(app, db, eventBus);
await agentControlRoutes(app, db, config, ROOT_DIR, eventBus);

try {
  await app.listen({ port: HARNESS_PORT, host: "0.0.0.0" });
  console.log(`Harness API running on http://localhost:${HARNESS_PORT}`);
  async function gracefulShutdown(signal: string) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    stopScheduler();

    const lanes = getAllLanes(db);
    for (const lane of lanes) {
      releaseAllLocks(db, lane.id);
    }

    saveDb(db);

    await app.close();
    console.log("Server closed.");
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
