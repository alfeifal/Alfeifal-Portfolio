import { json, parseBody, withAuth } from "@/server/http";
import { germanEventSchema, recordGermanEvent } from "@/server/services/german";
import { audit } from "@/server/audit";
/** German module → bridge. Events come from actions the user performed in the module, so source is "user". */
export const POST = withAuth(async (req, { user }) => {
  const input = await parseBody(req, germanEventSchema);
  const r = await recordGermanEvent(user.id, input, user.timezone, { source: "user" });
  if (!r.deduplicated) await audit({ userId: user.id, actor: "user", action: "german.event", entityType: "german_event", entityId: r.event.id, metadata: { kind: input.kind, unitId: input.unitId ?? null, minutes: r.session?.durationMinutes ?? 0, studySessionId: r.session?.id ?? null, goalsUpdated: r.goalsUpdated } });
  return json(r, { status: r.deduplicated ? 200 : 201 });
});
