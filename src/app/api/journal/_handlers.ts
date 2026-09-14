import { crud, query } from "@/server/crud";
import * as j from "@/server/services/journal";
export const journal = crud({
  name: "journal", createSchema: j.journalCreateSchema, updateSchema: j.journalUpdateSchema,
  list: (u, req) => { const q = query(req); return j.listJournal(u.id, { from: q.from, to: q.to, kind: q.kind, limit: q.limit ? Number(q.limit) : undefined }); },
  get: (u, id) => j.getEntry(u.id, id), create: (u, i) => j.createEntry(u.id, i, u.timezone), update: (u, id, i) => j.updateEntry(u.id, id, i), remove: (u, id) => j.deleteEntry(u.id, id),
});
