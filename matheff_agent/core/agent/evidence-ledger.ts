import { analysisMetadata } from "../evidence/evidence-loader";
import { evidenceManifest, sha256 } from "../evidence/evidence-integrity";

export type EvidenceRecord = {
  result_id: string;
  tool: string;
  status: "OK" | "ERROR";
  input_hash: string;
  output_hash: string;
  output?: unknown;
  error?: string;
};

export type EvidenceLedger = {
  ledger_version: "EVIDENCE_LEDGER_V1";
  evidence_version: string;
  evidence_schema_version: "FROZEN_EVIDENCE_SCHEMA_V1";
  report_schema_version: "EVIDENCE_REPORT_V1";
  report_evidence_version: string;
  manifest_version: string;
  report_id: string;
  generated_at: string;
  sources: typeof analysisMetadata.provenance;
  source_analysis: string[];
  sample: { mrle: typeof analysisMetadata.mrle_sample; diagnostic: typeof analysisMetadata.diagnostic_sample };
  factor: string | null;
  specification: string[];
  invoked_tools: Array<{ tool: string; result_id: string; status: "OK" | "ERROR"; input_hash: string; output_hash: string }>;
  robustness: Array<{ type: string; availability: "AVAILABLE" | "UNAVAILABLE" | "NOT_REQUESTED"; reason?: string }>;
  timestamp: string;
  interpretation_boundary: string;
};

export async function makeEvidenceRecord(index: number, tool: string, input: unknown, execution: { ok: boolean; output?: unknown; error?: string }): Promise<EvidenceRecord> {
  const inputHash = await sha256(input);
  const outputHash = await sha256(execution.ok ? execution.output : { error: execution.error });
  return { result_id: `ER-${String(index).padStart(3, "0")}-${outputHash.slice(0, 12)}`, tool, status: execution.ok ? "OK" : "ERROR", input_hash: inputHash, output_hash: outputHash, output: execution.ok ? execution.output : undefined, error: execution.ok ? undefined : execution.error };
}

export async function buildEvidenceLedger(input: { records: EvidenceRecord[]; factor?: string; sensitivity?: string; now?: string }): Promise<EvidenceLedger> {
  const generatedAt = input.now ?? new Date().toISOString();
  const seed = { generatedAt, factor: input.factor ?? null, records: input.records.map((record) => record.result_id) };
  const reportId = `MER-${(await sha256(seed)).slice(0, 16)}`;
  const sensitivityRecord = input.records.find((record) => record.tool === "get_sensitivity_evidence" && record.status === "OK");
  const scopeRecord = input.records.find((record) => record.tool === "check_evidence_scope" && record.status === "OK")?.output as { status?: string; reason?: string } | undefined;
  return {
    ledger_version: "EVIDENCE_LEDGER_V1",
    evidence_version: evidenceManifest.expected_report_evidence_version,
    evidence_schema_version: "FROZEN_EVIDENCE_SCHEMA_V1",
    report_schema_version: "EVIDENCE_REPORT_V1",
    report_evidence_version: evidenceManifest.expected_report_evidence_version,
    manifest_version: evidenceManifest.manifest_version,
    report_id: reportId,
    generated_at: generatedAt,
    sources: analysisMetadata.provenance,
    source_analysis: analysisMetadata.provenance.map((row) => row.source_file),
    sample: { mrle: analysisMetadata.mrle_sample, diagnostic: analysisMetadata.diagnostic_sample },
    factor: input.factor ?? null,
    specification: input.records.some((record) => record.tool === "get_dml_evidence") ? ["SINGLE", "MUTUAL"] : [],
    invoked_tools: input.records.map(({ tool, result_id, status, input_hash, output_hash }) => ({ tool, result_id, status, input_hash, output_hash })),
    robustness: [{ type: input.sensitivity ?? "NONE", availability: !input.sensitivity ? "NOT_REQUESTED" : sensitivityRecord ? "AVAILABLE" : "UNAVAILABLE", reason: sensitivityRecord ? undefined : scopeRecord?.reason }],
    timestamp: generatedAt,
    interpretation_boundary: "Frozen observational evidence for descriptive profile organization and population-level DML-adjusted associations with MRLE; no individual causal, diagnostic, risk/protective, or intervention inference.",
  };
}
