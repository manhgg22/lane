import type {
  Lane,
  StageRun,
  LaneEvent,
  CreateLaneRequest,
  LockInfo,
  SchedulerResult,
  SSEEvent,
} from "@harness/types";

export class HarnessClient {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async getLanes(): Promise<Lane[]> {
    return this.request<Lane[]>("/api/lanes");
  }

  async getLane(id: number): Promise<Lane & { stageRuns: StageRun[] }> {
    return this.request<Lane & { stageRuns: StageRun[] }>(`/api/lanes/${id}`);
  }

  async getEvents(id: number, after?: number): Promise<LaneEvent[]> {
    const qs = after != null ? `?after=${after}` : "";
    return this.request<LaneEvent[]>(`/api/lanes/${id}/events${qs}`);
  }

  async getLock(id: number): Promise<LockInfo> {
    return this.request<LockInfo>(`/api/lanes/${id}/lock`);
  }

  async createLane(opts: CreateLaneRequest): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>("/api/lanes", {
      method: "POST",
      body: JSON.stringify(opts),
    });
    return res.lane;
  }

  async upLane(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/up`, {
      method: "POST",
    });
    return res.lane;
  }

  async downLane(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/down`, {
      method: "POST",
    });
    return res.lane;
  }

  async passStage(id: number, evidence: string[] = []): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/pass`, {
      method: "POST",
      body: JSON.stringify({ evidence }),
    });
    return res.lane;
  }

  async advanceStage(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/advance`, {
      method: "POST",
    });
    return res.lane;
  }

  async blockStage(id: number, reason: string): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/block`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return res.lane;
  }

  async reenterStage(id: number): Promise<Lane> {
    const res = await this.request<{ ok: true; lane: Lane }>(`/api/lanes/${id}/reenter`, {
      method: "POST",
    });
    return res.lane;
  }

  async tick(): Promise<SchedulerResult> {
    const res = await this.request<{ ok: true; processed: number; results: SchedulerResult["results"] }>(
      "/api/scheduler/tick",
      { method: "POST" },
    );
    return { processed: res.processed, results: res.results };
  }

  async startScheduler(): Promise<void> {
    await this.request("/api/scheduler/start", { method: "POST" });
  }

  async stopScheduler(): Promise<void> {
    await this.request("/api/scheduler/stop", { method: "POST" });
  }

  async getSchedulerStatus(): Promise<{
    running: boolean;
    intervalMs: number;
    lastTickAt: string | null;
    totalTicks: number;
  }> {
    return this.request("/api/scheduler/status");
  }

  subscribe(handler: (event: SSEEvent) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/api/events/stream`);
    es.onmessage = (msg) => {
      try {
        handler(JSON.parse(msg.data) as SSEEvent);
      } catch {
        // ignore malformed messages
      }
    };
    return () => es.close();
  }
}
