/**
 * Phase 3.12 part B — the completeness gaps the audit found, pinned so they cannot reopen.
 *
 * Three of them mattered:
 *   · trading strategies could be created (a trade form creates one by typing a name) but never
 *     edited, and the route advertised PATCH while the handler had no `update`, so it answered 405;
 *   · the account's own audit trail had an endpoint and no screen;
 *   · deleting your own account walked straight past the last-administrator guards that deactivation
 *     and demotion both have, which would leave an instance with nobody able to administer it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteTestUser } from "./helpers";
import { allTools } from "@/server/ai/registry";
import "@/server/ai/tools";
import * as trading from "@/server/services/trading";

const hasDb = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

type U = Awaited<ReturnType<typeof createTestUser>>;

d("trading strategies are editable, not write-once", () => {
  let A: U;
  let B: U;

  beforeAll(async () => { A = await createTestUser(); B = await createTestUser(); });
  afterAll(async () => { if (A) await deleteTestUser(A.id); if (B) await deleteTestUser(B.id); });

  it("can be read back by id", async () => {
    const s = await trading.createStrategy(A.id, trading.strategySchema.parse({ name: "Breakout" }));
    expect((await trading.getStrategy(A.id, s.id)).name).toBe("Breakout");
  });

  it("can be renamed and filled in after the fact", async () => {
    const s = await trading.createStrategy(A.id, trading.strategySchema.parse({ name: "Typo nmae" }));
    const updated = await trading.updateStrategy(A.id, s.id, { name: "Pullback", rules: "Enter on the retest.", timeframes: "4H" });
    expect(updated.name).toBe("Pullback");
    expect(updated.rules).toBe("Enter on the retest.");
    expect(updated.timeframes).toBe("4H");
  });

  it("a partial edit leaves the other fields alone", async () => {
    const s = await trading.createStrategy(A.id, trading.strategySchema.parse({ name: "Keep", description: "original", rules: "r" }));
    const updated = await trading.updateStrategy(A.id, s.id, { timeframes: "D" });
    expect(updated.description).toBe("original");
    expect(updated.rules).toBe("r");
    expect(updated.name).toBe("Keep");
  });

  it("renaming keeps the trades attached, so history is not lost", async () => {
    const s = await trading.createStrategy(A.id, trading.strategySchema.parse({ name: "Old name" }));
    const account = (await trading.listTradingAccounts(A.id))[0];
    const t = await trading.addTrade(A.id, trading.tradeSchema.parse({ symbol: "AAA", direction: "long", accountId: account.id, strategyId: s.id, entryPrice: 10, quantity: 1 }));
    await trading.updateStrategy(A.id, s.id, { name: "New name" });
    const after = await trading.getTrade(A.id, t.id);
    expect(after.strategyId).toBe(s.id);
    const listed = await trading.listTrades(A.id, { mode: account.mode as "paper" });
    expect(listed.find((x) => x.id === t.id)?.strategyName).toBe("New name");
  });

  it("archiving hides it from the list without touching the trades", async () => {
    const s = await trading.createStrategy(A.id, trading.strategySchema.parse({ name: "Retire me" }));
    await trading.deleteStrategy(A.id, s.id);
    expect((await trading.listStrategies(A.id)).some((x) => x.id === s.id)).toBe(false);
    // Still readable by id, so a trade that names it can still be explained.
    expect((await trading.getStrategy(A.id, s.id)).archived).toBe(true);
  });

  it("belongs to one account", async () => {
    const s = await trading.createStrategy(B.id, trading.strategySchema.parse({ name: "B's edge" }));
    await expect(trading.getStrategy(A.id, s.id)).rejects.toMatchObject({ status: 404 });
    await expect(trading.updateStrategy(A.id, s.id, { name: "hijacked" })).rejects.toMatchObject({ status: 404 });
    await expect(trading.deleteStrategy(A.id, s.id)).rejects.toMatchObject({ status: 404 });
    expect((await trading.getStrategy(B.id, s.id)).name).toBe("B's edge");
    expect((await trading.getStrategy(B.id, s.id)).archived).toBe(false);
  });

  it("an unknown id fails the same way a foreign one does", async () => {
    await expect(trading.getStrategy(A.id, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});

describe("the strategy route and tools match the service", () => {
  it("the route no longer advertises methods the handler cannot serve", () => {
    const handlers = read("src/app/api/trading/_handlers.ts");
    const line = handlers.split("\n").find((l) => l.includes('name: "trading.strategies"'))!;
    expect(line).toContain("get:");
    expect(line).toContain("update:");
    expect(line).toContain("remove:");
    expect(line).not.toContain("updateSchema: z.object({})");
  });

  it("the assistant can list and edit a strategy, not only create and archive", () => {
    const names = allTools().map((t) => t.name);
    for (const n of ["create_strategy", "list_strategies", "update_strategy", "delete_strategy"]) expect(names).toContain(n);
    expect(allTools().find((t) => t.name === "list_strategies")!.risk).toBe("read");
    expect(allTools().find((t) => t.name === "update_strategy")!.risk).toBe("low");
    expect(allTools().find((t) => t.name === "delete_strategy")!.risk).toBe("medium");
  });

  it("the trading page exposes them", () => {
    const page = read("src/app/(app)/trading/page.tsx");
    expect(page).toContain('"/api/trading/strategies"');
    expect(page).toContain('value: "strategies"');
    expect(page).toContain("setEditingStrategy");
  });
});

describe("gaps between a finished backend and the screens", () => {
  it("the account's audit trail is on a screen, not only on an endpoint", () => {
    const settings = read("src/app/(app)/settings/page.tsx");
    expect(settings).toContain('"/api/me/audit"');
    expect(settings).toContain("Account activity");
  });

  it("deleting your own account cannot orphan the instance", () => {
    const route = read("src/app/api/me/delete/route.ts");
    expect(route).toContain("activeAdminCount");
    expect(route).toContain("isAdmin(user)");
    // Order inside the handler: consent first, then the guard, and only then the deletion.
    const body = route.slice(route.indexOf("export const POST"));
    expect(body.indexOf("verifyPassword")).toBeLessThan(body.indexOf("activeAdminCount"));
    expect(body.indexOf("activeAdminCount")).toBeLessThan(body.indexOf("deleteAccountAndData"));
  });

  it("errors on the delete form reach the user instead of a bare alert", () => {
    const settings = read("src/app/(app)/settings/page.tsx");
    const form = settings.slice(settings.indexOf("/api/me/delete"));
    expect(form.slice(0, 400)).toContain("toast.error");
  });
});
