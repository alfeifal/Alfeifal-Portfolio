import { z } from "zod";
import { defineTool } from "../registry";
import * as fin from "@/server/services/finance";
import { dateSchema } from "@/server/services/tasks";
import { monthRange } from "@/lib/dates";
import { format } from "date-fns";

defineTool({
  name: "get_financial_summary", module: "finance", risk: "read",
  description: "Income, expenses, net, savings rate, category breakdown, budgets and account balances for a date range (defaults to the current month).",
  schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional() }),
  run: async (i, ctx) => {
    const r = monthRange(new Date());
    return fin.financialSummary(ctx.user.id, { from: i.from ?? format(r.start, "yyyy-MM-dd"), to: i.to ?? format(r.end, "yyyy-MM-dd") });
  },
});
defineTool({ name: "get_accounts", module: "finance", risk: "read", description: "List financial accounts with current balances.", schema: z.object({}), run: (_i, ctx) => fin.listAccounts(ctx.user.id) });
defineTool({ name: "get_transactions", module: "finance", risk: "read", description: "List transactions (expenses/income/transfers) with optional filters.", schema: z.object({ from: dateSchema.optional(), to: dateSchema.optional(), type: z.enum(["expense", "income", "transfer"]).optional(), q: z.string().optional(), limit: z.number().int().max(200).optional() }), run: (i, ctx) => fin.listTransactions(ctx.user.id, i) });
defineTool({
  name: "add_expense", module: "finance", risk: "low",
  description: "Record an expense. Category by name (created if missing). Date defaults to today.",
  schema: z.object({ amount: z.number().positive(), category: z.string().optional(), description: z.string().default(""), merchant: z.string().optional(), date: dateSchema.optional(), accountId: z.string().uuid().optional(), notes: z.string().optional() }),
  summarize: (i) => `add_expense — ${i.amount} — ${i.category ?? "uncategorized"} — ${i.description || i.merchant || ""}`.trim(),
  run: (i, ctx) => fin.createTransaction(ctx.user.id, { type: "expense", ...i, source: "ai" }, ctx.user.timezone),
});
defineTool({
  name: "add_income", module: "finance", risk: "low",
  description: "Record income (salary, freelance...).",
  schema: z.object({ amount: z.number().positive(), category: z.string().optional(), description: z.string().default(""), date: dateSchema.optional(), accountId: z.string().uuid().optional() }),
  summarize: (i) => `add_income — ${i.amount} — ${i.category ?? "income"}`,
  run: (i, ctx) => fin.createTransaction(ctx.user.id, { type: "income", ...i, source: "ai" }, ctx.user.timezone),
});
defineTool({
  name: "edit_expense", module: "finance", risk: "medium",
  description: "Edit an existing transaction (expense or income) by id.",
  schema: z.object({ id: z.string().uuid(), amount: z.number().positive().optional(), category: z.string().optional(), description: z.string().optional(), date: dateSchema.optional(), merchant: z.string().optional(), notes: z.string().optional() }),
  summarize: (i) => `edit_expense — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => fin.updateTransaction(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_expense", module: "finance", risk: "medium",
  description: "Delete a transaction by id. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete transaction ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_expense — ${i.id.slice(0, 8)}`,
  run: async ({ id }, ctx) => { await fin.deleteTransaction(ctx.user.id, id); return { deleted: id }; },
});
defineTool({
  name: "create_transfer", module: "finance", risk: "high",
  description: "Move money between two of the user's accounts. Always requires confirmation.",
  schema: z.object({ amount: z.number().positive(), fromAccountId: z.string().uuid(), toAccountId: z.string().uuid(), date: dateSchema.optional(), description: z.string().default("Transfer") }),
  summarize: (i) => `create_transfer — ${i.amount}`,
  run: (i, ctx) => fin.createTransaction(ctx.user.id, { type: "transfer", amount: i.amount, accountId: i.fromAccountId, toAccountId: i.toAccountId, date: i.date, description: i.description, source: "ai" }, ctx.user.timezone),
});
defineTool({ name: "get_budget", module: "finance", risk: "read", description: "List budgets per category (and total).", schema: z.object({}), run: (_i, ctx) => fin.listBudgets(ctx.user.id) });
defineTool({
  name: "update_budget", module: "finance", risk: "medium",
  description: "Create or update a monthly budget for a category (by name) or the total budget when category is omitted.",
  schema: z.object({ category: z.string().optional(), amount: z.number().positive(), period: z.enum(["monthly", "weekly"]).default("monthly") }),
  summarize: (i) => `update_budget — ${i.category ?? "total"} — ${i.amount}`,
  run: async (i, ctx) => {
    const categoryId = i.category ? (await fin.resolveCategory(ctx.user.id, i.category, "expense")).id : null;
    return fin.upsertBudget(ctx.user.id, { categoryId, amount: i.amount, period: i.period });
  },
});
defineTool({ name: "get_savings_goals", module: "finance", risk: "read", description: "List savings goals with progress.", schema: z.object({}), run: (_i, ctx) => fin.listSavingsGoals(ctx.user.id) });
defineTool({
  name: "update_savings_goal", module: "finance", risk: "medium",
  description: "Update the current amount of a savings goal (set or add).",
  schema: z.object({ id: z.string().uuid(), currentAmount: z.number().min(0).optional(), add: z.number().optional() }),
  summarize: (i) => `update_savings_goal — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => {
    const g = (await fin.listSavingsGoals(ctx.user.id)).find((x) => x.id === i.id);
    if (!g) throw new Error("Savings goal not found");
    return fin.updateSavingsGoal(ctx.user.id, i.id, { currentAmount: i.currentAmount ?? g.currentAmount + (i.add ?? 0), targetAmount: g.targetAmount });
  },
});

defineTool({
  name: "create_finance_account", module: "finance", risk: "low",
  description: "Create a money account (checking, savings, cash, credit, investment, other) with its opening balance. Use get_accounts first to avoid creating a duplicate.",
  schema: fin.accountSchema,
  summarize: (i) => `create_finance_account — ${i.name}`,
  run: (i, ctx) => fin.createAccount(ctx.user.id, i),
});
defineTool({
  name: "update_finance_account", module: "finance", risk: "medium",
  description: "Rename an account, change its type or currency, make it the default, or archive it. Balances come from transactions and are not editable here.",
  schema: z.object({ id: z.string().uuid() }).extend(fin.accountSchema.partial().shape).extend({ archived: z.boolean().optional() }),
  summarize: (i) => `update_finance_account — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => fin.updateAccount(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_finance_account", module: "finance", risk: "high",
  description: "Delete a money account. Its transactions are kept but stop belonging to an account, which changes balances. Always confirmed, and the account's exact name must be given so the wrong one cannot be hit.",
  schema: z.object({ id: z.string().uuid(), name: z.string().min(1).max(100).describe("The account's exact name, for the confirmation") }),
  summarize: (i) => `delete_finance_account — "${i.name}"`,
  needsConfirmation: (i) => `Permanently delete the account "${i.name}" (its transactions stay but lose their account)`,
  run: async (i, ctx) => {
    const account = (await fin.listAccounts(ctx.user.id)).find((a) => a.id === i.id);
    if (!account) throw new Error("Account not found");
    if (account.name.trim().toLowerCase() !== i.name.trim().toLowerCase()) throw new Error(`That id belongs to "${account.name}", not "${i.name}". Nothing was deleted.`);
    await fin.deleteAccount(ctx.user.id, i.id);
    return { deleted: i.id, name: account.name };
  },
});
defineTool({
  name: "create_finance_category", module: "finance", risk: "low",
  description: "Create a spending or income category. add_expense and add_income already resolve categories by name and create one when needed, so use this only when the user explicitly wants a new category with a specific type, colour or icon.",
  schema: fin.categorySchema,
  summarize: (i) => `create_finance_category — ${i.name}`,
  run: (i, ctx) => fin.createCategory(ctx.user.id, i),
});
defineTool({
  name: "create_recurring_transaction", module: "finance", risk: "medium",
  description: "Set up a recurring expense or income (rent, salary, subscriptions). It generates real transactions automatically from nextDate onwards, so confirm the amount and the schedule with the user first.",
  schema: fin.recurringSchema,
  needsConfirmation: (i) => `Create a recurring ${i.type} of ${i.amount} (${i.frequency}) starting ${i.nextDate}`,
  summarize: (i) => `create_recurring_transaction — ${i.description ?? i.type} — ${i.amount} ${i.frequency}`,
  run: (i, ctx) => fin.createRecurring(ctx.user.id, i),
});
defineTool({
  name: "update_recurring_transaction", module: "finance", risk: "medium",
  description: "Change a recurring transaction: amount, frequency, next date, end date, or pause it with active=false. Find ids with get_transactions or the finance screen.",
  schema: z.object({ id: z.string().uuid() }).extend(fin.recurringSchema.partial().shape).extend({ active: z.boolean().optional() }),
  summarize: (i) => `update_recurring_transaction — ${i.id.slice(0, 8)}`,
  run: ({ id, ...rest }, ctx) => fin.updateRecurring(ctx.user.id, id, rest),
});
defineTool({
  name: "delete_recurring_transaction", module: "finance", risk: "medium",
  description: "Delete a recurring transaction. Transactions it already generated are kept. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete recurring transaction ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_recurring_transaction — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await fin.deleteRecurring(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "create_savings_goal", module: "finance", risk: "low",
  description: "Create a savings goal with its target amount and optional deadline and monthly contribution. Progress is updated with update_savings_goal.",
  schema: fin.savingsGoalSchema,
  summarize: (i) => `create_savings_goal — ${i.name} — ${i.targetAmount}`,
  run: (i, ctx) => fin.createSavingsGoal(ctx.user.id, i),
});
defineTool({
  name: "delete_savings_goal", module: "finance", risk: "medium",
  description: "Delete a savings goal. The money itself is untouched: this only removes the tracker. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete savings goal ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_savings_goal — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await fin.deleteSavingsGoal(ctx.user.id, i.id); return { deleted: i.id }; },
});
defineTool({
  name: "delete_budget", module: "finance", risk: "medium",
  description: "Remove a budget for a category. Spending is not affected, only the limit you track against. Requires confirmation.",
  schema: z.object({ id: z.string().uuid() }),
  needsConfirmation: (i) => `Delete budget ${i.id.slice(0, 8)}`,
  summarize: (i) => `delete_budget — ${i.id.slice(0, 8)}`,
  run: async (i, ctx) => { await fin.deleteBudget(ctx.user.id, i.id); return { deleted: i.id }; },
});
