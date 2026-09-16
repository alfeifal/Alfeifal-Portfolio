import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { reviews } from "@/server/db/schema";
import { notFound } from "@/server/http";
import { AI_MODEL, aiConfigured } from "./client";
import { complete } from "./agent";

/**
 * AI insights for a review (phase 3.7).
 *
 * This is a second, optional pass. The review is already complete without it: facts, trends and
 * rule-derived observations are computed and stored first, so a model outage costs the commentary and
 * nothing else.
 *
 * The model is handed the facts and trends only — never the database, never the raw rows — and is
 * required to cite, for each insight, the metric it rests on. Anything it returns without usable
 * evidence is dropped before it is stored, so an unsupported sentence cannot reach the user.
 */

const SYSTEM = [
  "You comment on a single period of a person's own tracked data. You are given FACTS (measured) and TRENDS (measured changes). Nothing else exists.",
  "",
  "RULES — all of them are hard:",
  "- Use only the numbers given. Never introduce a number that is not in the input, and never round one into a different claim.",
  "- Where a value is null it means NOT MEASURED. Say so, or say nothing. Never read null as zero, as 'none' or as a failure.",
  "- Do not assert causality. You can say two things moved together; you cannot say one caused the other, and you must not guess why.",
  "- Do not predict. No 'you will', no 'at this rate you'll'. A trend is a description of the past, not a forecast.",
  "- Separate observation from suggestion. A suggestion must be phrased as one and must follow from a stated number.",
  "- No health, medical, psychological or mood claims. Nutrition and training figures are logistics, not diagnosis. Never infer how the person felt.",
  "- No financial advice and no certainty about money. Report the figures; do not tell them what to invest in or promise an outcome.",
  "- No motivational filler, no praise, no encouragement. If a section has no data, the honest insight is that it has no data.",
  "- Keep it short: at most 5 insights, one or two sentences each.",
  "",
  'Return ONLY a JSON array, no prose around it: [{"text": "...", "metric": "<the exact key path from FACTS or TRENDS this rests on>", "kind": "observation" | "suggestion"}]',
  "If the data does not support any insight, return [].",
].join("\n");

const insightSchema = z.object({
  text: z.string().min(3).max(600),
  metric: z.string().min(1).max(120),
  kind: z.enum(["observation", "suggestion"]).default("observation"),
});
export type ReviewInsight = z.infer<typeof insightSchema> & { source: "ai" };

/** Collects every key path present in the facts/trends payload, to check what an insight cites. */
function metricPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    out.add(k);
    if (v && typeof v === "object" && !Array.isArray(v)) metricPaths(v, path, out);
  }
  return out;
}

/**
 * Keeps only insights that name a metric the payload actually contains.
 *
 * This is the guard that stops an invented observation from being stored: a model that writes a
 * pleasant sentence about something it was never given cannot name a real metric for it.
 */
export function validateInsights(raw: unknown, facts: unknown, trends: unknown): ReviewInsight[] {
  const parsed = z.array(insightSchema).safeParse(raw);
  if (!parsed.success) return [];
  const known = metricPaths(facts);
  metricPaths(trends, "", known);
  const seen = new Set<string>();
  const out: ReviewInsight[] = [];
  for (const i of parsed.data) {
    const metric = i.metric.trim();
    // The cited path, or its last segment, has to exist in what the model was actually given.
    const leaf = metric.split(".").pop() ?? metric;
    if (!known.has(metric) && !known.has(leaf)) continue;
    const key = i.text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...i, metric, source: "ai" });
    if (out.length >= 5) break;
  }
  return out;
}

/** Strips a fenced code block if the model wrapped its JSON in one. */
function parseJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/**
 * Generates insights for a stored review and saves them alongside — never inside — the facts.
 * The user's own notes are passed as context when they exist, and are never rewritten or echoed back
 * as if they were a finding.
 */
export async function attachAiInsights(userId: string, reviewId: string) {
  const [review] = await db.select().from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId)));
  if (!review) throw notFound("Review");
  if (!aiConfigured()) throw new Error("The AI is not configured (ANTHROPIC_API_KEY missing on the server)");

  const prompt = [
    `PERIOD: ${review.periodStart} → ${review.periodEnd} (${review.type})`,
    "",
    "FACTS:",
    JSON.stringify(review.facts),
    "",
    "TRENDS:",
    JSON.stringify(review.trends),
    review.userNotes ? `\nThe person's own note about this period (context only — do not repeat it back, do not correct it, do not treat it as a measurement):\n${review.userNotes}` : "",
  ].join("\n");

  const text = await complete({ system: SYSTEM, prompt, maxTokens: 900 });
  const insights = validateInsights(parseJson(text), review.facts, review.trends);

  const [row] = await db.update(reviews)
    .set({ aiInsights: insights, aiGeneratedAt: new Date(), aiModel: AI_MODEL(), updatedAt: new Date() })
    .where(and(eq(reviews.id, reviewId), eq(reviews.userId, userId)))
    .returning();
  return row;
}
