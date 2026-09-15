import { z } from "zod";
import { defineTool } from "../registry";
import { profileSchema, updateProfile } from "@/server/services/users";

/**
 * Profile only. Password changes, session revocation and account deletion are deliberately NOT exposed
 * to the assistant: they are security actions the user performs themselves in Settings.
 */
defineTool({
  name: "update_profile", module: "settings", risk: "medium",
  description:
    "Update the user's profile: display name, timezone (IANA, e.g. Europe/Madrid), currency (3 letters) or locale. The timezone changes how every date in the app is interpreted, so it is confirmed. Cannot touch the password, sessions or the account itself.",
  schema: profileSchema,
  needsConfirmation: (i) => (i.timezone ? `Change the timezone to ${i.timezone} (affects every date in the app)` : i.currency ? `Change the currency to ${i.currency}` : false),
  summarize: (i) => `update_profile — ${Object.keys(i).join(", ")}`,
  run: (i, ctx) => updateProfile(ctx.user.id, i),
});
