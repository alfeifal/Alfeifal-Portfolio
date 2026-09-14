import { json, parseBody, withAuth } from "@/server/http";
import { notificationSettings, notificationSettingsSchema, updateNotificationSettings } from "@/server/services/notifications";
export const GET = withAuth(async (_req, { user }) => json(await notificationSettings(user.id)));
export const PATCH = withAuth(async (req, { user }) => json(await updateNotificationSettings(user.id, await parseBody(req, notificationSettingsSchema.partial()))));
