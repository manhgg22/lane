import { spawn } from "node:child_process";

export interface AgentOptions {
  timeoutMs?: number;
  allowedTools?: string[];
  model?: string;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export async function runAgent(
  laneDir: string,
  prompt: string,
  options: AgentOptions = {},
): Promise<AgentResult> {
  const { timeoutMs = 300_000, allowedTools, model } = options;

  const args = ["--headless", "--print", "--prompt", prompt];
  if (model) {
    args.push("--model", model);
  }
  if (allowedTools?.length) {
    for (const tool of allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  const start = Date.now();

  return new Promise<AgentResult>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: laneDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Agent process error: ${err.message}`));
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - start;
      if (code !== 0 && stderr) {
        console.error(`[agent] stderr: ${stderr.slice(0, 500)}`);
      }
      resolve({
        output: stdout.trim(),
        exitCode: code ?? 1,
        durationMs,
      });
    });
  });
}
