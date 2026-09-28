import type { ToolDefinition } from "./shared";
import { validateCaseEvidenceTool } from "./validate-case-evidence";
import { analyzeProfileStabilityTool } from "./analyze-profile-stability";
import { analyzeBoundarySensitivityTool } from "./analyze-boundary-sensitivity";
import { getDmlEvidenceTool } from "./get-dml-evidence";
import { compareDmlSpecificationsTool } from "./compare-dml-specifications";
import { getFactorEvidenceOverviewTool } from "./get-factor-evidence-overview";
import { getAnalysisProvenanceTool } from "./get-analysis-provenance";
import { getSensitivityEvidenceTool } from "./get-sensitivity-evidence";
import { summarizeCohortTool } from "./summarize-cohort";
import { generateEvidenceReportTool } from "./generate-evidence-report";
import { summarizeUncertaintyTool } from "./summarize-uncertainty";
import { checkEvidenceScopeTool } from "./check-evidence-scope";

export const TOOL_REGISTRY = [validateCaseEvidenceTool, analyzeProfileStabilityTool, analyzeBoundarySensitivityTool, getDmlEvidenceTool, compareDmlSpecificationsTool, getFactorEvidenceOverviewTool, getAnalysisProvenanceTool, getSensitivityEvidenceTool, summarizeCohortTool, generateEvidenceReportTool, summarizeUncertaintyTool, checkEvidenceScopeTool] as const;
export const TOOL_MAP = new Map<string, ToolDefinition>(TOOL_REGISTRY.map((tool) => [tool.name, tool]));
export const OPENAI_TOOLS = TOOL_REGISTRY.map((tool) => ({ type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
