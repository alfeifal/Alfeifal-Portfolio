import type { ZodType, z } from "zod";
import { json, notFound, parseBody, withAuth } from "./http";
import type { SessionUser } from "./auth/session";
import { audit } from "./audit";

type U = SessionUser;

/**
 * Every id in this application is a UUID the database generated. Anything else never matched a row,
 * so "not found" is the truthful answer — and the same answer a real id belonging to somebody else
 * gets, which is what keeps this from being an enumeration oracle.
 *
 * It used to reach Postgres instead. `GET /api/tasks/not-a-uuid` came back 500, because the driver
 * raised `invalid input syntax for type uuid` and the wrapper treated a client's typo as a server
 * fault; five of the eight modules probed behaved that way. Two things were wrong with it: a caller
 * could mint 500s at will, burying real faults in monitoring noise, and the handler logged the
 * failing statement together with its bound parameters — which include the caller's own account id.
 */
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertResourceId(id: string, label: string): string {
  if (!RESOURCE_ID.test(id)) throw notFound(label);
  return id;
}

/**
 * Generates standard REST handlers for a resource so every module gets uniform
 * auth, validation, error handling, rate limiting and audit logging.
 */
export function crud<C extends ZodType, P extends ZodType>(opts: {
  name: string;
  createSchema: C;
  updateSchema: P;
  list: (user: U, req: Request) => Promise<unknown>;
  get?: (user: U, id: string) => Promise<unknown>;
  create: (user: U, input: z.output<C>, req: Request) => Promise<unknown>;
  update?: (user: U, id: string, input: z.output<P>) => Promise<unknown>;
  remove?: (user: U, id: string) => Promise<unknown>;
}) {
  const collection = {
    GET: withAuth(async (req, { user }) => json(await opts.list(user, req))),
    POST: withAuth(async (req, { user }) => {
      const input = await parseBody(req, opts.createSchema);
      const created = await opts.create(user, input, req);
      await audit({ userId: user.id, actor: "user", action: `${opts.name}.create`, entityId: (created as { id?: string })?.id });
      return json(created, { status: 201 });
    }),
  };
  const item = {
    GET: withAuth<{ id: string }>(async (_req, { user, params }) => {
      if (!opts.get) return json({ error: "Not supported" }, { status: 405 });
      return json(await opts.get(user, assertResourceId(params.id, opts.name)));
    }),
    PATCH: withAuth<{ id: string }>(async (req, { user, params }) => {
      if (!opts.update) return json({ error: "Not supported" }, { status: 405 });
      const input = await parseBody(req, opts.updateSchema);
      const updated = await opts.update(user, assertResourceId(params.id, opts.name), input);
      await audit({ userId: user.id, actor: "user", action: `${opts.name}.update`, entityId: params.id });
      return json(updated);
    }),
    DELETE: withAuth<{ id: string }>(async (_req, { user, params }) => {
      if (!opts.remove) return json({ error: "Not supported" }, { status: 405 });
      await opts.remove(user, assertResourceId(params.id, opts.name));
      await audit({ userId: user.id, actor: "user", action: `${opts.name}.delete`, entityId: params.id });
      return json({ ok: true });
    }),
  };
  return { collection, item };
}

export function query(req: Request) {
  const u = new URL(req.url);
  const o: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (o[k] = v));
  return o;
}
