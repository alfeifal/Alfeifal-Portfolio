import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { accounts, budgets, categories, recurringTransactions, savingsGoals, transactions } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/http";
import { dateSchema } from "./tasks";
import { round2 } from "@/lib/money";
import { addDaysKey, todayKey } from "@/lib/dates";

export const accountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["checking", "savings", "cash", "credit", "investment", "other"]).default("checking"),
  currency: z.string().length(3).default("EUR"),
  openingBalance: z.number().default(0),
  institution: z.string().max(100).nullish(),
  isDefault: z.boolean().default(false),
});
export const categorySchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(["expense", "income"]).default("expense"),
  icon: z.string().max(10).nullish(),
  color: z.string().max(20).nullish(),
});
export const transactionSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount: z.number().positive().max(1e9),
  currency: z.string().length(3).optional(),
  date: dateSchema.optional(),
  description: z.string().max(300).default(""),
  merchant: z.string().max(200).nullish(),
  accountId: z.string().uuid().nullish(),
  toAccountId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  /** Category can be given by name (AI/natural language) — resolved or created. */
  category: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  tags: z.string().max(200).nullish(),
  source: z.enum(["user", "ai", "import"]).default("user"),
});
export const transactionUpdateSchema = transactionSchema.partial();
export const budgetSchema = z.object({ categoryId: z.string().uuid().nullish(), amount: z.number().positive(), period: z.enum(["monthly", "weekly"]).default("monthly") });
export const recurringSchema = z.object({
  type: z.enum(["expense", "income"]),
  amount: z.number().positive(),
  description: z.string().min(1).max(200),
  accountId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  frequency: z.enum(["monthly", "weekly", "yearly"]).default("monthly"),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  nextDate: dateSchema,
  endDate: dateSchema.nullish(),
  active: z.boolean().default(true),
});
export const savingsGoalSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmount: z.number().positive(),
  currentAmount: z.number().min(0).default(0),
  accountId: z.string().uuid().nullish(),
  deadline: dateSchema.nullish(),
  monthlyContribution: z.number().min(0).nullish(),
});

// ---------- Accounts ----------
export async function listAccounts(userId: string) {
  const rows = await db
    .select({
      account: accounts,
      // NOTE: outer columns are qualified explicitly — Drizzle leaves them unqualified in single-table selects.
      inflow: sql<number>`coalesce((select sum(t.amount) from transactions t where t.user_id = accounts.user_id and ((t.type = 'income' and t.account_id = accounts.id) or (t.type = 'transfer' and t.to_account_id = accounts.id))),0)`,
      outflow: sql<number>`coalesce((select sum(t.amount) from transactions t where t.user_id = accounts.user_id and ((t.type = 'expense' and t.account_id = accounts.id) or (t.type = 'transfer' and t.account_id = accounts.id))),0)`,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.archived, false)))
    .orderBy(desc(accounts.isDefault), asc(accounts.name));
  return rows.map((r) => ({ ...r.account, balance: round2(r.account.openingBalance + Number(r.inflow) - Number(r.outflow)) }));
}
export async function createAccount(userId: string, input: z.infer<typeof accountSchema>) {
  if (input.isDefault) await db.update(accounts).set({ isDefault: false }).where(eq(accounts.userId, userId));
  const [a] = await db.insert(accounts).values({ ...input, userId }).returning();
  return a;
}
export async function updateAccount(userId: string, id: string, input: Partial<z.infer<typeof accountSchema>> & { archived?: boolean }) {
  if (input.isDefault) await db.update(accounts).set({ isDefault: false }).where(eq(accounts.userId, userId));
  const [a] = await db.update(accounts).set(input).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).returning();
  if (!a) throw notFound("Account");
  return a;
}
export async function deleteAccount(userId: string, id: string) {
  const r = await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).returning({ id: accounts.id });
  if (!r.length) throw notFound("Account");
}
async function defaultAccountId(userId: string) {
  const [a] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.archived, false))).orderBy(desc(accounts.isDefault), asc(accounts.createdAt)).limit(1);
  return a?.id ?? null;
}

// ---------- Categories ----------
export async function listCategories(userId: string) {
  return db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.archived, false))).orderBy(asc(categories.kind), asc(categories.name));
}
export async function createCategory(userId: string, input: z.infer<typeof categorySchema>) {
  const [c] = await db.insert(categories).values({ ...input, userId }).returning();
  return c;
}
export async function updateCategory(userId: string, id: string, input: Partial<z.infer<typeof categorySchema>> & { archived?: boolean }) {
  const [c] = await db.update(categories).set(input).where(and(eq(categories.id, id), eq(categories.userId, userId))).returning();
  if (!c) throw notFound("Category");
  return c;
}
/** Resolve a category by (case-insensitive) name; creates it when missing so AI entries never fail silently. */
export async function resolveCategory(userId: string, name: string, kind: "expense" | "income") {
  const [hit] = await db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.kind, kind), sql`lower(${categories.name}) = lower(${name})`)).limit(1);
  if (hit) return hit;
  return createCategory(userId, { name: name.trim(), kind });
}

