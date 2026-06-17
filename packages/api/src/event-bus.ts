import { EventEmitter } from "node:events";
import type { SSEEvent } from "@harness/types";

class EventBus extends EventEmitter {
  broadcast(event: SSEEvent): void {
    this.emit("sse", event);
  }
}

export const eventBus = new EventBus();
export type { EventBus };
