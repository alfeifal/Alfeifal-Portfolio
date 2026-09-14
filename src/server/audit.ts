import { db } from "@/server/db";
import { auditLogs } from "@/server/db/schema";

export type AuditActor = "user" | "ai" | "system";

export async function audit(params: { userId: string | null; actor: AuditActor; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown>; ip?: string | null }) {
  try {
    await db.insert(auditLogs).values({
      userId: params.userId,
      actor: params.actor,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: params.metadata,
      ip: params.ip ?? null,
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}
