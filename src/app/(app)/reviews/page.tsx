"use client";
import { Suspense, useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Sparkles, FileText, StickyNote, ChevronDown, AlertCircle } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, Tabs } from "@/components/ui";
import { T, V } from "@/components/motion";
import { useToast } from "@/components/toast";
import { api, fmtDate, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { cn } from "@/lib/utils";

type ReviewType = "weekly" | "monthly";
type Sufficiency = "ok" | "insufficient" | "none";
interface Observation { module: string; kind: "fact" | "trend" | "gap"; text: string; evidence: Record<string, number | string | null> }
interface Insight { text: string; metric: string; kind: "observation" | "suggestion"; source: "ai" }
interface Section { data: Sufficiency; [k: string]: unknown }
interface Review {
  id: string; type: ReviewType; periodStart: string; periodEnd: string; status: "generated" | "reviewed";
  facts: Record<string, Section> & { period: { from: string; to: string; days: number } };
  trends: Record<string, unknown>; observations: Observation[];
  aiInsights: Insight[] | null; aiGeneratedAt: string | null; userNotes: string | null; generatedAt: string;
}

const MODULE_LABEL: Record<string, string> = {
  productivity: "Productivity", training: "Training", nutrition: "Nutrition", finance: "Finance",
  studies: "Studies", goals: "Goals", projects: "Projects", journal: "Journal", calendar: "Calendar",
};
const ORDER = ["productivity", "training", "nutrition", "finance", "studies", "goals", "projects", "journal", "calendar"];

/** The period containing today, as the API resolves it — used to label the Generate button. */
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function ObservationRow({ o }: { o: Observation }) {
  const tone = o.kind === "gap" ? "muted" : o.kind === "trend" ? "accent" : "positive";
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <Badge tone={tone === "muted" ? "muted" : tone === "accent" ? "accent" : "muted"}>{o.kind}</Badge>
      <span className={cn("min-w-0 flex-1", o.kind === "gap" && "muted")}>{o.text}</span>
    </li>
  );
}

function SectionCard({ module, facts, observations }: { module: string; facts: Section | undefined; observations: Observation[] }) {
  const obs = observations.filter((o) => o.module === module);
  if (!facts && !obs.length) return null;
  const state = facts?.data ?? "none";
  return (
    <Card title={<span className="flex items-center gap-2">{MODULE_LABEL[module] ?? module}{state !== "ok" && <Badge tone={state === "none" ? "muted" : "warning"}>{state === "none" ? "No data" : "Insufficient data"}</Badge>}</span>}>
      {obs.length ? <ul className="divide-y divide-border">{obs.map((o, i) => <ObservationRow key={i} o={o} />)}</ul> : <p className="text-sm muted">Nothing recorded for this period.</p>}
    </Card>
  );
}

