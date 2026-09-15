import { z } from "zod";
import { AppError, parseBody, withAuth } from "@/server/http";
import { chatStream } from "@/server/ai/agent";
import { aiConfigured } from "@/server/ai/client";

/**
 * Streaming chat. Same auth, CSRF gate and rate limit as the plain endpoint; the difference is that the
 * answer is delivered as NDJSON events while the model writes it, instead of in one piece at the end.
 */
export const POST = withAuth(async (req, { user }) => {
  if (!aiConfigured()) throw new AppError(503, "The AI assistant is not configured (ANTHROPIC_API_KEY missing on the server)");
  const { conversationId, text } = await parseBody(req, z.object({ conversationId: z.string().uuid().nullish(), text: z.string().min(1).max(8000) }));
  const stream = chatStream(user, { conversationId, text, signal: req.signal });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no", // keep proxies from holding the chunks back
    },
  });
}, { limit: "ai" });
