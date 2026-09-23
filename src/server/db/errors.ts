/**
 * Postgres error classification.
 *
 * Both drivers this app uses (node-postgres and @neondatabase/serverless) surface the server's
 * SQLSTATE verbatim on `error.code`, so the check itself is driver-independent — but Drizzle wraps
 * driver failures in a `DrizzleQueryError` and hangs the original off `cause`, so the code can sit
 * one or more links down the chain.
 */
const UNIQUE_VIOLATION = "23505";

function hasCode(e: unknown, code: string): boolean {
  for (let cur = e, depth = 0; cur && depth < 5; cur = (cur as { cause?: unknown }).cause, depth++) {
    if (typeof cur !== "object") return false;
    if ((cur as { code?: unknown }).code === code) return true;
  }
  return false;
}

export const isUniqueViolation = (e: unknown) => hasCode(e, UNIQUE_VIOLATION);
