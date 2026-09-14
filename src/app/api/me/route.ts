import { json, parseBody, withAuth } from "@/server/http";
import { getPreferences, profileSchema, updateProfile } from "@/server/services/users";
import { aiConfigured } from "@/server/ai/client";
export const GET = withAuth(async (_req, { user }) => json({ id: user.id, email: user.email, name: user.name, timezone: user.timezone, currency: user.currency, locale: user.locale, preferences: await getPreferences(user.id), aiConfigured: aiConfigured(), marketProviders: { finnhub: Boolean(process.env.FINNHUB_API_KEY), stooq: true, yahoo: true, coingecko: true, newsRss: true } }));
export const PATCH = withAuth(async (req, { user }) => { const u = await updateProfile(user.id, await parseBody(req, profileSchema)); return json({ id: u.id, name: u.name, timezone: u.timezone, currency: u.currency, locale: u.locale }); });
