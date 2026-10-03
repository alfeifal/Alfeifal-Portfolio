/**
 * Phase 3.26 — what the HTTP layer promises, below any single route.
 *
 * BUG-005: a signed-in non-administrator asking for `/admin` got **200** carrying the not-found page.
 * `notFound()` can only set a status while the response is uncommitted, and `src/app/(app)/loading.tsx`
 * is a Suspense fallback above every page in that group, so the shell had already been flushed.
 *
 * Measured against a production build on 2026-10-02, with two real accounts and real session cookies:
 *
 *   | request                                  | before | after |
 *   |------------------------------------------|--------|-------|
 *   | GET /admin, signed in, not an admin      | 200    | 404   |
 *   | GET /admin, signed in as an admin        | 200    | 200   |
 *   | GET /tasks, signed in                    | 200    | 200   |
 *   | GET /no-such-page (no route matches)     | 404    | 404   |
 *
 * That measurement needs a built server and two live sessions, so it is not re-run here. What is
 * pinned here is everything that can be: the matcher's semantics, the structural condition that
 * caused the bug — a page relying on `notFound()` underneath a Suspense fallback — and the fact that
 * the header the guard reads is written by the proxy and never taken from the client.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { PATHNAME_HEADER, ROLE_GUARDED_PATHS, requiredRole } from "@/server/auth/route-guards";
import { proxy } from "@/proxy";
import { isTrustedOrigin } from "@/server/security/origin";

const APP = join(process.cwd(), "src/app");

describe("the role-guarded path table", () => {
  it("covers /admin and its children", () => {
    expect(requiredRole("/admin")).toBe("admin");
    expect(requiredRole("/admin/users")).toBe("admin");
  });

  it("does not claim a path that merely starts with the same letters", () => {
    // `startsWith("/admin")` alone would match both of these, and both are ordinary pages.
    expect(requiredRole("/administration")).toBeNull();
    expect(requiredRole("/admin-tools")).toBeNull();
  });

  it("is null for an ordinary page, and for nothing at all", () => {
    expect(requiredRole("/tasks")).toBeNull();
    expect(requiredRole("")).toBeNull();
    expect(requiredRole(null)).toBeNull();
  });
});

/**
 * The structural rule, so the defect cannot come back through a different route.
 *
 * A page that decides "this does not exist" inside its own body cannot set a 404 if anything above it
 * streams first. Either there is no Suspense fallback above it, or the path is in the table that the
 * group's layout consults — and the layout runs before the flush.
 */
describe("no page relies on notFound() underneath a Suspense fallback", () => {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") pages.push(full);
    }
  };
  walk(APP);

  /** The path a page answers on: the route segments, minus groups like `(app)`. */
  const routeOf = (page: string) =>
    "/" + relative(APP, page).replace(/\/page\.tsx$/, "").split("/").filter((s) => !s.startsWith("(")).join("/");

  /** Does any ancestor folder, up to `src/app`, define a loading fallback? */
  const hasFallbackAbove = (page: string) => {
    let dir = join(page, "..");
    while (dir.startsWith(APP)) {
      try { statSync(join(dir, "loading.tsx")); return true; } catch { /* keep walking up */ }
      if (dir === APP) break;
      dir = join(dir, "..");
    }
    return false;
  };

  it("finds the pages to check at all", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it("every notFound() page is either unstreamed or covered by the table", () => {
    const offenders: string[] = [];
    for (const page of pages) {
      if (!/\bnotFound\(\)/.test(readFileSync(page, "utf8"))) continue;
      if (!hasFallbackAbove(page)) continue;
      const route = routeOf(page);
      if (!requiredRole(route)) offenders.push(`${relative(process.cwd(), page)} answers on ${route}`);
    }
    expect(offenders, "a page under a loading.tsx cannot set its own 404 — guard it in the layout instead").toEqual([]);
  });

  it("the page that prompted this is still guarded in both places", () => {
    const page = join(APP, "(app)/admin/page.tsx");
    // The page keeps its own check: the table fixes the status code, it is not the protection.
    expect(readFileSync(page, "utf8")).toMatch(/notFound\(\)/);
    expect(requiredRole("/admin")).toBe("admin");
    // And the layout above it is what consults the table.
    expect(readFileSync(join(APP, "(app)/layout.tsx"), "utf8")).toMatch(/requiredRole\(/);
  });
});

