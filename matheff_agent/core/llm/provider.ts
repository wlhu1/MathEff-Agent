import type { LlmProvider } from "./types";
import { DeepSeekProvider, type DeepSeekEnvironment } from "./deepseek-provider";

export function createLlmProvider(env: DeepSeekEnvironment): LlmProvider {
  return new DeepSeekProvider(env);
}
