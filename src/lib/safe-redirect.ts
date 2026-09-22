/**
 * Where a `?next=` parameter is allowed to send somebody.
 *
 * The login page used `next.startsWith("/")`, which reads like a same-site check and is not one.
 * `//evil.example` starts with a slash and is a protocol-relative URL: the browser reads it as
 * `https://evil.example`. `/\evil.example` is the same hole through a different door, because the
 * URL parser treats a backslash as a slash under a special scheme. Both were confirmed in a real
 * browser against a production build: a genuine login on the genuine domain, and then the victim
 * lands wherever the link's author chose — which is exactly what makes a post-login redirect worth
 * phishing with.
 *
 * So the check is not textual. The candidate is resolved against the page's own origin and kept
 * only if it lands there, which is the one question actually being asked. That also disposes of
 * `javascript:` (it resolves to a null origin) and of anything else a URL can be.
 *
 * Pure, and takes the origin as an argument, so it can be tested without a browser.
 */
export function safeRedirect(raw: string | null | undefined, origin: string, fallback = "/"): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    // Rebuild from the parsed parts rather than echoing the input: whatever the caller wrote,
    // what comes back is a path on this origin and nothing else.
    const path = url.pathname + url.search + url.hash;
    return path.startsWith("/") ? path : fallback;
  } catch {
    // Not a URL at all, relative or otherwise.
    return fallback;
  }
}
