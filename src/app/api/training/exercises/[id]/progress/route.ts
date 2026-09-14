import { json, withAuth } from "@/server/http";
import { exerciseProgress } from "@/server/services/training";
export const GET = withAuth<{ id: string }>(async (_req, { user, params }) => json(await exerciseProgress(user.id, params.id)));
