"use client";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

/**
 * The integrated German course (original project preserved in src/modules/german).
 * Client-only: it uses react-router, IndexedDB, speech synthesis and its own Zustand store.
 */
const GermanApp = dynamic(() => import("@/modules/german/ui/App").then((m) => m.App), { ssr: false, loading: () => <Spinner label="Loading Deutsch…" /> });

export default function GermanPage() {
  return <GermanApp />;
}
