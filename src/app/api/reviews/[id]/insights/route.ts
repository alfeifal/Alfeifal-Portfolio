import { AppError, json, withAuth } from "@/server/http";
import { audit } from "@/server/audit";
import { aiConfigured } from "@/server/ai/client";
import { attachAiInsights } from "@/server/ai/review-insights";

/**
 * Adds the model's commentary to an existing review. Deliberately a separate endpoint: the review is
 * already complete without it, so this failing (or the key being absent) never blocks a review.
 */
export const POST = withAuth<{ id: string }>(async (_req, { user, params }) => {
  if (!aiConfigured()) throw new AppError(503, "The AI is not configured (ANTHROPIC_API_KEY missing on the server)");
  const row = await attachAiInsights(user.id, params.id);
  await audit({ userId: user.id, actor: "ai", action: "review.insights_generated", entityType: "review", entityId: params.id, metadata: { insights: Array.isArray(row.aiInsights) ? row.aiInsights.length : 0 } });
  return json(row);
}, { limit: "ai" });
