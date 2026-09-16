import { z } from "zod";
import { json, parseBody, parseQuery, withAuth } from "@/server/http";
import { audit } from "@/server/audit";
import { findReview, generateReview, listReviews, reviewPeriod, reviewTypeSchema } from "@/server/services/reviews";

/**
 * Reviews. Read-only listing plus generation; every query is scoped to the session's user by the
 * service, and no parameter names a table, a column or an owner.
 */
const listSchema = z.object({
  type: reviewTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = withAuth(async (req, { user }) => json(await listReviews(user.id, parseQuery(req, listSchema))));

const generateSchema = z.object({
  type: reviewTypeSchema,
  /** Any day inside the period to review. Defaults to today, i.e. the current week or month. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Generates the review for the period containing `date`. Idempotent: a second call for the same
 * period refreshes that review's numbers instead of creating another, and leaves the user's notes
 * alone. Computing the facts needs no API key.
 */
export const POST = withAuth(async (req, { user }) => {
  const { type, date } = await parseBody(req, generateSchema);
  const period = reviewPeriod(type, date ?? new Date().toISOString().slice(0, 10), user.timezone);
  const existing = await findReview(user.id, type, period.from, period.to);
  const review = await generateReview(user.id, type, date, user.timezone);
  await audit({ userId: user.id, actor: "user", action: existing ? "review.regenerated" : "review.generated", entityType: "review", entityId: review.id, metadata: { type, periodStart: review.periodStart, periodEnd: review.periodEnd } });
  return json(review, { status: existing ? 200 : 201 });
});