// ---------- Transactions ----------
export async function listTransactions(userId: string, filter: { from?: string; to?: string; type?: string; categoryId?: string; accountId?: string; limit?: number; q?: string } = {}) {
  const conds = [eq(transactions.userId, userId)];
  if (filter.from) conds.push(gte(transactions.date, filter.from));
  if (filter.to) conds.push(lte(transactions.date, filter.to));
  if (filter.type) conds.push(eq(transactions.type, filter.type as "expense"));
  if (filter.categoryId) conds.push(eq(transactions.categoryId, filter.categoryId));
  if (filter.accountId) conds.push(eq(transactions.accountId, filter.accountId));
  if (filter.q) conds.push(sql`(${transactions.description} ilike ${"%" + filter.q + "%"} or ${transactions.merchant} ilike ${"%" + filter.q + "%"})`);
  return db
    .select({ tx: transactions, categoryName: categories.name, accountName: accounts.name })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...conds))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(filter.limit ?? 200)
    .then((rows) => rows.map((r) => ({ ...r.tx, categoryName: r.categoryName, accountName: r.accountName })));
}
export async function getTransaction(userId: string, id: string) {
  const [t] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!t) throw notFound("Transaction");
  return t;
}
export async function createTransaction(userId: string, input: z.infer<typeof transactionSchema>, tz?: string) {
  let categoryId = input.categoryId ?? null;
  if (!categoryId && input.category && input.type !== "transfer") categoryId = (await resolveCategory(userId, input.category, input.type)).id;
  const accountId = input.accountId ?? (await defaultAccountId(userId));
  if (input.type === "transfer" && !input.toAccountId) throw badRequest("Transfers need a destination account");
  const { category: _c, ...rest } = input;
  const [t] = await db
    .insert(transactions)
    .values({ ...rest, userId, categoryId, accountId, date: input.date ?? todayKey(tz), currency: input.currency ?? "EUR", amount: round2(input.amount) })
    .returning();
  return t;
}
export async function updateTransaction(userId: string, id: string, input: z.infer<typeof transactionUpdateSchema>) {
  const current = await getTransaction(userId, id);
  let categoryId = input.categoryId;
  if (categoryId === undefined && input.category) categoryId = (await resolveCategory(userId, input.category, (input.type ?? current.type) as "expense" | "income")).id;
  const { category: _c, ...rest } = input;
  const [t] = await db.update(transactions).set({ ...rest, ...(categoryId !== undefined ? { categoryId } : {}), ...(input.amount != null ? { amount: round2(input.amount) } : {}) }).where(and(eq(transactions.id, id), eq(transactions.userId, userId))).returning();
  return t;
}
export async function deleteTransaction(userId: string, id: string) {
  await getTransaction(userId, id);
  await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
}

// ---------- Summaries ----------
export async function financialSummary(userId: string, range: { from: string; to: string }) {
  const rows = await db
    .select({ type: transactions.type, categoryId: transactions.categoryId, categoryName: categories.name, total: sql<number>`sum(${transactions.amount})`, n: sql<number>`count(*)` })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), gte(transactions.date, range.from), lte(transactions.date, range.to), inArray(transactions.type, ["expense", "income"])))
    .groupBy(transactions.type, transactions.categoryId, categories.name);
  let income = 0, expenses = 0;
  const byCategory: { categoryId: string | null; name: string; total: number; count: number }[] = [];
  for (const r of rows) {
    const total = Number(r.total);
    if (r.type === "income") income += total;
    else { expenses += total; byCategory.push({ categoryId: r.categoryId, name: r.categoryName ?? "Uncategorized", total: round2(total), count: Number(r.n) }); }
  }
  byCategory.sort((a, b) => b.total - a.total);
  const net = round2(income - expenses);
  const savingsRate = income > 0 ? round2((net / income) * 100) : null;
  const budgetRows = await db.select({ b: budgets, categoryName: categories.name }).from(budgets).leftJoin(categories, eq(categories.id, budgets.categoryId)).where(eq(budgets.userId, userId));
  const budgetStatus = budgetRows.map((r) => {
    const spent = r.b.categoryId ? byCategory.find((c) => c.categoryId === r.b.categoryId)?.total ?? 0 : expenses;
    return { id: r.b.id, categoryId: r.b.categoryId, name: r.categoryName ?? "Total", amount: r.b.amount, period: r.b.period, spent: round2(spent), remaining: round2(r.b.amount - spent), pct: r.b.amount > 0 ? Math.round((spent / r.b.amount) * 100) : 0 };
  });
  const accts = await listAccounts(userId);
  const netWorth = round2(accts.reduce((a, b) => a + (b.type === "credit" ? -b.balance : b.balance), 0));
  return { range, income: round2(income), expenses: round2(expenses), net, savingsRate, byCategory, budgets: budgetStatus, accounts: accts, netWorth, source: "calculated" as const };
}

