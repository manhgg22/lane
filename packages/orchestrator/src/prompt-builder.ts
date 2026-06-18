import type { Lane } from "@harness/types";

export function buildImplementPrompt(lane: Lane, criteria: string[]): string {
  const criteriaList = criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

  return `Implement the feature: "${lane.title}"

Branch: ${lane.branch}

## Acceptance Criteria
${criteriaList}

Follow the feature-workflow skill instructions. Commit when done, do NOT push.`;
}

export function buildReviewPrompt(lane: Lane, diff: string): string {
  return `Review the diff for feature: "${lane.title}" (branch: ${lane.branch})

\`\`\`diff
${diff}
\`\`\`

Follow the pr-review-loop skill instructions for output format.`;
}

export function buildGatesPrompt(): string {
  return `Run the project's lint, typecheck, and test commands. Report which passed and which failed.`;
}