describe("the proxy stamps the path and never takes it from the client", () => {
  const get = (path: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(new URL(`http://localhost:3000${path}`), { headers: { cookie: "pos_session=whatever", ...headers } }));

  it("writes the real path onto the forwarded request", () => {
    const res = get("/admin");
    expect(res.headers.get("x-middleware-override-headers")).toContain(PATHNAME_HEADER);
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/admin");
  });

  it("replaces a header the client sent, rather than trusting it", () => {
    const res = get("/tasks", { [PATHNAME_HEADER]: "/admin" });
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/tasks");
  });

  it("still redirects a request with no session cookie, before any of this", () => {
    const res = proxy(new NextRequest(new URL("http://localhost:3000/admin")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("the table is not empty, so the guard is actually wired to something", () => {
    expect(ROLE_GUARDED_PATHS.length).toBeGreaterThan(0);
  });
});

/**
 * BUG-018 — the same-origin rule was written twice, and the two copies had drifted.
 *
 * `src/proxy.ts` carried its own inline version of the check that `server/security/origin.ts`
 * exports, kept deliberately as defence in depth. Probed on 2026-10-02, they disagreed twice:
 *
 *   | request                                                             | origin.ts | proxy |
 *   |---------------------------------------------------------------------|-----------|-------|
 *   | POST with `Referer: not a url`                                      | **threw** | 403   |
 *   | POST, `Origin: https://x.example:443`, `ALLOWED_ORIGINS=https://x.example` | true | **403** |
 *
 * The throw is the one that mattered: `isTrustedOrigin` is called by every mutating route inside a
 * try/catch that ends at `errorResponse`, which turns a `TypeError` into **500 Internal error**. A
 * malformed `Referer` header — which any client can send — answered 500 where it should have answered
 * 403, and logged to the server console on the way. Two copies of a security rule stop being defence
 * in depth the moment they disagree, so there is now one, and the proxy imports it.
 */
describe("the same-origin rule is one rule", () => {
  const post = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/tasks", { method: "POST", headers: { host: "localhost:3000", ...headers } });
  const viaProxy = (headers: Record<string, string>) =>
    proxy(new NextRequest(new URL("http://localhost:3000/api/tasks"), { method: "POST", headers: { host: "localhost:3000", cookie: "pos_session=x", ...headers } }));

  it("the proxy does not carry its own copy of the rule any more", () => {
    const src = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(src).toContain("isTrustedOrigin");
    // The giveaways of a second implementation: its own allow-list parsing and its own host compare.
    expect(src).not.toContain("ALLOWED_ORIGINS");
    expect(src).not.toMatch(/x-forwarded-host/);
  });

  it("a malformed Referer is untrusted, and does not throw", () => {
    expect(() => isTrustedOrigin(post({ referer: "not a url" }))).not.toThrow();
    expect(isTrustedOrigin(post({ referer: "not a url" }))).toBe(false);
    expect(viaProxy({ referer: "not a url" }).status).toBe(403);
  });

  it("a malformed Origin is untrusted, and does not throw", () => {
    expect(isTrustedOrigin(post({ origin: "://" }))).toBe(false);
    expect(viaProxy({ origin: "://" }).status).toBe(403);
  });

  it("an allowed origin written without its default port still matches", () => {
    const prev = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    try {
      const headers = { origin: "https://app.example.com:443" };
      // Both sides must agree, whichever answer is right — and the right answer is that these are
      // the same origin, because 443 is https's default port.
      expect(isTrustedOrigin(post(headers))).toBe(true);
      expect(viaProxy(headers).status).not.toBe(403);
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = prev;
    }
  });

  it("an origin that is neither the host nor allowed is blocked", () => {
    const prev = process.env.ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGINS;
    try {
      expect(isTrustedOrigin(post({ origin: "https://evil.example" }))).toBe(false);
      expect(viaProxy({ origin: "https://evil.example" }).status).toBe(403);
    } finally {
      if (prev !== undefined) process.env.ALLOWED_ORIGINS = prev;
    }
  });

  it("a write with no Origin and no Referer is blocked", () => {
    expect(isTrustedOrigin(post({}))).toBe(false);
    expect(viaProxy({}).status).toBe(403);
  });

  it("the matching host passes, and a read never needs an origin at all", () => {
    expect(isTrustedOrigin(post({ origin: "http://localhost:3000" }))).toBe(true);
    expect(isTrustedOrigin(new Request("http://localhost:3000/api/tasks", { headers: { host: "localhost:3000" } }))).toBe(true);
  });

  it("x-forwarded-host wins over host, as it must behind a proxy", () => {
    // Vercel terminates TLS and forwards; `host` is then the internal name, not what the browser used.
    expect(isTrustedOrigin(post({ origin: "https://personal.example", "x-forwarded-host": "personal.example" }))).toBe(true);
    expect(isTrustedOrigin(post({ origin: "http://localhost:3000", "x-forwarded-host": "personal.example" }))).toBe(false);
  });
});
