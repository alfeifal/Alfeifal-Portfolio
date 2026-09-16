import { Skeleton, SkeletonCards, SkeletonStats } from "@/components/ui";

/**
 * Shown between a navigation starting and the route's own component mounting.
 *
 * It used to be a bare `<Spinner/>`, so every route change replaced the content with a dot in an
 * otherwise empty area. The shell survives a navigation, but the page the user asked for showed
 * nothing of itself until its JavaScript had loaded, hydrated and fetched.
 *
 * This is the shape almost every module opens with — a title, a row of figures and a list — so the
 * layout appears at once and the real content replaces it in place. It is deliberately generic: a
 * per-route skeleton would be a second copy of each page to keep in sync, and the point here is the
 * structure, not a pixel-accurate preview.
 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>
      <SkeletonStats n={4} />
      <SkeletonCards n={2} />
    </div>
  );
}
