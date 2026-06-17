import { describe, it, expect, vi, beforeEach } from "vitest";
import { execInContainer, execInLaneDir } from "./exec.js";
import * as child_process from "node:child_process";

vi.mock("node:child_process");

describe("execInContainer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stdout and exitCode 0 on success", () => {
    vi.spyOn(child_process, "execSync").mockReturnValue("test output\n");

    const result = execInContainer("harness-my-lane", "npm test");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test output");
    expect(result.stderr).toBe("");
  });

  it("constructs correct docker exec command", () => {
    const spy = vi.spyOn(child_process, "execSync").mockReturnValue("");

    execInContainer("harness-my-lane", "npm test");

    expect(spy).toHaveBeenCalledWith(
      'docker exec harness-my-lane sh -c "npm test"',
      expect.objectContaining({ encoding: "utf-8", stdio: "pipe" }),
    );
  });

  it("returns stderr and non-zero exit on failure", () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      const err = new Error("Command failed") as any;
      err.stdout = "partial output";
      err.stderr = "test failed";
      err.status = 1;
      throw err;
    });

    const result = execInContainer("harness-my-lane", "npm test");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("partial output");
    expect(result.stderr).toBe("test failed");
  });
});

describe("execInLaneDir", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs command in the correct directory", () => {
    const spy = vi.spyOn(child_process, "execSync").mockReturnValue("ok\n");

    const result = execInLaneDir("/lanes/my-lane", "npm run lint");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(spy).toHaveBeenCalledWith(
      "npm run lint",
      expect.objectContaining({ cwd: "/lanes/my-lane" }),
    );
  });

  it("handles command failure gracefully", () => {
    vi.spyOn(child_process, "execSync").mockImplementation(() => {
      const err = new Error("lint failed") as any;
      err.stdout = "";
      err.stderr = "error: unused variable";
      err.status = 2;
      throw err;
    });

    const result = execInLaneDir("/lanes/my-lane", "npm run lint");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("error: unused variable");
  });
});