/** Daily totals for charts. */
export async function dailyFlow(userId: string, range: { from: string; to: string }) {
  const rows = await db
    .select({ date: transactions.date, type: transactions.type, total: sql<number>`sum(${transactions.amount})` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, range.from), lte(transactions.date, range.to), inArray(transactions.type, ["expense", "income"])))
    .groupBy(transactions.date, transactions.type)
    .orderBy(asc(transactions.date));
  return rows.map((r) => ({ date: r.date, type: r.type, total: round2(Number(r.total)) }));
}

export async function monthlyHistory(userId: string, months = 6) {
  const rows = await db
    .select({ month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`, type: transactions.type, total: sql<number>`sum(${transactions.amount})` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.type, ["expense", "income"]), gte(transactions.date, sql`(current_date - interval '${sql.raw(String(months))} months')::date`)))
    .groupBy(sql`1`, transactions.type)
    .orderBy(sql`1`);
  const map = new Map<string, { month: string; income: number; expenses: number }>();
  for (const r of rows) {
    const m = map.get(r.month) ?? { month: r.month, income: 0, expenses: 0 };
    if (r.type === "income") m.income = round2(Number(r.total)); else m.expenses = round2(Number(r.total));
    map.set(r.month, m);
  }
  return [...map.values()];
}

// ---------- Budgets ----------
export async function listBudgets(userId: string) {
  return db.select({ b: budgets, categoryName: categories.name }).from(budgets).leftJoin(categories, eq(categories.id, budgets.categoryId)).where(eq(budgets.userId, userId)).then((r) => r.map((x) => ({ ...x.b, categoryName: x.categoryName })));
}
export async function upsertBudget(userId: string, input: z.infer<typeof budgetSchema>) {
  const existing = await db.select().from(budgets).where(and(eq(budgets.userId, userId), input.categoryId ? eq(budgets.categoryId, input.categoryId) : sql`${budgets.categoryId} is null`)).limit(1);
  if (existing[0]) {
    const [b] = await db.update(budgets).set({ amount: input.amount, period: input.period }).where(eq(budgets.id, existing[0].id)).returning();
    return b;
  }
  const [b] = await db.insert(budgets).values({ ...input, userId }).returning();
  return b;
}
export async function deleteBudget(userId: string, id: string) {
  await db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.userId, userId)));
}

// ---------- Recurring ----------
export async function listRecurring(userId: string) {
  return db.select().from(recurringTransactions).where(eq(recurringTransactions.userId, userId)).orderBy(asc(recurringTransactions.nextDate));
}
export async function createRecurring(userId: string, input: z.infer<typeof recurringSchema>) {
  const [r] = await db.insert(recurringTransactions).values({ ...input, userId }).returning();
  return r;
}
export async function updateRecurring(userId: string, id: string, input: Partial<z.infer<typeof recurringSchema>>) {
  const [r] = await db.update(recurringTransactions).set(input).where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId))).returning();
  if (!r) throw notFound("Recurring transaction");
  return r;
}
export async function deleteRecurring(userId: string, id: string) {
  await db.delete(recurringTransactions).where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, userId)));
}
/** Materialize due recurring transactions (idempotent per nextDate). Called on dashboard load / by cron. */
export async function processRecurring(userId: string, tz?: string) {
  const today = todayKey(tz);
  const due = await db.select().from(recurringTransactions).where(and(eq(recurringTransactions.userId, userId), eq(recurringTransactions.active, true), lte(recurringTransactions.nextDate, today)));
  let created = 0;
  for (const r of due) {
    let next = r.nextDate;
    while (next <= today) {
      if (r.endDate && next > r.endDate) break;
      await db.insert(transactions).values({ userId, type: r.type, amount: r.amount, date: next, description: r.description, accountId: r.accountId, categoryId: r.categoryId, recurringId: r.id, source: "user" });
      created++;
      next = advance(next, r.frequency, r.dayOfMonth);
    }
    await db.update(recurringTransactions).set({ nextDate: next, active: r.endDate && next > r.endDate ? false : r.active }).where(eq(recurringTransactions.id, r.id));
  }
  return created;
}
function advance(date: string, frequency: string, dayOfMonth?: number | null) {
  if (frequency === "weekly") return addDaysKey(date, 7);
  const d = new Date(date + "T00:00:00Z");
  if (frequency === "yearly") { d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); }
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
  n.setUTCDate(Math.min(dayOfMonth ?? d.getUTCDate(), last));
  return n.toISOString().slice(0, 10);
}

// ---------- Savings goals ----------
export async function listSavingsGoals(userId: string) {
  return db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(asc(savingsGoals.deadline));
}
export async function createSavingsGoal(userId: string, input: z.infer<typeof savingsGoalSchema>) {
  const [g] = await db.insert(savingsGoals).values({ ...input, userId }).returning();
  return g;
}
export async function updateSavingsGoal(userId: string, id: string, input: Partial<z.infer<typeof savingsGoalSchema>>) {
  const [g] = await db.update(savingsGoals).set({ ...input, completedAt: input.currentAmount != null && input.targetAmount != null && input.currentAmount >= input.targetAmount ? new Date() : undefined }).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId))).returning();
  if (!g) throw notFound("Savings goal");
  return g;
}
export async function deleteSavingsGoal(userId: string, id: string) {
  await db.delete(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
}
