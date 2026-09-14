import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { getGermanState, saveGermanState } from "@/server/services/german";
export const GET = withAuth(async (_req, { user }) => json(await getGermanState(user.id)));
/**
 * Deliberately NOT audited: the German module persists its whole Zustand state on every change (dozens of
 * writes per lesson). An audit row per write would flood audit_logs with no forensic value; the row's
 * monotonically increasing `revision` plus `updatedAt` already give a tamper-evident change trail.
 */
export const PUT = withAuth(async (req, { user }) => {
  const { state, baseRevision } = await parseBody(req, z.object({ state: z.record(z.string(), z.unknown()), baseRevision: z.number().int().optional() }));
  return json(await saveGermanState(user.id, state, baseRevision));
});
