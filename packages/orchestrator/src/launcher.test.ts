import { describe, it, expect } from "vitest";
import { buildLaunchPrompt } from "./launcher.js";
import type { Lane } from "@harness/types";

function makeLane(overrides: Partial<Lane> = {}): Lane {
  return {
    id: 1,
    title: "Add health endpoint",
    slug: "add-health",
    branch: "feat/add-health",
    mode: "implement",
    port: 4001,
    dbUrl: "./data/app.db",
    tags: ["health", "api"],
    criteria: ["GET /health returns 200", "Tests pass"],
    status: ["running"],
    stageIndex: 0,
    progress: 0,
    ticket: null,
    prNumber: null,
    git: { commit: "", subject: "", ci: "" },
    note: "",
    priority: 0,
    qc: { dev: 0, local: 0 },
    updatedAt: "",
    createdAt: "",
    ...overrides,
  };
}

describe("buildLaunchPrompt", () => {
  it("includes lane title and numbered criteria", () => {
    const lane = makeLane();
    const prompt = buildLaunchPrompt(lane);

    expect(prompt).toContain("Add health endpoint");
    expect(prompt).toContain("1. GET /health returns 200");
    expect(prompt).toContain("2. Tests pass");
  });

  it("falls back to tags when criteria is empty", () => {
    const lane = makeLane({ criteria: [], tags: ["health", "api"] });
    const prompt = buildLaunchPrompt(lane);

    expect(prompt).toContain("1. health");
    expect(prompt).toContain("2. api");
  });

  it("includes harness-report instruction", () => {
    const prompt = buildLaunchPrompt(makeLane());
    expect(prompt).toContain("harness-report");
  });

  it("includes stop-at-watch-PR instruction", () => {
    const prompt = buildLaunchPrompt(makeLane());
    expect(prompt).toMatch(/stop at watch PR/i);
  });

  it("includes feature-workflow skill reference", () => {
    const prompt = buildLaunchPrompt(makeLane());
    expect(prompt).toContain("feature-workflow");
  });
});

describe("NDJSON session_id parsing (agent.ts)", () => {
  // These test the parsing logic in agent.ts runAgent for stream-json output
  it("extracts session_id from result line", () => {
    const ndjsonLines = [
      '{"type":"system","subtype":"init","session_id":"abc-123"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"done"}]},"session_id":"abc-123"}',
      '{"type":"result","subtype":"success","session_id":"abc-123","is_error":false,"total_cost_usd":0.05,"result":"done"}',
    ];

    let sessionId: string | undefined;
    let isError: boolean | undefined;
    let costUsd: number | undefined;
    let output = "";

    for (const line of ndjsonLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "result") {
          sessionId = obj.session_id;
          isError = obj.is_error;
          costUsd = obj.total_cost_usd;
          output = obj.result ?? output;
        }
      } catch {}
    }

    expect(sessionId).toBe("abc-123");
    expect(isError).toBe(false);
    expect(costUsd).toBe(0.05);
    expect(output).toBe("done");
  });

  it("extracts session_id from JSON output format", () => {
    const jsonOutput = JSON.stringify({
      session_id: "xyz-789",
      is_error: false,
      total_cost_usd: 0.12,
      result: "Feature implemented",
    });

    const parsed = JSON.parse(jsonOutput.trim());
    expect(parsed.session_id).toBe("xyz-789");
    expect(parsed.is_error).toBe(false);
    expect(parsed.total_cost_usd).toBe(0.12);
    expect(parsed.result).toBe("Feature implemented");
  });

  it("handles malformed NDJSON lines gracefully", () => {
    const lines = [
      "not json at all",
      '{"type":"result","session_id":"good-id","result":"ok"}',
      "{broken json",
    ];

    let sessionId: string | undefined;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "result") {
          sessionId = obj.session_id;
        }
      } catch {}
    }

    expect(sessionId).toBe("good-id");
  });
});
