import { json, withAdmin } from "@/server/http";
import { deletionSummary } from "@/server/services/admin";

/**
 * What deleting this account would destroy, as row counts per module, so the confirmation can name
 * the consequences instead of asking somebody to delete blind.
 *
 * Counts only. This is the one place in the panel that touches another account's tables at all, and
 * it reads `count(*)` and nothing else — no titles, no amounts, no dates, no text. An administrator
 * learns that an account has 412 transactions; they still cannot see one.
 */
export const GET = withAdmin<{ id: string }>(async (_req, { params }) => json(await deletionSummary(params.id)));
