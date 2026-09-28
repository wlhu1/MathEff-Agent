import type { ChatMessage, LlmProvider, LlmRequest, LlmResponse } from "./types";

export interface DeepSeekEnvironment {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
}

export class DeepSeekProvider implements LlmProvider {
  readonly name = "DeepSeek";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(env: DeepSeekEnvironment) {
    this.apiKey = env.DEEPSEEK_API_KEY ?? "";
    this.model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
    this.baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.apiKey) throw new Error("SECRET_SETUP_REQUIRED");
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, ...request, thinking: { type: "disabled" } }) });
    if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: ChatMessage; finish_reason?: string }>; model?: string };
    const first = payload.choices?.[0];
    if (!first?.message) throw new Error("DEEPSEEK_INVALID_RESPONSE");
    return { message: first.message, model: payload.model ?? this.model, finish_reason: first.finish_reason };
  }
}
