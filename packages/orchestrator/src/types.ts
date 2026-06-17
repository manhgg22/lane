export type LaneStatus = "running" | "stalled" | "needs_you";
export type StageState = "pending" | "current" | "done" | "passed_no_evidence";
export type LaneMode = "watching-pr" | "review-loop" | "implement";
export type StageResult = "pass" | "fail" | "blocked" | null;

export const STAGES = [
  "intake",
  "implement",
  "gates",
  "PR",
  "integrate",
  "e2e+QC",
  "review",
  "er gate",
  "push-dev",
  "dev/QC",
  "watch PR",
  "done",
] as const;

export type StageName = (typeof STAGES)[number];

export interface Lane {
  id: number;
  title: string;
  slug: string;
  branch: string;
  mode: LaneMode;
  port: number;
  dbUrl: string;
  tags: string[];
  status: LaneStatus[];
  stageIndex: number;
  progress: number;
  ticket: string | null;
  prNumber: number | null;
  git: { commit: string; subject: string; ci: string };
  note: string;
  qc: { dev: number; local: number };
  updatedAt: string;
  createdAt: string;
}

export interface StageRun {
  id: number;
  laneId: number;
  stage: string;
  state: StageState;
  attempt: number;
  evidence: string[];
  startedAt: string;
  endedAt: string | null;
  result: StageResult;
  message: string;
}

export interface LaneEvent {
  id: number;
  laneId: number;
  ts: string;
  type:
    | "stage_enter"
    | "stage_pass"
    | "stage_fail"
    | "re_enter"
    | "blocked"
    | "action";
  payload: Record<string, unknown>;
}

export interface LaneConfig {
  title: string;
  slug: string;
  tags: string[];
  criteria: string[];
}

export interface HarnessConfig {
  targetRepo: string;
  maxParallel: number;
  basePort: number;
  integrationBranch: string;
  agent: string;
  lanes: LaneConfig[];
}
