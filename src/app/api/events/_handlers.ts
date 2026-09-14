import { crud, query } from "@/server/crud";
import * as c from "@/server/services/calendar";
import { badRequest } from "@/server/http";
export const events = crud({
  name: "events", createSchema: c.eventCreateSchema, updateSchema: c.eventUpdateSchema,
  list: (u, req) => { const q = query(req); if (!q.from || !q.to) throw badRequest("from and to are required"); return c.listEvents(u.id, { from: new Date(q.from), to: new Date(q.to) }); },
  get: (u, id) => c.getEvent(u.id, id), create: (u, i) => c.createEvent(u.id, i), update: (u, id, i) => c.updateEvent(u.id, id, i), remove: (u, id) => c.deleteEvent(u.id, id),
});
