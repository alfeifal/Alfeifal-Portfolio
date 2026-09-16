"use client";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { MiniBars as MiniBarsImpl, MiniLine as MiniLineImpl } from "./charts-impl";

/**
 * Charts, loaded on demand.
 *
 * Recharts is a single 377 kB chunk and it was being pulled into the first load of eight routes —
 * /finance, /training, /nutrition, /studies, /trading, /investing, /analytics and a training detail
 * page — taking them to ~1.2 MB of JavaScript against ~800 kB elsewhere. No chart is above the fold on
 * any of them: the numbers, lists and forms a page opens on do not need it.
 *
 * Splitting it here rather than at each call site keeps every `<MiniBars/>` and `<MiniLine/>` exactly
 * as it was; only the moment the library arrives changes. `ssr: false` because Recharts measures the
 * DOM to size itself, so server-rendering it produces markup the client immediately throws away.
 */
const Placeholder = ({ height }: { height?: number }) => (
  <div className="animate-pulse rounded-xl bg-surface-2" style={{ height: height ?? 180 }} aria-hidden />
);

export const MiniBars = dynamic(() => import("./charts-impl").then((m) => m.MiniBars), {
  ssr: false,
  loading: () => <Placeholder />,
}) as typeof MiniBarsImpl;

export const MiniLine = dynamic(() => import("./charts-impl").then((m) => m.MiniLine), {
  ssr: false,
  loading: () => <Placeholder />,
}) as typeof MiniLineImpl;

export type MiniBarsProps = ComponentProps<typeof MiniBarsImpl>;
export type MiniLineProps = ComponentProps<typeof MiniLineImpl>;
