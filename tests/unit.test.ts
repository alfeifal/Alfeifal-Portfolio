import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { nextOccurrence } from "@/server/services/tasks";
import { computeTradeMetrics } from "@/server/services/trading";
import { epley, cycleDayIndex } from "@/server/services/training";
import { ROUTINE_DAYS, ROUTINE_EXERCISE_COUNT, ROUTINE_META } from "@/server/training/routine";
import { rateLimit } from "@/server/security/rate-limit";
import { isTrustedOrigin } from "@/server/security/origin";
import { toCsv } from "@/server/services/export";
import { toInputSchema } from "@/server/ai/schema-json";
import { z } from "zod";

describe("password hashing", () => {
  it("hashes and verifies with scrypt", async () => {
    const h = await hashPassword("s3cret-password!");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("s3cret-password!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("task recurrence", () => {
  it("computes next occurrences", () => {
    expect(nextOccurrence("2026-09-14", "daily")).toBe("2026-09-15");
    expect(nextOccurrence("2026-09-18", "weekdays")).toBe("2026-09-21"); // Fri → Mon
    expect(nextOccurrence("2026-09-14", "weekly")).toBe("2026-09-21");
    expect(nextOccurrence("2026-09-14", "weekly:MO,WE")).toBe("2026-09-16");
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextOccurrence("2026-09-14", "monthly:15")).toBe("2026-10-15");
    expect(nextOccurrence("2026-09-14", "yearly")).toBe("2027-09-14");
    expect(nextOccurrence("2026-09-14", "nope")).toBeNull();
  });
});

describe("trade metrics", () => {
  it("calculates risk, pnl and R for longs and shorts", () => {
    expect(computeTradeMetrics({ direction: "long", entryPrice: 100, stopLoss: 95, quantity: 10, exitPrice: 110, fees: 2 })).toEqual({ riskAmount: 50, pnl: 98, rMultiple: 1.96 });
    expect(computeTradeMetrics({ direction: "short", entryPrice: 100, stopLoss: 105, quantity: 10, exitPrice: 90 })).toEqual({ riskAmount: 50, pnl: 100, rMultiple: 2 });
    expect(computeTradeMetrics({ direction: "long", entryPrice: 100 })).toEqual({ riskAmount: null, pnl: null, rMultiple: null });
  });
});

describe("training routine (source of truth)", () => {
  it("is transcribed faithfully: 8-day cycle, 6 workout days, 49 exercises", () => {
    expect(ROUTINE_META.cycleLength).toBe(8);
    expect(ROUTINE_DAYS).toHaveLength(8);
    expect(ROUTINE_DAYS.filter((d) => d.isRest).map((d) => d.label)).toEqual(["D4", "D8"]);
    expect(ROUTINE_EXERCISE_COUNT).toBe(49);
    expect(ROUTINE_DAYS.map((d) => d.exercises.length)).toEqual([7, 8, 7, 0, 7, 10, 10, 0]);
    const bench = ROUTINE_DAYS[0].exercises[0];
    expect(bench).toMatchObject({ name: "Press Banca con Barra", sets: 4, reps: "6", intensity: "PESADO", load: "65–75 kg", loadMin: 65, loadMax: 75, restSeconds: 180 });
    const farmer = ROUTINE_DAYS[5].exercises[9];
    expect(farmer).toMatchObject({ name: "Farmer's Carry", reps: "30–45 s", timed: true, loadMin: 28, loadMax: 32 });
    expect(ROUTINE_DAYS[6].exercises[2].reps).toBe("12/pierna");
  });
  it("maps dates onto the cycle", () => {
    const plan = { startDate: "2026-09-14", cycleLength: 8 };
    expect(cycleDayIndex(plan, "2026-09-14")).toBe(0);
    expect(cycleDayIndex(plan, "2026-09-17")).toBe(3); // rest
    expect(cycleDayIndex(plan, "2026-09-22")).toBe(0);
    expect(cycleDayIndex(plan, "2026-09-13")).toBe(7);
  });
  it("estimates 1RM with Epley", () => {
    expect(epley(100, 1)).toBe(100);
    expect(epley(80, 6)).toBeCloseTo(96, 0);
    expect(epley(0, 10)).toBe(0);
  });
});

describe("security helpers", () => {
  it("rate limits per key", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("t:a", 3, 1000).ok).toBe(true);
    expect(rateLimit("t:a", 3, 1000).ok).toBe(false);
    expect(rateLimit("t:b", 3, 1000).ok).toBe(true);
  });
  it("blocks cross-origin mutations", () => {
    const mk = (h: Record<string, string>, method = "POST") => new Request("https://app.example.com/api/x", { method, headers: h });
    expect(isTrustedOrigin(mk({ host: "app.example.com", origin: "https://app.example.com" }))).toBe(true);
    expect(isTrustedOrigin(mk({ host: "app.example.com", origin: "https://evil.com" }))).toBe(false);
    expect(isTrustedOrigin(mk({ host: "app.example.com" }))).toBe(false);
    expect(isTrustedOrigin(mk({ host: "app.example.com" }, "GET"))).toBe(true);
  });
});

describe("export & schema utils", () => {
  it("renders CSV with escaping", () => {
    expect(toCsv([{ a: 1, b: 'x,"y"' }, { a: 2, b: null }])).toBe('a,b\n1,"x,""y"""\n2,');
  });
  it("converts zod to JSON schema for tool definitions", () => {
    const js = toInputSchema(z.object({ amount: z.number().positive(), category: z.string().optional() }));
    expect(js.type).toBe("object");
    expect((js.properties as Record<string, unknown>).amount).toBeDefined();
    expect(js.required).toEqual(["amount"]);
  });
});
