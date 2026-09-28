import { z } from "zod";
import { analysisMetadata } from "../core/evidence/evidence-loader";
import type { ToolDefinition } from "./shared";
const input = z.object({ include_hashes: z.boolean().default(true) }).strict();
export const getAnalysisProvenanceTool: ToolDefinition<typeof input> = { name: "get_analysis_provenance", description: "Return frozen analysis population, method boundaries, evidence version, and source hashes.", inputSchema: input, parameters: { type: "object", additionalProperties: false, properties: { include_hashes: { type: "boolean", default: true } } }, execute: ({ include_hashes }) => ({ ...analysisMetadata, provenance: include_hashes ? analysisMetadata.provenance : analysisMetadata.provenance.map(({ source_file }) => ({ source_file })) }) };
