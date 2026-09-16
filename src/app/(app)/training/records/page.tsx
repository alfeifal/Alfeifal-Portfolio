import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { listPersonalRecords } from "@/server/services/training";
import { requireUser } from "@/server/page-data";
import { fmtDateServer } from "@/lib/format";

/**
 * Personal records — a Server Component.
 *
 * The page has no forms, no handlers and no state: it reads a list and prints it. As a Client
 * Component it shipped its own chunk and could only fetch after the bundle had downloaded and
 * hydrated, so the records appeared a round trip after the page did. Rendered on the server the rows
 * are in the HTML that answers the navigation, and the page contributes no JavaScript of its own.
 */
export default async function RecordsPage() {
  const user = await requireUser();
  const prs = await listPersonalRecords(user.id);

  const byExercise = new Map<string, typeof prs>();
  for (const p of prs) byExercise.set(p.exerciseName, [...(byExercise.get(p.exerciseName) ?? []), p]);

  return (
    <div className="space-y-3">
      <PageHeader back={{ href: "/training", label: "Training" }} title="Personal records" subtitle="Calculated from your logged sets (Epley for estimated 1RM)." />
      {prs.length === 0 ? (
        <Empty>No records yet — log your first sets.</Empty>
      ) : (
        <ul className="card divide-y divide-border">
          {[...byExercise.entries()].map(([name, list]) => (
            <li key={name} className="px-3 py-2 text-sm">
              <Link href={`/training/exercises/${list[0].exerciseId}`} className="font-medium hover:underline">{name}</Link>
              <p className="text-xs muted">
                {list.map((p) => `${p.kind.replace(/_/g, " ")}: ${p.value}${p.weightKg != null && p.reps != null ? ` (${p.weightKg}×${p.reps})` : ""} · ${fmtDateServer(p.achievedAt)}`).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
