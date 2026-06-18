---
name: pr-review-loop
description: >
  Continuous PR review loop for a dedicated Feature Harness "review-loop" lane. Polls all open PRs
  in the target repo (including the harness's own), reviews each one, and signals the owning lane to
  re-enter and fix when a harness PR has blocking comments or CI failures. Use this when the lane
  launcher says "Use the pr-review-loop skill" or the lane mode is review-loop.
---

# PR Review Loop

You run a dedicated review-loop lane. You do NOT implement features. You poll open PRs, review them,
and nudge other lanes. You stay in this session and are `--resume`d on a poll interval by the harness.

## Iron laws
1. Report progress via `harness-report` (stage `review`, statuses below).
2. **Read-only on other people's branches.** You may comment/review; you do NOT push to or merge anyone's branch.
3. Specify the model explicitly when dispatching review subagents (mid-tier is the floor for reviewers).
4. Never merge. Merging is a human decision.

## Reporting contract
```
harness-report --stage review --status <running|needs_you|done|blocked> [--note "<text>"]
harness-signal-lane <laneSlug> --reason "<why it must re-enter>"   # tells a feature lane to wake up and fix
```

## Loop (one pass per resume — do NOT spin forever)
1. `harness-report --stage review --status running --note "polling open PRs"`.
2. List open PRs: `gh pr list --state open --json number,headRefName,title,reviewDecision,statusCheckRollup`.
3. For EACH PR:
   - Get the diff: `gh pr diff <n>`.
   - Dispatch a fresh **reviewer subagent** (isolated context, explicit mid-tier model) using
     **`superpowers:requesting-code-review`** (its code-reviewer prompt). Cover: spec/criteria, code quality,
     **user-flow and data-flow** sanity, tests/evidence present, security.
   - Post the review as a PR comment (`gh pr review <n> --comment --body ...`). Do not approve/merge.
   - If the PR maps to a harness feature lane AND has blocking findings or red CI:
     `harness-signal-lane <laneSlug> --reason "<summary of blocking issues>"` so that lane re-enters the right stage.
4. After the pass: `harness-report --stage review --status needs_you --note "<k> PRs reviewed; awaiting human merge"` and STOP the turn.
5. On next `--resume`, repeat. Skip PRs unchanged since your last review (track by head SHA).

## Result block
```
<<HARNESS_RESULT>>{"stage":"review","status":"needs_you","reviewed":N,"signaled":["<slug>"],"sessionId":"...","summary":"..."}<<END>>
```
