import { z } from "zod";
import { crud, query } from "@/server/crud";
import * as f from "@/server/services/finance";
export const accounts = crud({ name: "finance.accounts", createSchema: f.accountSchema, updateSchema: f.accountSchema.partial().extend({ archived: z.boolean().optional() }), list: (u) => f.listAccounts(u.id), create: (u, i) => f.createAccount(u.id, i), update: (u, id, i) => f.updateAccount(u.id, id, i), remove: (u, id) => f.deleteAccount(u.id, id) });
export const categories = crud({ name: "finance.categories", createSchema: f.categorySchema, updateSchema: f.categorySchema.partial().extend({ archived: z.boolean().optional() }), list: (u) => f.listCategories(u.id), create: (u, i) => f.createCategory(u.id, i), update: (u, id, i) => f.updateCategory(u.id, id, i), remove: (u, id) => f.updateCategory(u.id, id, { archived: true }) });
export const transactions = crud({
  name: "finance.transactions", createSchema: f.transactionSchema, updateSchema: f.transactionUpdateSchema,
  list: (u, req) => { const q = query(req); return f.listTransactions(u.id, { from: q.from, to: q.to, type: q.type, categoryId: q.categoryId, accountId: q.accountId, q: q.q, limit: q.limit ? Number(q.limit) : undefined }); },
  get: (u, id) => f.getTransaction(u.id, id), create: (u, i) => f.createTransaction(u.id, i, u.timezone), update: (u, id, i) => f.updateTransaction(u.id, id, i), remove: (u, id) => f.deleteTransaction(u.id, id),
});
export const budgets = crud({ name: "finance.budgets", createSchema: f.budgetSchema, updateSchema: f.budgetSchema.partial(), list: (u) => f.listBudgets(u.id), create: (u, i) => f.upsertBudget(u.id, i), remove: (u, id) => f.deleteBudget(u.id, id) });
export const recurring = crud({ name: "finance.recurring", createSchema: f.recurringSchema, updateSchema: f.recurringSchema.partial(), list: (u) => f.listRecurring(u.id), create: (u, i) => f.createRecurring(u.id, i), update: (u, id, i) => f.updateRecurring(u.id, id, i), remove: (u, id) => f.deleteRecurring(u.id, id) });
export const savings = crud({ name: "finance.savings", createSchema: f.savingsGoalSchema, updateSchema: f.savingsGoalSchema.partial(), list: (u) => f.listSavingsGoals(u.id), create: (u, i) => f.createSavingsGoal(u.id, i), update: (u, id, i) => f.updateSavingsGoal(u.id, id, i), remove: (u, id) => f.deleteSavingsGoal(u.id, id) });
