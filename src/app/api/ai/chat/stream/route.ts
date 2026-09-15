import { z } from "zod";
import { AppError, parseBody, withAuth } from "@/server/http";
import { chatStream } from "@/server/ai/agent";
import { aiConfigured } from "@/server/ai/client";
import { QUICK_ENTRY } from "@/server/ai/reports";

/**
 * Streaming chat. Same auth, CSRF gate and rate limit as the plain endpoint; the difference is that the
 * answer is delivered as NDJSON events while the model writes it, instead of in one piece at the end.
 */
export const POST = withAuth(async (req, { user }) => {
  if (!aiConfigured()) throw new AppError(503, "The AI assistant is not configured (ANTHROPIC_API_KEY missing on the server)");
  const { conversationId, text, mode } = await parseBody(req, z.object({
    conversationId: z.string().uuid().nullish(),
    text: z.string().min(1).max(8000),
    // The client picks a mode, never the prompt: the extra instructions live on the server.
    mode: z.enum(["assistant", "quick"]).default("assistant"),
  }));
  const quick = mode === "quick";
  const stream = chatStream(user, {
    conversationId: quick ? null : conversationId, // Fast Log is one-shot: it never joins the assistant transcript
    text,
    kind: quick ? QUICK_ENTRY.kind : "assistant",
    systemExtra: quick ? QUICK_ENTRY.systemExtra : undefined,
    maxRounds: quick ? QUICK_ENTRY.maxRounds : undefined,
    signal: req.signal,
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no", // keep proxies from holding the chunks back
    },
  });
}, { limit: "ai" });
