import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { getGermanState, saveGermanState } from "@/server/services/german";
export const GET = withAuth(async (_req, { user }) => json(await getGermanState(user.id)));
export const PUT = withAuth(async (req, { user }) => {
  const { state, baseRevision } = await parseBody(req, z.object({ state: z.record(z.string(), z.unknown()), baseRevision: z.number().int().optional() }));
  return json(await saveGermanState(user.id, state, baseRevision));
});
