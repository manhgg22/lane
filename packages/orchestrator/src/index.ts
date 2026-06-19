export { openDb, saveDb, getAllLanes, getLaneById, insertLane, updateLane, getStageRuns, getEvents, insertEvent, queryAll, queryOne, run, getLastInsertId, insertStageRun, updateStageRun, getCurrentStageRun } from "./db.js";
export type { Database } from "./db.js";
export { seedDemoData } from "./seed.js";
export { loadConfig } from "./config.js";
export { cloneLane, removeLaneDir, allocatePort, renderDockerCompose, dockerUp, dockerDown, getRunningHarnessContainers, reconcileOnBoot, createFullLane, upLane, downLane, getLaneDir, getContainerName } from "./lane-manager.js";

export { STAGES } from "@harness/types";
export type { Lane, StageRun, LaneEvent, LaneConfig, HarnessConfig, LaneStatus, StageState, LaneMode, StageName, StageResult, CreateLaneRequest, LaneResponse, ErrorResponse, SchedulerTickResponse, LockInfo, SSEEvent, RunResult, SchedulerResult, AgentResult, ExecResult, SchedulerOptions } from "@harness/types";

export { runAgent, spawnAgentStream } from "./agent.js";
export type { AgentOptions } from "./agent.js";
export { launchLane, resumeLane, getActiveSession, getAllActiveSessions, buildLaunchPrompt } from "./launcher.js";
export type { LaunchOptions, LaneSession } from "./launcher.js";
export { startMonitoringLane, stopMonitoringLane, stopAllMonitors } from "./monitor.js";
export type { StateReport, MonitorCallback } from "./monitor.js";
export { execInContainer, execInLaneDir } from "./exec.js";
export { buildImplementPrompt, buildReviewPrompt, buildGatesPrompt } from "./prompt-builder.js";

export { advanceStage, reEnterStage, blockStage, passStage, failStage, passNoEvidence, isHeavyStage, calcProgress, HEAVY_STAGES, TRANSITION_MAP } from "./state-machine.js";
export { acquireLock, releaseLock, getActiveLock, releaseAllLocks, cleanStaleLocks, tryAcquireWithTimeout, LOCK_TYPES } from "./lock.js";
export { createSemaphore } from "./semaphore.js";
export type { Semaphore } from "./semaphore.js";
export { handlerRegistry } from "./handlers.js";
export type { StageHandler } from "./handlers.js";
export { runLane, runScheduler } from "./runner.js";
export { createLogger, configureLogger } from "./logger.js";
export type { Logger, LogLevel, LogEntry } from "./logger.js";
export { recoverFromCrash } from "./recovery.js";
export { insertAudit, getAuditLog } from "./db.js";
export type { AuditEntry } from "./db.js";
