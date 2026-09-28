import manifest from "./evidence-manifest.json";
import metadata from "./analysis-metadata.json";
import dml from "./final-dml-evidence.json";
import benchmark from "./benchmark-sensitivity.json";
import weighting from "./targeted-weighting-sensitivity.json";
import labels from "./canonical-factor-labels.json";

export type IntegrityStatus = {
  ok: boolean;
  manifest_version: string;
  expected_report_evidence_version: string;
  checked_bundles: Array<{ bundle: string; version_ok: boolean; hash_ok: boolean; actual_sha256: string }>;
  errors: string[];
};

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

export async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function verifyEvidenceIntegrity(expectedVersion = manifest.expected_report_evidence_version): Promise<IntegrityStatus> {
  const bundles = [
    ["analysis_metadata", metadata, metadata.evidence_version],
    ["final_dml", dml, dml.evidence_version],
    ["benchmark", benchmark, benchmark.evidence_version],
    ["targeted_weighting", weighting, weighting.evidence_version],
    ["canonical_labels", labels, "LABELS_FINAL_2026-08-25"],
  ] as const;
  const checked = await Promise.all(bundles.map(async ([bundle, value, actualVersion]) => {
    const declared = manifest.bundles[bundle];
    const actualHash = await sha256(value);
    return { bundle, version_ok: actualVersion === declared.evidence_version, hash_ok: actualHash === declared.canonical_sha256, actual_sha256: actualHash };
  }));
  const errors: string[] = [];
  if (expectedVersion !== manifest.expected_report_evidence_version) errors.push(`EXPECTED_VERSION_MISMATCH:${expectedVersion}`);
  for (const row of checked) {
    if (!row.version_ok) errors.push(`BUNDLE_VERSION_MISMATCH:${row.bundle}`);
    if (!row.hash_ok) errors.push(`BUNDLE_HASH_MISMATCH:${row.bundle}`);
  }
  return { ok: errors.length === 0, manifest_version: manifest.manifest_version, expected_report_evidence_version: manifest.expected_report_evidence_version, checked_bundles: checked, errors };
}

export const evidenceManifest = manifest;
