export type ChatRole = "system" | "user" | "assistant" | "tool";
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage = { role: ChatRole; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] };
export type LlmRequest = { messages: ChatMessage[]; tools?: unknown[]; response_format?: { type: "json_object" }; temperature?: number; max_tokens?: number };
export type LlmResponse = { message: ChatMessage; model: string; finish_reason?: string };
export interface LlmProvider { readonly name: string; readonly model: string; complete(request: LlmRequest): Promise<LlmResponse>; }
