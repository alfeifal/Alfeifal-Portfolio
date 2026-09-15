/** Runs a registered tool the way the agent would: validation, risk gate, logging — all real. */
import { getTool as registryGetTool } from "@/server/ai/registry";
import { runTool as agentRunTool } from "@/server/ai/agent";
import type { users } from "@/server/db/schema";

export const getTool = registryGetTool;

export function runTool(tool: NonNullable<ReturnType<typeof registryGetTool>>, input: unknown, user: typeof users.$inferSelect, confirmed = false) {
  return agentRunTool(tool, input, { user: user as never, conversationId: null, confirmed });
}
