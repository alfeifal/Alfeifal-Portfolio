import type { ExecutedAction } from "./agent";

/**
 * Wire format for a streamed chat turn: one JSON object per line (NDJSON). Lines are self-contained,
 * so a reader can act on each one as it arrives and a chunk that splits a line mid-way is simply
 * buffered until the newline shows up.
 */
export type ChatStreamEvent =
  | { type: "start"; conversationId: string }
  /** A piece of the assistant's answer, to append to the message being shown. */
  | { type: "text"; delta: string }
  /** The model is using a tool. Only its name travels — never arguments, ids or results. */
  | { type: "tool"; name: string }
  | { type: "action"; action: ExecutedAction }
  | { type: "pending"; action: ExecutedAction }
  | { type: "done"; conversationId: string; messageId: string; outcome: TurnOutcome; usage: { input: number; output: number } }
  /** `partial` means text already reached the client: it must be kept and marked as interrupted. */
  | { type: "error"; message: string; partial: boolean };

/**
 * How a turn actually ended, decided from the executed actions alone — never from the model's prose.
 *
 * `partial` exists because a single sentence can produce several independent actions: if one of them
 * failed, the turn is not a success, and the UI must not present it as one.
 */
export type TurnOutcome = "none" | "ok" | "partial" | "failed" | "pending";

export function turnOutcome(
  actions: readonly { status: string }[],
  pending: readonly { status: string }[] = [],
): TurnOutcome {
  const done = actions.filter((a) => a.status === "success" || a.status === "confirmed");
  const failed = actions.filter((a) => a.status === "failed");
  if (failed.length) return done.length ? "partial" : "failed";
  if (pending.length) return "pending";
  if (done.length) return "ok";
  return "none";
}

export function encodeEvent(e: ChatStreamEvent) {
  return JSON.stringify(e) + "\n";
}

/**
 * Incremental NDJSON reader. Feed it whatever arrived; it returns the complete events and keeps the
 * unfinished tail for the next chunk.
 */
export function createEventParser() {
  let buffer = "";
  return {
    push(chunk: string): ChatStreamEvent[] {
      buffer += chunk;
      const out: ChatStreamEvent[] = [];
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try { out.push(JSON.parse(line) as ChatStreamEvent); } catch { /* a malformed line is dropped rather than killing the stream */ }
        }
        nl = buffer.indexOf("\n");
      }
      return out;
    },
    /** Anything left when the stream ends (a server that died mid-line). */
    rest() { return buffer; },
  };
}
