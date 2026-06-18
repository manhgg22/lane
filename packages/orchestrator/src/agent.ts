import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export interface AgentOptions {
  timeoutMs?: number;
  allowedTools?: string[];
  model?: string;
  appendSystemPrompt?: string;
  outputFormat?: "text" | "json" | "stream-json";
  verbose?: boolean;
  resume?: string;
  maxBudgetUsd?: number;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  durationMs: number;
  sessionId?: string;
  isError?: boolean;
  costUsd?: number;
}

export async function runAgent(
  laneDir: string,
  prompt: string,
  options: AgentOptions = {},
): Promise<AgentResult> {
  const {
    timeoutMs = 300_000,
    allowedTools,
    model,
    appendSystemPrompt,
    outputFormat = "json",
    verbose = false,
    resume,
    maxBudgetUsd,
  } = options;

  const args = ["-p", prompt];
  if (model) args.push("--model", model);
  if (allowedTools?.length) args.push("--allowedTools", allowedTools.join(","));
  if (appendSystemPrompt) args.push("--append-system-prompt", appendSystemPrompt);
  if (outputFormat !== "text") args.push("--output-format", outputFormat);
  if (verbose || outputFormat === "stream-json") args.push("--verbose");
  if (resume) args.push("--resume", resume);
  if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));
  args.push("--dangerously-skip-permissions");

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

      const result: AgentResult = {
        output: stdout.trim(),
        exitCode: code ?? 1,
        durationMs,
      };

      if (outputFormat === "json") {
        try {
          const parsed = JSON.parse(stdout.trim());
          result.sessionId = parsed.session_id;
          result.isError = parsed.is_error;
          result.costUsd = parsed.total_cost_usd;
          result.output = parsed.result ?? stdout.trim();
        } catch {}
      } else if (outputFormat === "stream-json") {
        const lines = stdout.trim().split("\n");
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "result") {
              result.sessionId = obj.session_id;
              result.isError = obj.is_error;
              result.costUsd = obj.total_cost_usd;
              result.output = obj.result ?? result.output;
            }
          } catch {}
        }
      }

      resolve(result);
    });
  });
}

export function spawnAgentStream(
  laneDir: string,
  prompt: string,
  options: AgentOptions = {},
): ChildProcess {
  const {
    allowedTools,
    model,
    appendSystemPrompt,
    resume,
    maxBudgetUsd,
  } = options;

  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  if (allowedTools?.length) args.push("--allowedTools", allowedTools.join(","));
  if (appendSystemPrompt) args.push("--append-system-prompt", appendSystemPrompt);
  if (resume) args.push("--resume", resume);
  if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));

  return spawn("claude", args, {
    cwd: laneDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}
