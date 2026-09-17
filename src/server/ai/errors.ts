import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@/server/http";
import { InvalidTranscriptError } from "./transcript";

/**
 * What the user is allowed to see when a turn fails.
 *
 * The bug that opened phase 3.14 ended with this on screen:
 *
 *     Anthropic: 400 invalid_request_error — messages.5: tool_use ids were found without tool_result
 *     blocks immediately after: toolu_01PamW4rvrYGY2AWXH8mX39d…
 *
 * That is a provider payload, an internal request shape and three tool ids, and none of it is the user's
 * problem or the user's business. Every failure now goes through here on its way out, and the detail goes
 * to the server log instead.
 *
 * Errors are matched on the SDK's typed classes, not on strings: the wording of a provider message is not
 * a contract, and a substring match on it would silently stop working.
 */

/** Deliberately plain. It says what happened and what to do, and nothing about how the server is built. */
export const GENERIC_AI_ERROR = "I couldn't complete that. Try again.";

export function safeAiMessage(e: unknown): string {
  // Our own errors are written for the user already ("The AI assistant is not configured", "…expired").
  if (e instanceof AppError) return e.message;

  // A transcript we refused to send. The user does not need to know the protocol was involved — from
  // where they sit, the conversation simply could not continue.
  if (e instanceof InvalidTranscriptError) return "Something went wrong with this conversation. Start a new one and try again.";

  if (e instanceof Anthropic.RateLimitError) return "The assistant is busy right now. Wait a few seconds and try again.";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "The assistant is unavailable right now.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The assistant took too long to answer. Try again.";
  if (e instanceof Anthropic.APIConnectionError) return "I couldn't reach the assistant. Check your connection and try again.";
  if (e instanceof Anthropic.InternalServerError) return "The assistant is temporarily unavailable. Try again in a moment.";
  // Everything else the SDK can raise — including 400 invalid_request_error, whose text is never echoed.
  if (e instanceof Anthropic.APIError) return GENERIC_AI_ERROR;

  return GENERIC_AI_ERROR;
}

/**
 * The same sanitised message, as the error the HTTP layer turns into a response.
 *
 * Without this the non-streaming route answered "Internal error" in production and the provider's raw
 * text in development — two different behaviours, neither of them the sentence the user needs.
 */
export function asUserFacingAiError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const status = e instanceof Anthropic.RateLimitError ? 429
    : e instanceof Anthropic.APIConnectionTimeoutError ? 504
    : e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? 503
    : 502;
  return new AppError(status, safeAiMessage(e));
}

/**
 * Server-side detail. Request ids, status codes and provider text belong here and only here.
 * Tool *parameters* are not logged: they are the user's data, not diagnostics.
 */
export function logAiError(scope: string, e: unknown, context: Record<string, unknown> = {}) {
  const base = { scope, ...context };
  if (e instanceof Anthropic.APIError) {
    console.error("[ai] provider error", { ...base, status: e.status, requestId: e.requestID, name: e.name, message: e.message });
    return;
  }
  if (e instanceof InvalidTranscriptError) {
    console.error("[ai] refused to send an invalid transcript", { ...base, violations: e.violations });
    return;
  }
  console.error("[ai] failed", base, e);
}
