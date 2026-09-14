import type { z, ZodType } from "zod";
import type { SessionUser } from "@/server/auth/session";

/**
 * Risk levels (spec §9):
 *  read   – no side effects
 *  low    – executes immediately (add expense, log set, create task...)
 *  medium – executes immediately unless the user has "confirm medium-risk actions" on, or the
 *           tool marks the call as needing confirmation (deletes, bulk/major changes)
 *  high   – always requires explicit confirmation
 */
export type RiskLevel = "read" | "low" | "medium" | "high";

export interface ToolContext {
  user: SessionUser;
  conversationId: string | null;
  /** true when the user has explicitly confirmed this call (second pass). */
  confirmed: boolean;
}

export interface ToolDefinition<S extends ZodType = ZodType> {
  name: string;
  description: string;
  module: string;
  risk: RiskLevel;
  schema: S;
  /** Optional: decide per-call whether a medium-risk action needs confirmation. */
  needsConfirmation?: (input: z.output<S>, ctx: ToolContext) => boolean | string;
  /** One-line human summary for the action log, e.g. "add_expense — €18 — Food". */
  summarize?: (input: z.output<S>, result: unknown) => string;
  run: (input: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}

const registry = new Map<string, ToolDefinition>();

export function defineTool<S extends ZodType>(def: ToolDefinition<S>): ToolDefinition<S> {
  if (registry.has(def.name)) throw new Error(`Duplicate tool ${def.name}`);
  registry.set(def.name, def as unknown as ToolDefinition);
  return def;
}
export function getTool(name: string) {
  return registry.get(name) ?? null;
}
export function allTools() {
  return [...registry.values()];
}
