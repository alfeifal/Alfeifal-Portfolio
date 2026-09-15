import { z } from "zod";
import { AppError, json, parseBody, withAuth } from "@/server/http";
import { plan } from "@/server/ai/reports";
import { aiConfigured } from "@/server/ai/client";
export const POST = withAuth(async (req, { user }) => { if (!aiConfigured()) throw new AppError(503, "AI not configured"); const i = await parseBody(req, z.object({ horizon: z.enum(["today", "week"]).default("today"), instructions: z.string().max(4000).optional(), conversationId: z.string().uuid().nullish() })); return json(await plan(user, i)); }, { limit: "ai" });
