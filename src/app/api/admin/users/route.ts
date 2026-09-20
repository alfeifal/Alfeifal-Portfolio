import { json, parseBody, parseQuery, withAdmin } from "@/server/http";
import { requestMeta } from "@/server/auth/session";
import { adminStats, createUserAsAdmin, createUserSchema, listUsers, listUsersSchema, sessionCounts } from "@/server/services/admin";

/**
 * Account administration. `withAdmin` resolves the session, then checks the role against the database
 * row — never against anything the client sent.
 *
 * The POST response is the only moment a generated temporary password exists outside the hash. It is
 * not written to the audit log and not logged to the console.
 *
 * `?q=` narrows the list by name or email. The stats and the session counts are deliberately computed
 * over *every* account, not over the filtered set: they describe the instance, and a header that
 * changed as you typed would be reporting your search box rather than the system.
 */
export const GET = withAdmin(async (req) => {
  const { q } = parseQuery(req, listUsersSchema);
  return json({ users: await listUsers({ q }), stats: await adminStats(), sessions: await sessionCounts() });
});

export const POST = withAdmin(async (req, { user }) => {
  const input = await parseBody(req, createUserSchema);
  const meta = await requestMeta();
  const created = await createUserAsAdmin(user, input, meta.ip);
  return json(created, { status: 201 });
});
