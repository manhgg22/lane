import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seedDemoData } from "@harness/orchestrator";
import { healthRoutes } from "./routes/health.js";
import { laneRoutes } from "./routes/lanes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_PORT = parseInt(process.env.HARNESS_PORT ?? "8090", 10);
const DB_PATH = process.env.DATABASE_PATH ?? resolve(__dirname, "../../../.harness/db/harness.db");

const db = await openDb(DB_PATH);
seedDemoData(db);

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const webDir = resolve(__dirname, "../../web/public");
await app.register(fastifyStatic, {
  root: webDir,
  prefix: "/",
});

await healthRoutes(app);
await laneRoutes(app, db);

try {
  await app.listen({ port: HARNESS_PORT, host: "0.0.0.0" });
  console.log(`Harness API running on http://localhost:${HARNESS_PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
