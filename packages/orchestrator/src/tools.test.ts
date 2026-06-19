import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const HARNESS_REPORT = resolve(__dirname, "../../../tools/harness-report");

describe("harness-report CLI", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = join(tmpdir(), `harness-test-${Date.now()}`);
    mkdirSync(workDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("writes state.json with correct fields", () => {
    execSync(
      `node "${HARNESS_REPORT}" --stage intake --status running --note "starting"`,
      { cwd: workDir },
    );

    const stateFile = join(workDir, ".harness", "state.json");
    expect(existsSync(stateFile)).toBe(true);

    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.stage).toBe("intake");
    expect(state.stageIndex).toBe(0);
    expect(state.status).toBe("running");
    expect(state.note).toBe("starting");
    expect(state.updatedAt).toBeTruthy();
  });

  it("appends to state-history.jsonl", () => {
    execSync(
      `node "${HARNESS_REPORT}" --stage intake --status running`,
      { cwd: workDir },
    );
    execSync(
      `node "${HARNESS_REPORT}" --stage intake --status done --note "understood"`,
      { cwd: workDir },
    );

    const historyFile = join(workDir, ".harness", "state-history.jsonl");
    expect(existsSync(historyFile)).toBe(true);

    const lines = readFileSync(historyFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    expect(first.stage).toBe("intake");
    expect(first.status).toBe("running");

    const second = JSON.parse(lines[1]);
    expect(second.stage).toBe("intake");
    expect(second.status).toBe("done");
    expect(second.note).toBe("understood");
  });

  it("updates state.json on subsequent calls", () => {
    execSync(
      `node "${HARNESS_REPORT}" --stage intake --status running`,
      { cwd: workDir },
    );
    execSync(
      `node "${HARNESS_REPORT}" --stage implement --status running --note "coding"`,
      { cwd: workDir },
    );

    const stateFile = join(workDir, ".harness", "state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.stage).toBe("implement");
    expect(state.stageIndex).toBe(1);
    expect(state.status).toBe("running");
    expect(state.note).toBe("coding");
  });

  it("rejects invalid stage name", () => {
    expect(() =>
      execSync(
        `node "${HARNESS_REPORT}" --stage invalid --status running`,
        { cwd: workDir, stdio: "pipe" },
      ),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      execSync(
        `node "${HARNESS_REPORT}" --stage intake --status invalid`,
        { cwd: workDir, stdio: "pipe" },
      ),
    ).toThrow();
  });

  it("rejects missing required args", () => {
    expect(() =>
      execSync(
        `node "${HARNESS_REPORT}" --stage intake`,
        { cwd: workDir, stdio: "pipe" },
      ),
    ).toThrow();

    expect(() =>
      execSync(
        `node "${HARNESS_REPORT}" --status running`,
        { cwd: workDir, stdio: "pipe" },
      ),
    ).toThrow();
  });

  it("handles --attempt flag", () => {
    execSync(
      `node "${HARNESS_REPORT}" --stage implement --status fail --attempt 2`,
      { cwd: workDir },
    );

    const stateFile = join(workDir, ".harness", "state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.attempt).toBe(2);
  });

  it("handles --evidence flag", () => {
    execSync(
      `node "${HARNESS_REPORT}" --stage gates --status done --evidence test-output.txt`,
      { cwd: workDir },
    );

    const stateFile = join(workDir, ".harness", "state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(state.evidence).toContain("test-output.txt");
  });

  it("creates .harness directory if not exists", () => {
    const harnessDir = join(workDir, ".harness");
    expect(existsSync(harnessDir)).toBe(false);

    execSync(
      `node "${HARNESS_REPORT}" --stage intake --status running`,
      { cwd: workDir },
    );

    expect(existsSync(harnessDir)).toBe(true);
  });
});

describe("harness-lock CLI", () => {
  const HARNESS_LOCK = resolve(__dirname, "../../../tools/harness-lock");

  it("rejects missing action", () => {
    expect(() =>
      execSync(`node "${HARNESS_LOCK}"`, { stdio: "pipe" }),
    ).toThrow();
  });

  it("rejects missing slug", () => {
    expect(() =>
      execSync(`node "${HARNESS_LOCK}" acquire`, { stdio: "pipe" }),
    ).toThrow();
  });

  it("rejects invalid action", () => {
    expect(() =>
      execSync(`node "${HARNESS_LOCK}" invalid my-lane`, { stdio: "pipe" }),
    ).toThrow();
  });
});
