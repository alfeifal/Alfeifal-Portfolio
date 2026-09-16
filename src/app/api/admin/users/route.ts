import { json, parseBody, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { adminStats, createUserAsAdmin, createUserSchema, listUsers } from "@/server/services/admin";

/**
 * Account administration. `withAdmin` resolves the session, then checks the role against the database
 * row — never against anything the client sent.
 *
 * The POST response is the only moment a generated temporary password exists outside the hash. It is
 * not written to the audit log and not logged to the console.
 */
export const GET = withAdmin(async () => json({ users: await listUsers(), stats: await adminStats() }));

export const POST = withAdmin(async (req, { user }) => {
  const input = await parseBody(req, createUserSchema);
  const meta = await requestMeta();
  const created = await createUserAsAdmin(user, input, meta.ip);
  return json(created, { status: 201 });
});
