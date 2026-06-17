import type { Lane } from "@harness/types";

export function buildImplementPrompt(lane: Lane, criteria: string[]): string {
  const criteriaList = criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

  return `You are an AI developer working on the feature: "${lane.title}"

Branch: ${lane.branch}

## Acceptance Criteria
${criteriaList}

## Instructions
1. Read the existing codebase to understand the project structure
2. Implement the feature according to the acceptance criteria above
3. Write tests for your implementation
4. Make sure all existing tests still pass
5. Commit your changes with a descriptive commit message

Do NOT push to remote. Only commit locally.`;
}

export function buildReviewPrompt(lane: Lane, diff: string): string {
  return `You are a code reviewer. Review the following diff for the feature: "${lane.title}"

Branch: ${lane.branch}

## Diff to Review
\`\`\`diff
${diff}
\`\`\`

## Review Checklist
1. **Correctness**: Does the code do what it's supposed to?
2. **Edge cases**: Are edge cases handled?
3. **Tests**: Are there adequate tests?
4. **Style**: Does the code follow project conventions?
5. **Security**: Any security concerns?

If you find issues, respond with:
ISSUES_FOUND: true
Then list each issue.

If the code looks good, respond with:
ISSUES_FOUND: false
APPROVED`;
}

export function buildGatesPrompt(): string {
  return `Run the project's lint, typecheck, and test commands. Report which passed and which failed.`;
}
