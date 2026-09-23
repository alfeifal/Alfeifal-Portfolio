import type { ZodType, z } from "zod";
import { assertResourceId, json, parseBody, withAuth } from "./http";
import type { SessionUser } from "./auth/session";
import { audit } from "./audit";

type U = SessionUser;

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
  // `withAuth` rejects a malformed `params.id` before the handler runs; `resource` is what it names
  // in the 404. The `assertResourceId` calls below are kept so the guarantee is visible at the point
  // the id is used, and so these handlers stay correct if they are ever called another way.
  const byId = { resource: opts.name };
  const item = {
    GET: withAuth<{ id: string }>(async (_req, { user, params }) => {
      if (!opts.get) return json({ error: "Not supported" }, { status: 405 });
      return json(await opts.get(user, assertResourceId(params.id, opts.name)));
    }, byId),
    PATCH: withAuth<{ id: string }>(async (req, { user, params }) => {
      if (!opts.update) return json({ error: "Not supported" }, { status: 405 });
      const input = await parseBody(req, opts.updateSchema);
      const updated = await opts.update(user, assertResourceId(params.id, opts.name), input);
      await audit({ userId: user.id, actor: "user", action: `${opts.name}.update`, entityId: params.id });
      return json(updated);
    }, byId),
    DELETE: withAuth<{ id: string }>(async (_req, { user, params }) => {
      if (!opts.remove) return json({ error: "Not supported" }, { status: 405 });
      await opts.remove(user, assertResourceId(params.id, opts.name));
      await audit({ userId: user.id, actor: "user", action: `${opts.name}.delete`, entityId: params.id });
      return json({ ok: true });
    }, byId),
  };
  return { collection, item };
}

export function query(req: Request) {
  const u = new URL(req.url);
  const o: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (o[k] = v));
  return o;
}
