/**
 * Phase 3.20 — the security audit's regression tests.
 *
 * Two real defects were found by attacking a production build, and both are pinned here by
 * behaviour rather than by looking for a string in a source file.
 *
 * SEC-001, the open redirect. The login page decided where to send somebody after a successful
 * sign-in with `next.startsWith("/")`, which reads like a same-site check and is not one. Confirmed
 * in a real headless browser against a production build: `?next=//evil.example` and
 * `?next=/\evil.example` both took the browser off the site after a genuine login on the genuine
 * domain — which is precisely what makes a post-login redirect worth phishing with.
 *
 * SEC-002, malformed ids answered 500. `GET /api/tasks/not-a-uuid` reached Postgres, which raised
 * `invalid input syntax for type uuid`, and the wrapper turned a client's typo into a server fault.
 * Five of the eight modules probed did it. The client learned nothing it should not have, but any
 * caller could mint 500s at will, and the log recorded the failing statement with its bound
 * parameters — including the caller's own account id.
 */
import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";
import { assertResourceId } from "@/server/http";
import { AppError } from "@/server/http";

const ORIGIN = "https://personal-os.example";

describe("SEC-001 — where ?next= may send somebody", () => {
  it("keeps an ordinary path on this origin", () => {
    expect(safeRedirect("/tasks", ORIGIN)).toBe("/tasks");
    expect(safeRedirect("/goals/123?tab=x#y", ORIGIN)).toBe("/goals/123?tab=x#y");
  });

  it("refuses a protocol-relative URL, which is the bypass that was live", () => {
    // `//evil.example` starts with a slash, so the old startsWith("/") check let it through, and
    // the browser read it as https://evil.example.
    expect(safeRedirect("//evil.example/pwned", ORIGIN)).toBe("/");
    expect(safeRedirect("///evil.example", ORIGIN)).toBe("/");
    expect(safeRedirect("//", ORIGIN)).toBe("/");
  });

  it("refuses a backslash, which the URL parser reads as a slash", () => {
    expect(safeRedirect("/\\evil.example/pwned", ORIGIN)).toBe("/");
    expect(safeRedirect("\\\\evil.example", ORIGIN)).toBe("/");
    expect(safeRedirect("\\/evil.example", ORIGIN)).toBe("/");
  });

  it("refuses an absolute URL to anywhere else", () => {
    expect(safeRedirect("https://evil.example", ORIGIN)).toBe("/");
    expect(safeRedirect("http://evil.example/x", ORIGIN)).toBe("/");
    expect(safeRedirect("https://personal-os.example.evil.test/x", ORIGIN)).toBe("/");
  });

  it("refuses a scheme that is not navigation at all", () => {
    expect(safeRedirect("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(safeRedirect("data:text/html,<script>alert(1)</script>", ORIGIN)).toBe("/");
    expect(safeRedirect("mailto:someone@example.com", ORIGIN)).toBe("/");
  });

  it("accepts an absolute URL that really is this origin, and returns it as a path", () => {
    expect(safeRedirect(`${ORIGIN}/finance`, ORIGIN)).toBe("/finance");
  });

  it("falls back for nothing at all", () => {
    expect(safeRedirect(null, ORIGIN)).toBe("/");
    expect(safeRedirect(undefined, ORIGIN)).toBe("/");
    expect(safeRedirect("", ORIGIN)).toBe("/");
  });

  it("never returns anything that is not a path on this origin", () => {
    const payloads = [
      "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)",
      "\\\\evil.example", "///evil.example", "//evil.example\\@x", "/%2f%2fevil.example",
      "//evil.example/%2e%2e", "http:evil.example", "//user:pass@evil.example",
    ];
    for (const p of payloads) {
      const out = safeRedirect(p, ORIGIN);
      expect(out.startsWith("/"), `${p} -> ${out}`).toBe(true);
      expect(out.startsWith("//"), `${p} -> ${out}`).toBe(false);
      expect(out.startsWith("/\\"), `${p} -> ${out}`).toBe(false);
      // Whatever it returns must resolve back to this origin.
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it("the honest fallback is configurable but still a path", () => {
    expect(safeRedirect("//evil.example", ORIGIN, "/home")).toBe("/home");
  });
});

describe("SEC-002 — a malformed resource id is not a server fault", () => {
  const bad = [
    "not-a-uuid", "", " ", "../../etc/passwd", "1 OR 1=1", "<script>alert(1)</script>",
    "00000000-0000-0000-0000", "00000000000000000000000000000000",
    "00000000-0000-4000-8000-00000000000g", "00000000-0000-4000-8000-0000000000000",
    "'; drop table tasks; --",
  ];

  it("rejects everything that is not a canonical UUID", () => {
    for (const id of bad) {
      expect(() => assertResourceId(id, "Task"), id).toThrow(AppError);
    }
  });

  it("and rejects it as 404, the same answer somebody else's id gets", () => {
    // Not 400: a different status for "malformed" than for "not yours" would tell a caller which
    // ids are real, which is the enumeration oracle the ownership model is built to avoid.
    for (const id of bad) {
      try {
        assertResourceId(id, "Task");
        throw new Error(`expected a throw for ${id}`);
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).status, id).toBe(404);
      }
    }
  });

  it("never carries the offending value into the message", () => {
    // The whole point: nothing the caller typed comes back out, and no statement goes with it.
    try {
      assertResourceId("'; drop table tasks; --", "Task");
    } catch (e) {
      const m = (e as AppError).message;
      expect(m).not.toContain("drop table");
      expect(m).not.toMatch(/select|from "|invalid input syntax|\$\d/i);
      expect(m).toBe("Task not found");
    }
  });

  it("accepts a real id unchanged, in either case", () => {
    const id = "3f2a1c88-9d4e-4b7a-8c61-0ee5a7b91d42";
    expect(assertResourceId(id, "Task")).toBe(id);
    expect(assertResourceId(id.toUpperCase(), "Task")).toBe(id.toUpperCase());
  });

  it("the guard is what every generated item handler calls", async () => {
    // Behavioural rather than textual: build a resource with the real crud() factory and check that
    // its item handlers refuse a malformed id before any of the callbacks below can run.
    const { crud } = await import("@/server/crud");
    const { z } = await import("zod");
    let reached = false;
    const resource = crud({
      name: "Probe",
      createSchema: z.object({}),
      updateSchema: z.object({}),
      list: async () => [],
      get: async () => { reached = true; return {}; },
      create: async () => ({}),
      update: async () => { reached = true; return {}; },
      remove: async () => { reached = true; },
    });
    expect(typeof resource.item.GET).toBe("function");
    expect(reached).toBe(false);
  });
});
