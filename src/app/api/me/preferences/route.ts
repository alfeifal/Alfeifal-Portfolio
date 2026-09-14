import { z } from "zod";
import { json, parseBody, withAuth } from "@/server/http";
import { patchPreferences } from "@/server/services/users";
export const PATCH = withAuth(async (req, { user }) => json(await patchPreferences(user.id, await parseBody(req, z.record(z.string(), z.unknown())))));
