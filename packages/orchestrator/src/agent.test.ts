import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgent } from "./agent.js";
import * as child_process from "node:child_process";
import { EventEmitter } from "node:events";

vi.mock("node:child_process");

function createMockProcess(exitCode: number, stdout: string, stderr: string = "") {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  setTimeout(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  }, 10);

  return proc;
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns output and exit code 0 on success", async () => {
    vi.spyOn(child_process, "spawn").mockReturnValue(
      createMockProcess(0, "Feature implemented successfully"),
    );

    const result = await runAgent("/tmp/lane", "implement feature X");

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("Feature implemented successfully");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns non-zero exit code on failure", async () => {
    vi.spyOn(child_process, "spawn").mockReturnValue(
      createMockProcess(1, "", "Error: something went wrong"),
    );

    const result = await runAgent("/tmp/lane", "implement feature X");

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("");
  });

  it("passes correct args to spawn", async () => {
    const spawnSpy = vi.spyOn(child_process, "spawn").mockReturnValue(
      createMockProcess(0, "ok"),
    );

    await runAgent("/tmp/lane", "do something", {
      model: "sonnet",
      allowedTools: ["Edit", "Bash"],
    });

    expect(spawnSpy).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "--headless", "--print",
        "--prompt", "do something",
        "--model", "sonnet",
        "--allowedTools", "Edit",
        "--allowedTools", "Bash",
      ]),
      expect.objectContaining({ cwd: "/tmp/lane", shell: true }),
    );
  });

  it("rejects on spawn error", async () => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => proc.emit("error", new Error("spawn ENOENT")), 10);

    vi.spyOn(child_process, "spawn").mockReturnValue(proc);

    await expect(runAgent("/tmp/lane", "test")).rejects.toThrow("spawn ENOENT");
  });
});
