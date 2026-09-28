import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "../core/agent/tool-executor";
import { verifyEvidenceIntegrity } from "../core/evidence/evidence-integrity";
import { SYNTHETIC_CASES } from "../examples/synthetic-cases";
import { TOOL_REGISTRY } from "../tools/registry";

test("the public core exposes the registered 12-tool allowlist", () => {
  assert.equal(TOOL_REGISTRY.length, 12);
});

test("all demonstration cases are explicitly synthetic", () => {
  assert.equal(SYNTHETIC_CASES.length, 3);
  assert.ok(
    SYNTHETIC_CASES.every(
      (item) =>
        item.mode === "SYNTHETIC_DEMO" &&
        item.metadata.synthetic === true &&
        item.metadata.real_student === false &&
        item.metadata.validation_evidence === false,
    ),
  );
});

test("case validation and profile stability run without an LLM", async () => {
  const caseEvidence = SYNTHETIC_CASES[0];
  const validation = await executeToolCall(
    "validate_case_evidence",
    JSON.stringify({ case_evidence: caseEvidence }),
  );
  const profile = await executeToolCall(
    "analyze_profile_stability",
    JSON.stringify({ case_evidence: caseEvidence }),
  );
  assert.equal(validation.ok, true);
  assert.equal(profile.ok, true);
});

test("all public aggregate evidence bundles pass manifest integrity checks", async () => {
  const result = await verifyEvidenceIntegrity();
  assert.equal(result.ok, true, result.errors.join(", "));
});
