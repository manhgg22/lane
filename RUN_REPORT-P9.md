# RUN_REPORT-P9: feature-workflow tự lái (autonomous, no scripted prompt)

## Goal
Prove that a Claude agent inside Docker, given ONLY "Use the feature-workflow skill", will
**autonomously** invoke Superpowers skills (brainstorming, writing-plans, subagent-driven-development)
without the prompt scripting which `harness-report` calls to make.

## Setup
- Container: `harness-p9` (Docker, `harness-spike-claude` image with gh CLI)
- Superpowers plugin mounted: `/home/lane/.claude/plugins/superpowers:ro`
- `--plugin-dir /home/lane/.claude/plugins/superpowers` passed to claude CLI
- Feature-workflow skill at `/app/.claude/skills/feature-workflow.md`
- Tools: harness-report, harness-lock at `/app/.harness/bin/`
- Task: "Add tagging system for todos" (complex enough to benefit from brainstorming)

## Prompt (autonomous — NO harness-report calls listed)
```
Use the feature-workflow skill to deliver this task.
Title: Add tagging system for todos
Criteria:
1. CRUD endpoints for tags (GET/POST/PUT/DELETE /api/tags)
2. Many-to-many relationship between todos and tags
3. Filter todos by tag: GET /api/todos?tag=tagname
4. Tests for all new endpoints
5. Report each stage via harness-report. Do NOT push to main; stop at watch PR.
```

## Evidence

### 1. Skill tool calls (from NDJSON stream)
Agent invoked skills autonomously — NOT scripted in prompt:

| # | Skill invoked | Evidence |
|---|---------------|----------|
| 1 | `feature-workflow` | `"name":"Skill","input":{"skill":"feature-workflow"}` |
| 2 | `superpowers:writing-plans` | `"name":"Skill","input":{"skill":"superpowers:writing-plans"}` |

### 2. Tool usage summary (from NDJSON)
```
Skill  : 2 calls (feature-workflow, superpowers:writing-plans)
Bash   : 17 calls (harness-report transitions, tests, git, curl)
Read   : 8 calls (codebase exploration)
```

### 3. Stage transitions (driven by skill, not prompt)
```
harness-report --stage intake    --status running
harness-report --stage intake    --status done
harness-report --stage implement --status running
harness-report --stage implement --status done
harness-report --stage gates     --status running
harness-report --stage gates     --status done
harness-report --stage PR        --status running
harness-report --stage PR        --status blocked  (gh not authenticated)
harness-report --stage "watch PR" --status needs_you
```

### 4. Final result block
```json
{
  "stage": "watch PR",
  "status": "needs_you",
  "attempt": 1,
  "evidence": ["/tmp/gates-output.txt"],
  "sessionId": "feat/tagging-system",
  "summary": "Tagging system fully implemented and tested. 44/44 tests pass. Blocked at PR creation: gh CLI not authenticated."
}
```

### 5. Implementation outcome
- **44/44 tests pass** (original 12 + 32 new for tagging)
- 3 commits on `feat/tagging-system` branch
- Tags CRUD + many-to-many + filter by tag all working
- Agent stopped at watch PR as instructed

## Key Difference from P6
| Aspect | P6 (scripted) | P9 (autonomous) |
|--------|---------------|-----------------|
| Prompt | Listed exact harness-report calls | "Use the feature-workflow skill" only |
| `--plugin-dir` | Not passed | Passed |
| Skills invoked | 0 | 2 (feature-workflow, writing-plans) |
| Workflow driver | Prompt checklist | Skill pipeline |

## Cost
- Total: $0.77 USD
- Model: claude-sonnet-4-6
- Turns: 29
- Duration: ~2.3 minutes

## Verdict
**PASS** — Agent autonomously invoked `feature-workflow` skill which drove the entire pipeline.
The skill in turn invoked `superpowers:writing-plans` for planning. Stage transitions were
driven by the skill's pipeline logic, not by the prompt listing them.
