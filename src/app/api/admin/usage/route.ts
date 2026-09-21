import { z } from "zod";
import { json, parseQuery, withAdmin } from "@/server/http";
import { monthStart, usageByUser, usageTotals } from "@/server/services/ai-usage";

const querySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Assistant usage per account, for the period starting `?from=YYYY-MM-DD` (default: this month).
 *
 * Five integers and a date per account, joined to the name and address the account list already
 * shows. The table behind it stores nothing else — no prompt, no reply, no conversation title — so
 * there is no filtering to do here and nothing that could leak by accident.
 *
 * Deliberately has no counterpart that sets a limit. Measurement and enforcement are separate, and
 * only the first of them has any data to stand on yet.
 */
export const GET = withAdmin(async (req) => {
  const { from } = parseQuery(req, querySchema);
  const fromDay = from ?? monthStart();
  return json({ from: fromDay, totals: await usageTotals(fromDay), users: await usageByUser(fromDay) });
});
