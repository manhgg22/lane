---
name: feature-workflow
description: >
  End-to-end workflow for an autonomous Claude Code agent running inside an isolated
  Feature Harness lane (a full clone of the target repo in Docker, own port + DB). Drives a
  single task from research to a watched PR, composing Superpowers skills (brainstorming,
  writing-plans, subagent-driven-development, systematic-debugging, verification-before-completion).
  Use this whenever the lane launcher says "Use the feature-workflow skill to deliver this task."
  This is the core workflow of the harness — follow it exactly, end to end.
---

# Feature Workflow

You are an autonomous agent inside ONE isolated lane (a full clone of the target repo, running in
Docker on its own port + DB). Your job: take a SINGLE task from intake all the way to a watched PR,
running the whole pipeline yourself. You stay in this session the entire time and dispatch your own
subagents — you are NOT called once per stage.

## Iron laws (non-negotiable)
1. **Report every stage transition** via the `harness-report` CLI (contract below). The dashboard is blind without it.
2. **Evidence-first.** A stage is only `done` when you have concrete evidence (test output, screenshots, logs). If criteria look met but you have no evidence, report `passed_no_evidence` and STOP that stage for human review — do not advance.
3. **Acquire the heavy lock** (`harness-lock acquire`) before any Docker-heavy step (e2e+QC, dev/QC) and release it after. Only one lane may hold it at a time.
4. **Never push to `main`. Never merge.** Stop at `watch PR` and wait for a human.
5. **Use Superpowers skills, don't reinvent them.** If a Superpowers skill applies to a phase, you MUST invoke it (see mapping). Confirm exact skill names from the installed skill list if unsure.
6. **Bounded self-heal.** On failure, debug and re-enter the prior stage, incrementing `attempt`. After `MAX_ATTEMPTS` (default 3) on the same stage, report `blocked` and stop.

## Reporting contract (call these from the shell)
```
harness-report --stage <stage> --status <status> [--attempt <n>] [--evidence <path> ...] [--note "<text>"]
# stage   : intake | implement | gates | PR | integrate | "e2e+QC" | review | "er gate" | push-dev | "dev/QC" | "watch PR" | done
# status  : running | passed_no_evidence | blocked | needs_you | done | fail
harness-lock acquire <laneSlug>     # blocks until it is this lane's turn
harness-lock release <laneSlug>
```
Report `running` when you ENTER a stage, then a terminal status when you leave it.

## Pipeline

### 0 - intake
- `harness-report --stage intake --status running`
- Read the task title + acceptance criteria from your launch prompt. Confirm the lane app is up (`curl localhost:$PORT/health`). Restate the task + criteria in your own words.
- -> `--status done --note "understood; app healthy"`

### 1 - research & plan  (Superpowers: brainstorming -> writing-plans)
- `--stage implement --status running`
- Invoke **`superpowers:brainstorming`** ("the blend"): explore the codebase, ask/answer the key design questions, surface alternatives, save a short design doc to `./.harness/design.md`.
- Invoke **`superpowers:writing-plans`**: break the work into bite-sized tasks with exact file paths + verification steps. Save to `./.harness/plan.md`.
- Evidence: `design.md`, `plan.md`.

### 2 - implement + review  (Superpowers: subagent-driven-development)
This is the "agent debate" / multi-level review the workflow is built around.
- Invoke **`superpowers:subagent-driven-development`** to execute `plan.md`:
  - Dispatch a **fresh implementer subagent per task** (isolated context, specify the model explicitly: cheap tier for transcription tasks, mid-tier for prose-described work).
  - After each task run the **two-stage review**: spec-compliance review first, then code-quality review.
  - At the end run the **whole-branch review** (`superpowers:requesting-code-review`).
- If a subagent reports BLOCKED you cannot resolve -> escalate (see fail rules).
- Build must be clean. Evidence: subagent reports + review notes.
- -> `--stage implement --status done --evidence ./.harness/reviews`

### 3 - gates
- `--stage gates --status running`
- Run the project's lint + typecheck + unit tests. Cross-check EVERY acceptance criterion explicitly.
- FAIL -> invoke **`superpowers:systematic-debugging`** (root cause before fixes), fix, re-enter stage 2. `attempt++`.
- -> `--status done --evidence <test report path>`

### 4 - PR
- `--stage PR --status running`
- `gh pr create --base development --head feat/<slug> --title "<task>" --body "<summary + criteria + evidence links>"`.
- -> `--status done --note "PR #<n>"`

### 5 - integrate
- `--stage integrate --status running`
- Merge `development` into the feature branch. Conflicts -> resolve -> re-run gates -> "re-merge -> re-integrate" (bounded loop).
- -> `--status done`

### 6 - e2e + QC  (HEAVY - Docker)
- `harness-lock acquire <laneSlug>` FIRST.
- `--stage "e2e+QC" --status running`
- Run e2e suite. Then **manual test on local**: drive the main user flows, capture screenshots into `./.harness/qc-local/`.
- Invoke **`superpowers:verification-before-completion`** to confirm criteria are truly met with evidence.
- `harness-lock release <laneSlug>` when done.
- No screenshots/log -> `--status passed_no_evidence` and STOP. With evidence -> `--status done --evidence ./.harness/qc-local`.

### 7 - review  (multi-level)
- `--stage review --status running`
- Beyond code review, do a **flow review**: walk the **user flow** and **data flow** - logical? natural? user-friendly? Then a **full text-based read of the whole diff** in one pass (catches more than inline review). Reply to / resolve PR comments.
- Issues -> re-enter the appropriate stage. -> `--status done --evidence ./.harness/review-notes.md`

### 8 - er gate  (human gate)
- `--stage "er gate" --status needs_you --note "awaiting release approval"` and STOP.
- The harness will `--resume` you when a human approves.

### 9 - push-dev
- `--stage push-dev --status running` -> deploy to staging/dev. -> `--status done --evidence <deploy log>`

### 10 - dev/QC  (HEAVY - Docker)
- `harness-lock acquire <laneSlug>`; `--stage "dev/QC" --status running`
- Manual QC on staging; screenshots into `./.harness/qc-dev/`. Release lock.
- -> `--status done --evidence ./.harness/qc-dev` (or `passed_no_evidence`).

### 11 - watch PR  (resumable loop - do NOT spin forever)
- `--stage "watch PR" --status needs_you --note "watching PR #<n> for comments / base conflicts"` and STOP the turn.
- When the harness `--resume`s you (a comment arrived, or `development` changed): determine what changed ->
  - new blocking comment -> re-enter the right stage, fix, come back around;
  - base conflict -> re-integrate (stage 5);
  - human merged -> proceed to `done`.
- Never merge yourself.

### 12 - done
- `--stage done --status done --note "<summary + all evidence>"`. Optionally clean up.

## Result block
At the end of EACH invocation, print a machine-readable block so the harness can parse it even if `harness-report` failed:
```
<<HARNESS_RESULT>>{"stage":"...","status":"...","attempt":N,"evidence":["..."],"sessionId":"...","summary":"..."}<<END>>
```

## Decision table
| Situation | Action |
|---|---|
| stage pass + evidence | report `done`, advance |
| pass, no evidence | report `passed_no_evidence`, STOP |
| fail | `superpowers:systematic-debugging` -> fix -> re-enter prior stage, `attempt++` |
| attempt > MAX_ATTEMPTS | report `blocked`, STOP |
| integrate conflict | re-integrate (bounded loop) |
| er gate / watch PR | report `needs_you`, STOP; wait for `--resume` |
| resumed at watch PR | inspect change -> fix / re-integrate / done |
