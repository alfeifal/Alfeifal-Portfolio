import { audit } from "@/server/audit";
import type { DomainEvent, DomainEventType, EmitContext } from "./types";

/**
 * In-process, synchronous domain event bus (phase 2).
 *
 * - `emitDomainEvent` runs every matching subscriber, in registration order, awaiting each one.
 * - Subscribers are isolated: a throwing subscriber is logged (console + audit row, actor "system") and the
 *   others still run. The caller's mutation is already committed and is never undone — this is not a
 *   distributed transaction, it is best-effort propagation whose subscribers recompute from the source of truth.
 * - No external infrastructure: no queue, no workers, nothing to deploy.
 * - Subscribers live in ./subscribers and are registered lazily on the first emit, so services can import
 *   this module without creating import cycles at module-evaluation time.
 */
export interface Subscriber<E extends DomainEvent = DomainEvent> {
  name: string;
  /** Event types this subscriber handles. */
  types: readonly DomainEventType[];
  run: (userId: string, event: E, ctx: Required<Pick<EmitContext, "depth">> & EmitContext) => Promise<unknown>;
}
export interface EmitResult {
  type: DomainEventType;
  delivered: { subscriber: string; result: unknown }[];
  failures: { subscriber: string; error: string }[];
}

const MAX_DEPTH = 3;
const subscribers: Subscriber[] = [];
let registration: Promise<unknown> | null = null;

export function subscribe(s: Subscriber) {
  if (!subscribers.some((x) => x.name === s.name)) subscribers.push(s);
  return () => unsubscribe(s.name);
}
export function unsubscribe(name: string) {
  const i = subscribers.findIndex((x) => x.name === name);
  if (i >= 0) subscribers.splice(i, 1);
}
export function listSubscribers() {
  return subscribers.map((s) => ({ name: s.name, types: [...s.types] }));
}
function ensureRegistered() {
  return (registration ??= import("./subscribers"));
}

export async function emitDomainEvent(userId: string, event: DomainEvent, ctx: EmitContext = {}): Promise<EmitResult> {
  const depth = ctx.depth ?? 0;
  const out: EmitResult = { type: event.type, delivered: [], failures: [] };
  if (depth > MAX_DEPTH) {
    console.error(`[events] dropped ${event.type}: nesting depth ${depth} exceeds ${MAX_DEPTH}`);
    return out;
  }
  await ensureRegistered();
  for (const s of [...subscribers]) {
    if (!s.types.includes(event.type)) continue;
    try {
      out.delivered.push({ subscriber: s.name, result: await s.run(userId, event, { ...ctx, depth }) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.failures.push({ subscriber: s.name, error: message });
      console.error(`[events] subscriber "${s.name}" failed on ${event.type} (user ${userId}):`, e);
      await audit({ userId, actor: "system", action: "domain_event.subscriber_failed", entityType: "domain_event", entityId: event.type, metadata: { subscriber: s.name, message, event } });
    }
  }
  return out;
}
