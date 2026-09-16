"use client";
import { useEffect, useState } from "react";

/**
 * Deep-linking into a list page.
 *
 * Search results point at rows that have no page of their own — a task, a transaction, a journal
 * entry. `?focus=<id>` says "this is the one": the row is scrolled into view and briefly highlighted,
 * so arriving from a search result actually lands on the record instead of on the module's front page.
 *
 * The highlight fades on its own so it does not linger as permanent UI state, and the id is read from
 * the URL rather than kept in state, so the link stays shareable.
 */
export function useFocusParam(ready: boolean, ms = 2600) {
  // Read lazily during the first render rather than in an effect: no extra render, and the value is
  // available to the very first paint of the list.
  const [id, setId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("focus");
  });

  useEffect(() => {
    if (!id || !ready) return;
    const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setId(null), ms);
    return () => clearTimeout(t);
  }, [id, ready, ms]);

  /** Spread onto the row: marks it for the scroll and carries the highlight class while it lasts. */
  return (rowId: string) => ({
    "data-focus-id": rowId,
    className: rowId === id ? "ring-2 ring-accent rounded-xl transition-shadow" : undefined,
  });
}
