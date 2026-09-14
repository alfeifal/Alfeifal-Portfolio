"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { T } from "@/components/motion";
import { useToast } from "@/components/toast";
import { useSearchParams } from "next/navigation";
import { ErrorBox, Field, Modal, PageHeader, Skeleton, Source, Button, useConfirm } from "@/components/ui";
import { addDays, api, fmtDate, fmtTime, toLocalIso, todayLocal, useApi } from "@/lib/client";
import type { EventItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS = ["event", "work", "training", "study", "german", "personal", "deadline", "reminder", "meal", "market"];
const KIND_COLORS: Record<string, string> = { work: "bg-accent/15", training: "bg-positive/15", study: "bg-warning/15", german: "bg-primary/15", deadline: "bg-negative/15", personal: "bg-surface-2", event: "bg-surface-2", reminder: "bg-surface-2", meal: "bg-surface-2", market: "bg-surface-2" };
type View = "day" | "week" | "month";

function startOfWeek(key: string) { const d = new Date(key + "T00:00:00"); const dow = (d.getDay() + 6) % 7; return addDays(key, -dow); }
function monthGrid(key: string) { const first = key.slice(0, 8) + "01"; const start = startOfWeek(first); return [...Array(42)].map((_, i) => addDays(start, i)); }

function CalendarInner() {
  const sp = useSearchParams();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [saving, setSaving] = useState(false);
  const [dir, setDir] = useState(1);
  const [view, setView] = useState<View>((sp.get("view") as View) || "week");
  const [date, setDate] = useState(sp.get("date") ?? todayLocal());
  const range = useMemo(() => {
    if (view === "day") return { from: date, to: addDays(date, 1) };
    if (view === "week") { const s = startOfWeek(date); return { from: s, to: addDays(s, 7) }; }
    const g = monthGrid(date); return { from: g[0], to: addDays(g[41], 1) };
  }, [view, date]);
  const events = useApi<EventItem[]>(`/api/events?from=${range.from}T00:00:00&to=${range.to}T00:00:00`, [range.from, range.to]);
  const [editing, setEditing] = useState<Partial<EventItem> | null>(null);
  const [form, setForm] = useState({ title: "", kind: "event", date: date, start: "09:00", end: "10:00", allDay: false, description: "", location: "" });
  const [error, setError] = useState("");
  const openNew = (d = date, hour?: number) => { setForm({ title: "", kind: "event", date: d, start: hour != null ? `${String(hour).padStart(2, "0")}:00` : "09:00", end: hour != null ? `${String(hour + 1).padStart(2, "0")}:00` : "10:00", allDay: false, description: "", location: "" }); setEditing({}); };
  const openEdit = (e: EventItem) => { const s = new Date(e.startAt), en = new Date(e.endAt); setForm({ title: e.title, kind: e.kind, date: toLocalIso(s).slice(0, 10), start: toLocalIso(s).slice(11, 16), end: toLocalIso(en).slice(11, 16), allDay: e.allDay, description: e.description ?? "", location: e.location ?? "" }); setEditing(e); };
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setError(""); setSaving(true);
    const body = { title: form.title, kind: form.kind, allDay: form.allDay, startAt: form.allDay ? `${form.date}T00:00:00` : `${form.date}T${form.start}:00`, endAt: form.allDay ? `${addDays(form.date, 1)}T00:00:00` : `${form.date}T${form.end}:00`, description: form.description || null, location: form.location || null };
    try { if (editing?.id) { await api(`/api/events/${editing.id}`, { method: "PATCH", json: body }); toast.success("Event updated", form.title); } else { await api("/api/events", { method: "POST", json: body }); toast.success("Event added", `${form.title} · ${fmtDate(form.date)}`); } setEditing(null); events.refresh(); } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };
  const remove = () => { if (!editing?.id) return; const id = editing.id; confirm(async () => { await api(`/api/events/${id}`, { method: "DELETE" }); setEditing(null); toast.success("Event deleted"); events.refresh(); }, { title: "Delete this event?", description: editing.title }); };
  const move = (n: number) => { setDir(n); setDate(view === "day" ? addDays(date, n) : view === "week" ? addDays(date, 7 * n) : (() => { const d = new Date(date + "T00:00:00"); d.setMonth(d.getMonth() + n); return toLocalIso(d).slice(0, 10); })()); };
  const byDay = (k: string) => (events.data ?? []).filter((e) => toLocalIso(new Date(e.startAt)).slice(0, 10) <= k && toLocalIso(new Date(new Date(e.endAt).getTime() - 1)).slice(0, 10) >= k);
  const days = view === "day" ? [date] : view === "week" ? [...Array(7)].map((_, i) => addDays(range.from, i)) : monthGrid(date);
  const today = todayLocal();
  useEffect(() => { if (sp.get("new")) openNew(); }, []);
  return (
    <div>
      <PageHeader title="Calendar" subtitle={view === "month" ? fmtDate(date, { month: "long", year: "numeric" }) : `${fmtDate(range.from)} – ${fmtDate(addDays(range.to, -1))}`} action={<><button className="btn-ghost btn-sm" onClick={() => move(-1)}>←</button><button className="btn-ghost btn-sm" onClick={() => setDate(today)}>Today</button><button className="btn-ghost btn-sm" onClick={() => move(1)}>→</button><select className="field !w-auto !py-1.5 text-sm" value={view} onChange={(e) => setView(e.target.value as View)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select><button className="btn-primary btn-sm" onClick={() => openNew()}>+ Event</button></>} />
      {events.error && <ErrorBox error={events.error} retry={events.reload} />}
      {events.loading && !events.data && <div className="grid gap-2 md:grid-cols-7">{[...Array(view === "day" ? 1 : 7)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>}
      <AnimatePresence mode="popLayout" initial={false}>
      <m.div key={view + range.from} initial={{ opacity: 0, x: 12 * dir }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 * dir, transition: T.exit }} transition={T.enter}>
      {view === "month" ? (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-medium muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1">{d}</div>)}</div>
          <div className="grid grid-cols-7">{days.map((k) => <button key={k} onClick={() => { setDate(k); setView("day"); }} className={cn("min-h-[72px] border-b border-r border-border p-1 text-left align-top", k.slice(0, 7) !== date.slice(0, 7) && "opacity-40", k === today && "bg-accent/5")}><span className={cn("text-xs", k === today && "font-semibold")}>{Number(k.slice(8))}</span>{byDay(k).slice(0, 3).map((e) => <span key={e.id} className={cn("mt-0.5 block truncate rounded px-1 text-[10px]", KIND_COLORS[e.kind])}>{e.title}</span>)}{byDay(k).length > 3 && <span className="text-[10px] muted">+{byDay(k).length - 3}</span>}</button>)}</div>
        </div>
      ) : (
        <div className={cn("grid gap-2", view === "week" && "md:grid-cols-7")}>
          {days.map((k) => (
            <div key={k} className={cn("card p-2", k === today && "border-accent")}>
              <div className="mb-1 flex items-center justify-between"><button className="text-sm font-semibold" onClick={() => { setDate(k); setView("day"); }}>{fmtDate(k, { weekday: "short", day: "numeric" })}</button><button className="text-xs muted hover:text-fg" onClick={() => openNew(k)}>+</button></div>
              {byDay(k).length === 0 && <p className="text-xs muted">—</p>}
              <ul className="space-y-1">{byDay(k).sort((a, b) => a.startAt.localeCompare(b.startAt)).map((e) => <li key={e.id}><m.button whileHover={{ x: 1 }} whileTap={{ scale: 0.98 }} transition={T.state} onClick={() => openEdit(e)} className={cn("w-full rounded-lg px-2 py-1 text-left text-xs transition-shadow hover:shadow-sm", KIND_COLORS[e.kind])}><span className="font-medium">{e.allDay ? "All day" : `${fmtTime(e.startAt)}–${fmtTime(e.endAt)}`}</span><span className="block truncate">{e.title}</span></m.button></li>)}</ul>
              {view === "day" && <div className="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-8">{[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((h) => <button key={h} className="rounded border border-border py-1 text-[11px] muted hover:bg-surface-2" onClick={() => openNew(k, h)}>{h}:00</button>)}</div>}
            </div>
          ))}
        </div>
      )}
      </m.div>
      </AnimatePresence>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit event" : "New event"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Title"><input className="field" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind"><select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="Date"><input className="field" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            {!form.allDay && <><Field label="Start"><input className="field" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></Field><Field label="End"><input className="field" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></Field></>}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />All day</label>
          <Field label="Location"><input className="field" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="field" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {editing?.source === "ai" && <p className="text-xs muted">Created by <Source source="ai" /></p>}
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-between">{editing?.id ? <Button type="button" className="text-negative" onClick={remove}>Delete</Button> : <span />}<Button variant="primary" type="submit" loading={saving}>Save</Button></div>
        </form>
      </Modal>
      {dialog}
    </div>
  );
}
export default function CalendarPage() { return <Suspense><CalendarInner /></Suspense>; }
