import { describe, it, expect } from "vitest";
import { parseHarnessResult } from "./handlers.js";

describe("parseHarnessResult", () => {
  it("parses a valid pass result with evidence", () => {
    const output = `Some agent chatter here...

<<HARNESS_RESULT>>
status: pass
stage: implement
summary: Added health endpoint with tests
files_changed:
  - src/health.ts
  - src/routes.ts
tests_added:
  - src/health.test.ts
tests_passed: true
commit_sha: abc1234
evidence:
  - test output shows 5/5 pass
  - curl localhost:3000/health returns 200
blockers:
<<END>>

Some trailing text`;

    const result = parseHarnessResult(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("pass");
    expect(result!.stage).toBe("implement");
    expect(result!.summary).toBe("Added health endpoint with tests");
    expect(result!.evidence).toEqual([
      "test output shows 5/5 pass",
      "curl localhost:3000/health returns 200",
    ]);
  });

  it("parses a blocked review result", () => {
    const output = `<<HARNESS_RESULT>>
status: blocked
stage: review
verdict: changes_requested
summary: Found SQL injection in user input handler
issues:
  - severity: high
evidence:
  - src/db.ts:42 uses string concatenation for SQL query
<<END>>`;

    const result = parseHarnessResult(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("blocked");
    expect(result!.stage).toBe("review");
    expect(result!.evidence).toEqual([
      "src/db.ts:42 uses string concatenation for SQL query",
    ]);
  });

  it("parses a fail result", () => {
    const output = `<<HARNESS_RESULT>>
status: fail
stage: implement
summary: Tests failing after implementation
evidence:
  - 3/5 tests fail with TypeError
<<END>>`;

    const result = parseHarnessResult(output);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("fail");
  });

  it("returns null when no HARNESS_RESULT block exists", () => {
    const output = "Just some regular agent output without the block";
    expect(parseHarnessResult(output)).toBeNull();
  });

  it("returns null for malformed status", () => {
    const output = `<<HARNESS_RESULT>>
status: unknown
stage: implement
summary: something
<<END>>`;

    expect(parseHarnessResult(output)).toBeNull();
  });
});
