import { z } from "zod";
import { AppError, json, parseBody, withAuth } from "@/server/http";
import { chat } from "@/server/ai/agent";
import { aiConfigured } from "@/server/ai/client";
export const POST = withAuth(async (req, { user }) => {
  if (!aiConfigured()) throw new AppError(503, "The AI assistant is not configured (ANTHROPIC_API_KEY missing on the server)");
  const { conversationId, text } = await parseBody(req, z.object({ conversationId: z.string().uuid().nullish(), text: z.string().min(1).max(8000) }));
  return json(await chat(user, { conversationId, text }));
}, { limit: "ai" });
