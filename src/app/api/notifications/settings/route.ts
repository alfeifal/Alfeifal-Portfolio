import { json, parseBody, withAuth } from "@/server/http";
import { notificationSettings, notificationSettingsSchema, updateNotificationSettings } from "@/server/services/notifications";
import { audit } from "@/server/audit";
export const GET = withAuth(async (_req, { user }) => json(await notificationSettings(user.id)));
export const PATCH = withAuth(async (req, { user }) => {
  const patch = await parseBody(req, notificationSettingsSchema.partial());
  const next = await updateNotificationSettings(user.id, patch);
  await audit({ userId: user.id, actor: "user", action: "notifications.settings.update", entityType: "user", entityId: user.id, metadata: patch });
  return json(next);
});
