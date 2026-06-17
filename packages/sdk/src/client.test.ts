import { describe, it, expect, vi, beforeEach } from "vitest";
import { HarnessClient } from "./client";

const BASE = "http://localhost:8090";

describe("HarnessClient", () => {
  let client: HarnessClient;

  beforeEach(() => {
    client = new HarnessClient(BASE);
    vi.restoreAllMocks();
  });

  it("getLanes fetches from /api/lanes", async () => {
    const mockLanes = [{ id: 1, title: "Lane 1" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockLanes), { status: 200 }),
    );

    const result = await client.getLanes();
    expect(result).toEqual(mockLanes);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes`,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  it("createLane POSTs to /api/lanes", async () => {
    const mockLane = { id: 2, title: "New Lane" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, lane: mockLane }), { status: 200 }),
    );

    const result = await client.createLane({ title: "New Lane", slug: "new-lane" });
    expect(result).toEqual(mockLane);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New Lane", slug: "new-lane" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );

    await expect(client.getLane(999)).rejects.toThrow("not found");
  });

  it("advanceStage POSTs to /api/lanes/:id/advance", async () => {
    const mockLane = { id: 1, stageIndex: 2 };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, lane: mockLane }), { status: 200 }),
    );

    const result = await client.advanceStage(1);
    expect(result).toEqual(mockLane);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/lanes/1/advance`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("tick POSTs to /api/scheduler/tick", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, processed: 2, results: [] }), { status: 200 }),
    );

    const result = await client.tick();
    expect(result).toEqual({ processed: 2, results: [] });
  });
});
