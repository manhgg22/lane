import type { SSEEvent } from "@harness/types";

export function createSSEConnection(
  url: string,
  handler: (event: SSEEvent) => void,
): () => void {
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    try {
      handler(JSON.parse(msg.data) as SSEEvent);
    } catch {
      // ignore malformed
    }
  };
  return () => es.close();
}
