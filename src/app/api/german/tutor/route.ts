import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { AI_MODEL, aiConfigured, anthropic } from "@/server/ai/client";
import { AppError } from "@/server/http";
import type Anthropic from "@anthropic-ai/sdk";

/** The German tutor keeps its original prompt-building (client side) but the API key now lives on the server. */
const schema = z.object({ system: z.string().max(40000), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000) })).min(1).max(60), maxTokens: z.number().int().min(100).max(4000).default(900) });
export const POST = withAuth(async (req) => {
  if (!aiConfigured()) throw new AppError(503, "ANTHROPIC_API_KEY is not configured on the server");
  const input = await parseBody(req, schema);
  const res = await anthropic().messages.create({ model: AI_MODEL(), max_tokens: input.maxTokens, system: input.system, messages: input.messages });
  return json({ text: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n") });
}, { limit: "ai" });
