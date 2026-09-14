import { crud, query } from "@/server/crud";
import * as p from "@/server/services/projects";
export const projects = crud({
  name: "projects", createSchema: p.projectCreateSchema, updateSchema: p.projectUpdateSchema,
  list: (u, req) => p.listProjects(u.id, query(req).status), get: (u, id) => p.getProject(u.id, id), create: (u, i) => p.createProject(u.id, i), update: (u, id, i) => p.updateProject(u.id, id, i), remove: (u, id) => p.deleteProject(u.id, id),
});
