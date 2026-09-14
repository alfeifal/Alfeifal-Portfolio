import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
export function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured on the server");
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });
  return client;
}
export const AI_MODEL = () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
