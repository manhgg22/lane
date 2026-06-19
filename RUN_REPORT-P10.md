# RUN_REPORT-P10: Full pipeline to watch PR with real GitHub PR

## Goal
Prove the feature-workflow skill drives a complete pipeline from intake through PR creation
on a real GitHub repository, stopping at `watch PR` with a genuine open PR.

## Setup
- Container: `harness-p10` (Docker, `harness-spike-claude` image with gh CLI)
- GitHub repo: `manhgg22/sample-target-app` (private, created for this test)
- Default branch: `development` (pushed from fixture)
- gh auth: GH_TOKEN env var injected into container
- Git credentials: configured via credential helper
- Superpowers plugin: mounted at `/home/lane/.claude/plugins/superpowers:ro`
- Tools: harness-report + harness-lock at `/app/.harness/bin/`
- CJS fix: `package.json` with `{"type":"commonjs"}` in `.harness/bin/` dir

## Prompt
```
Use the feature-workflow skill to deliver this task.
Title: Add tagging system for todos
Criteria:
1. CRUD endpoints for tags (GET/POST/PUT/DELETE /api/tags)
2. Many-to-many relationship between todos and tags
3. Filter todos by tag: GET /api/todos?tag=tagname
4. Tests for all new endpoints
5. Report each stage via harness-report. Do NOT push to main; stop at watch PR.
6. Create PR against the development branch using gh pr create.
```

## Evidence

### 1. Real GitHub PR
- **URL**: https://github.com/manhgg22/sample-target-app/pull/1
- **Title**: "feat: add tagging system for todos"
- **Base**: `development`
- **Head**: `feat/tagging-system`
- **State**: OPEN

### 2. Skill invocations (from NDJSON)
| # | Skill invoked | Arguments |
|---|---------------|-----------|
| 1 | `feature-workflow` | (none — loaded skill pipeline) |
| 2 | `superpowers:brainstorming` | "Add a tagging system for todos: CRUD endpoints..." |

### 3. Tool usage summary
```
Bash       : 29 calls (harness-report, tests, git, gh pr create, curl)
Read       : 8 calls
Edit       : 8 calls (db.js, index.js, index.test.js modifications)
TaskCreate : 4 calls (subagent dispatch)
TaskUpdate : 7 calls
Write      : 3 calls (plan.md, design docs)
Skill      : 2 calls
ToolSearch : 2 calls
```

### 4. Stage transitions (all driven by skill pipeline)
```
harness-report --stage intake     --status running
harness-report --stage intake     --status done
harness-report --stage implement  --status running
harness-report --stage implement  --status done
harness-report --stage gates      --status running
harness-report --stage gates      --status done
harness-report --stage PR         --status running
  → gh pr create → PR #1 created
harness-report --stage integrate  --status running
harness-report --stage review     --status running
harness-report --stage push-dev   --status running
harness-report --stage done       --status done
  → watch PR: needs_you
```

### 5. Final result block
```json
{
  "stage": "watch PR",
  "status": "needs_you",
  "attempt": 1,
  "evidence": [".harness/test-report.txt"],
  "sessionId": "feat/tagging-system",
  "summary": "Tagging system implemented and PR #1 created against development. 23/23 tests pass. Waiting for human review."
}
```

### 6. Implementation outcome
- **23/23 tests pass** (original + new tag tests)
- `tags` table + `todo_tags` junction table with CASCADE
- Full CRUD: GET/POST/PUT/DELETE `/api/tags`
- Association: POST/DELETE `/api/todos/:id/tags`
- Filter: `GET /api/todos?tag=name` (case-insensitive)
- All todo responses include embedded `tags` array

### 7. Self-healing evidence
Agent encountered CJS/ESM error with harness-report (fixture has `"type":"module"`).
Agent diagnosed root cause and worked around it — bounded self-heal in action.

## Cost
- Total: $1.44 USD
- Model: claude-sonnet-4-6
- NDJSON lines: 338

## Verdict
**PASS** — Agent autonomously ran the full pipeline from intake to watch PR, created
a real GitHub PR (#1) on `manhgg22/sample-target-app`, and stopped with `needs_you`
status as required. All acceptance criteria met with test evidence.
