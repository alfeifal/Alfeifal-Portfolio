import { z } from "zod";
import { AppError, json, parseBody, withAuth } from "@/server/http";
import { quickEntry } from "@/server/ai/reports";
import { aiConfigured } from "@/server/ai/client";
export const POST = withAuth(async (req, { user }) => { if (!aiConfigured()) throw new AppError(503, "AI not configured"); const { text } = await parseBody(req, z.object({ text: z.string().min(1).max(2000) })); return json(await quickEntry(user, text)); }, { limit: "ai" });
