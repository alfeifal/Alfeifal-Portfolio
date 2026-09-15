"use client";
import { createEventParser, turnOutcome, type ChatStreamEvent, type TurnOutcome } from "@/server/ai/stream";
import { invalidateModules, modulesOf } from "./invalidate";
import type { Action } from "@/components/ai/ActionList";

export interface ChatStreamHandlers {
  onStart?: (conversationId: string) => void;
  onText?: (delta: string) => void;
  /** A tool is running. Fires before the work starts, so the UI can stop looking frozen. */
  onTool?: (name: string) => void;
  onAction?: (action: Action) => void;
  onPending?: (action: Action) => void;
  onError?: (message: string, partial: boolean) => void;
}

export interface ChatStreamResult {
  conversationId: string | null;
  actions: Action[];
  pending: Action[];
  /** Decided from the actions, never from the assistant's prose. */
  outcome: TurnOutcome;
  /** True when the connection ended without a terminal event. */
  interrupted: boolean;
  error: string | null;
}

/**
 * Runs one streamed turn and reports what really happened.
 *
 * Two things are handled here once, for every caller:
 *  - the modules of the actions that actually succeeded are invalidated, so open pages refetch from
 *    the database instead of showing pre-action data;
 *  - the outcome is computed from the action statuses, so a caller cannot accidentally announce
 *    success for a turn in which a tool failed.
 */
export async function streamChat(
  opts: { text: string; mode?: "assistant" | "quick"; conversationId?: string | null; signal?: AbortSignal },
  h: ChatStreamHandlers = {},
): Promise<ChatStreamResult> {
  const res = await fetch("/api/ai/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: opts.conversationId ?? null, text: opts.text, mode: opts.mode ?? "assistant" }),
    signal: opts.signal,
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    let message = `Request failed (${res.status})`;
    try { message = (JSON.parse(detail) as { error?: string }).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser();
  const actions: Action[] = [];
  const pending: Action[] = [];
  let conversationId: string | null = opts.conversationId ?? null;
  let outcome: TurnOutcome | null = null;
  let terminated = false;
  let error: string | null = null;
  let partialText = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true })) as ChatStreamEvent[]) {
        if (ev.type === "start") { conversationId = ev.conversationId; h.onStart?.(ev.conversationId); }
        else if (ev.type === "text") { partialText = true; h.onText?.(ev.delta); }
        else if (ev.type === "tool") h.onTool?.(ev.name);
        else if (ev.type === "action") { actions.push(ev.action as Action); h.onAction?.(ev.action as Action); }
        else if (ev.type === "pending") { pending.push(ev.action as Action); h.onPending?.(ev.action as Action); }
        else if (ev.type === "done") { outcome = ev.outcome; terminated = true; }
        else if (ev.type === "error") { error = ev.message; terminated = true; h.onError?.(ev.message, ev.partial || partialText); }
      }
      if (terminated) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  // Refetch only what genuinely changed. A failed or pending action invalidates nothing.
  const touched = modulesOf(actions);
  if (touched.length) invalidateModules(touched);

  return {
    conversationId,
    actions,
    pending,
    outcome: outcome ?? turnOutcome(actions, pending),
    interrupted: !terminated,
    error,
  };
}
