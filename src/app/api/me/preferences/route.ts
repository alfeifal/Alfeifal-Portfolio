import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { patchPreferences } from "@/server/services/users";
import { audit } from "@/server/audit";
export const PATCH = withAuth(async (req, { user }) => {
  const patch = await parseBody(req, z.record(z.string(), z.unknown()));
  const next = await patchPreferences(user.id, patch);
  await audit({ userId: user.id, actor: "user", action: "preferences.update", entityType: "user", entityId: user.id, metadata: { keys: Object.keys(patch) } }); // keys only: preferences may hold free-form data
  return json(next);
});
