import { execSync } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function execInContainer(
  containerName: string,
  command: string,
  timeoutMs: number = 120_000,
): ExecResult {
  try {
    const stdout = execSync(
      `docker exec ${containerName} sh -c ${JSON.stringify(command)}`,
      { encoding: "utf-8", stdio: "pipe", timeout: timeoutMs },
    );
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? "").trim(),
      exitCode: e.status ?? 1,
    };
  }
}

export function execInLaneDir(
  laneDir: string,
  command: string,
  timeoutMs: number = 120_000,
): ExecResult {
  try {
    const stdout = execSync(command, {
      cwd: laneDir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: timeoutMs,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? "").trim(),
      exitCode: e.status ?? 1,
    };
  }
}
