import { TOOL_MAP } from "../../tools/registry";

export async function executeToolCall(name: string, rawArguments: string) {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: "UNKNOWN_TOOL", name, allowed_tools: [...TOOL_MAP.keys()] };
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(rawArguments || "{}"); } catch { return { ok: false, error: "INVALID_JSON_ARGUMENTS", name }; }
  const parsed = tool.inputSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, error: "INVALID_TOOL_ARGUMENTS", name, issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
  try { return { ok: true, name, output: await tool.execute(parsed.data) }; } catch (error) { return { ok: false, error: "TOOL_EXECUTION_ERROR", name, detail: error instanceof Error ? error.message : "unknown" }; }
}
