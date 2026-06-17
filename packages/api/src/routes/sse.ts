import type { FastifyInstance } from "fastify";
import type { EventBus } from "../event-bus.js";
import type { SSEEvent } from "@harness/types";

export async function sseRoutes(app: FastifyInstance, bus: EventBus): Promise<void> {
  app.get("/api/events/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const handler = (event: SSEEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    bus.on("sse", handler);

    request.raw.on("close", () => {
      bus.off("sse", handler);
    });
  });
}