function NotesEditor({ review, onSaved }: { review: Review; onSaved: (r: Review) => void }) {
  const toast = useToast();
  const [text, setText] = useState(review.userNotes ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = (review.userNotes ?? "") !== text;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api<Review>(`/api/reviews/${review.id}/notes`, { method: "PUT", json: { userNotes: text.trim() || null } });
      onSaved(r); toast.success(text.trim() ? "Note saved" : "Note cleared");
    } catch (e) { toast.error("Could not save the note", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><StickyNote size={15} />Your notes</span>}>
      <textarea
        className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000}
        placeholder="Anything the numbers cannot know — “I was on holiday this week”."
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs muted">Kept separate from the metrics. Regenerating never overwrites this.</span>
        <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

function ReviewDetail({ review, onChanged }: { review: Review; onChanged: (r: Review) => void }) {
  const { aiConfigured } = useShell();
  const toast = useToast();
  const [busyAi, setBusyAi] = useState(false);
  const [showFacts, setShowFacts] = useState(false);
  const insights = review.aiInsights ?? [];

  const runAi = async () => {
    setBusyAi(true);
    try {
      const r = await api<Review>(`/api/reviews/${review.id}/insights`, { method: "POST" });
      onChanged(r);
      toast[(r.aiInsights?.length ?? 0) > 0 ? "success" : "info"]((r.aiInsights?.length ?? 0) > 0 ? `${r.aiInsights!.length} AI insights added` : "The data did not support any insight");
    } catch (e) { toast.error("AI insights failed", (e as Error).message); } finally { setBusyAi(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {ORDER.map((mod) => <SectionCard key={mod} module={mod} facts={review.facts[mod] as Section | undefined} observations={review.observations} />)}
      </div>

      <Card title={<span className="flex items-center gap-2"><Sparkles size={15} />AI insights</span>} action={<Button size="sm" loading={busyAi} disabled={!aiConfigured} onClick={runAi}>{insights.length ? "Regenerate" : "Generate"}</Button>}>
        {!aiConfigured && <p className="text-sm muted">The AI is not configured. Everything above is computed from your records and does not need it.</p>}
        {aiConfigured && !insights.length && <p className="text-sm muted">No AI insights yet. They are the model&apos;s reading of the numbers above — clearly separate from the measured facts.</p>}
        {insights.length > 0 && (
          <ul className="space-y-2">
            {insights.map((i, n) => (
              <li key={n} className="rounded-xl border border-accent/30 bg-accent/5 p-2.5 text-sm">
                <span className="flex items-start gap-2">
                  <Badge tone="accent">{i.kind}</Badge>
                  <span className="min-w-0 flex-1">{i.text}</span>
                </span>
                <span className="mt-1 block text-[11px] muted">based on {i.metric}</span>
              </li>
            ))}
          </ul>
        )}
        {review.aiGeneratedAt && <p className="mt-2 text-[11px] muted">AI-generated {fmtDate(review.aiGeneratedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}. Interpretation, not measurement.</p>}
      </Card>

      {/* Keyed on the saved note so a different review — or a save — starts from the stored text. */}
      <NotesEditor key={`${review.id}:${review.userNotes ?? ""}`} review={review} onSaved={onChanged} />

      <Card>
        <button className="flex w-full items-center gap-2 text-left text-sm" onClick={() => setShowFacts((v) => !v)}>
          <FileText size={15} className="muted" />
          <span className="flex-1 font-medium">Measured facts</span>
          <ChevronDown size={14} className={cn("muted transition-transform", showFacts && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {showFacts && (
            <m.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={T.state} className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px]">
              {JSON.stringify({ facts: review.facts, trends: review.trends }, null, 1)}
            </m.pre>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}

function ReviewsPage() {
  const toast = useToast();
  const [type, setType] = useState<ReviewType>("weekly");
  const [date, setDate] = useState(todayIso());
  // Deep link from a search result, read during the first render rather than in an effect.
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("review")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useApi<Review[]>(`/api/reviews?type=${type}&limit=24`, [type]);

  const open = useMemo(() => list.data?.find((r) => r.id === openId) ?? null, [list.data, openId]);

  const generate = async () => {
    setBusy(true); setError("");
    try {
      const r = await api<Review>("/api/reviews", { method: "POST", json: { type, date } });
      await list.refresh();
      setOpenId(r.id);
      toast.success(`${type === "weekly" ? "Weekly" : "Monthly"} review ready`, `${r.periodStart} → ${r.periodEnd}`);
    } catch (e) { setError((e as Error).message); toast.error("Could not generate the review", (e as Error).message); } finally { setBusy(false); }
  };

  const patch = (r: Review) => { list.setData((prev) => (prev ?? []).map((x) => (x.id === r.id ? r : x))); };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reviews"
        subtitle="Computed from your own records. Facts, trends and observations are measured; AI insights are labelled separately."
        action={<Button variant="primary" size="sm" loading={busy} loadingText="Generating" onClick={generate}>Generate</Button>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={type} onChange={(v) => { setType(v); setOpenId(null); }} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} />
        <label className="flex items-center gap-2 text-xs muted">
          <span className="whitespace-nowrap">Period containing</span>
          <input type="date" className="field !w-auto !py-1 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="flex items-center gap-2 text-sm text-negative"><AlertCircle size={14} />{error}</p>}
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Spinner />}

      {list.data && list.data.length === 0 && (
        <Empty title="No reviews yet">Pick a period and press Generate. The numbers come from your records — no API key needed.</Empty>
      )}

      {list.data && list.data.length > 0 && (
        <m.div className="space-y-2" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}>
          {list.data.map((r) => (
            <m.div key={r.id} variants={V.riseSm} transition={T.enter}>
              <Card className="p-0">
                <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.type === "monthly" ? r.periodStart.slice(0, 7) : `${fmtDate(r.periodStart)} → ${fmtDate(r.periodEnd)}`}</span>
                    <span className="block text-xs muted">{(r.observations ?? []).length} observations · generated {fmtDate(r.generatedAt, { day: "numeric", month: "short" })}</span>
                  </span>
                  {r.userNotes && <Badge>note</Badge>}
                  {r.aiInsights?.length ? <Badge tone="accent">AI</Badge> : null}
                  <ChevronDown size={15} className={cn("muted transition-transform", openId === r.id && "rotate-180")} />
                </button>
              </Card>
              <AnimatePresence initial={false}>
                {openId === r.id && open && (
                  <m.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={T.enter} className="mt-2">
                    <ReviewDetail review={open} onChanged={patch} />
                  </m.div>
                )}
              </AnimatePresence>
            </m.div>
          ))}
        </m.div>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="p-6"><Spinner /></div>}><ReviewsPage /></Suspense>;
}
