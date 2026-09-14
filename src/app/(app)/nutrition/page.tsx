"use client";
import { useState } from "react";
import { Badge, Bar, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Source } from "@/components/ui";
import { addDays, api, fmtDate, fmtNum, todayLocal, useApi } from "@/lib/client";
import { useShell } from "@/components/shell/Shell";
import { MiniBars } from "@/components/charts";

interface Entry { id: string; description: string; quantity: number; unit: string; calories: number; protein: number; carbs: number; fat: number; source: string; confidence: number | null }
interface Day { date: string; meals: { id: string; type: string; name: string | null; loggedAt: string; source: string; items: Entry[] }[]; totals: { calories: number; protein: number; carbs: number; fat: number }; goals: { calories: number; protein: number; carbs: number; fat: number }; estimatedItems: number; exactItems: number }
interface Summary { daily: { date: string; calories: number; protein: number }[]; average: { calories: number; protein: number; carbs: number; fat: number }; daysLogged: number }
interface Food { id: string; name: string; calories: number; protein: number; carbs: number; fat: number; servingGrams: number | null; source: string }
const blankItem = { description: "", quantity: "1", unit: "serving", calories: "", protein: "", carbs: "", fat: "", source: "user" };

export default function NutritionPage() {
  const { aiConfigured } = useShell();
  const [date, setDate] = useState(todayLocal());
  const day = useApi<Day>(`/api/nutrition/day?date=${date}`, [date]);
  const summary = useApi<Summary>("/api/nutrition/summary");
  const foods = useApi<Food[]>("/api/nutrition/foods");
  const [modal, setModal] = useState<null | "meal" | "goals" | "food" | "quick">(null);
  const [meal, setMeal] = useState({ type: "lunch", name: "", items: [{ ...blankItem }] });
  const [goals, setGoals] = useState({ calories: "", protein: "", carbs: "", fat: "" });
  const [food, setFood] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "", servingGrams: "" });
  const [quick, setQuick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = day.data;
  const all = () => { day.refresh(); summary.refresh(); foods.refresh(); };
  const saveMeal = async (e: React.FormEvent) => { e.preventDefault(); setError(""); try { await api("/api/nutrition/meals", { method: "POST", json: { date, type: meal.type, name: meal.name || null, items: meal.items.filter((i) => i.description).map((i) => ({ description: i.description, quantity: Number(i.quantity || 1), unit: i.unit, calories: Number(i.calories || 0), protein: Number(i.protein || 0), carbs: Number(i.carbs || 0), fat: Number(i.fat || 0), source: i.source })) } }); setModal(null); setMeal({ type: "lunch", name: "", items: [{ ...blankItem }] }); all(); } catch (err) { setError((err as Error).message); } };
  const saveGoals = async (e: React.FormEvent) => { e.preventDefault(); await api("/api/nutrition/goals", { method: "PATCH", json: { calories: Number(goals.calories), protein: Number(goals.protein), carbs: Number(goals.carbs), fat: Number(goals.fat) } }); setModal(null); all(); };
  const saveFood = async (e: React.FormEvent) => { e.preventDefault(); await api("/api/nutrition/foods", { method: "POST", json: { name: food.name, calories: Number(food.calories), protein: Number(food.protein || 0), carbs: Number(food.carbs || 0), fat: Number(food.fat || 0), servingGrams: food.servingGrams ? Number(food.servingGrams) : null } }); setModal(null); setFood({ name: "", calories: "", protein: "", carbs: "", fat: "", servingGrams: "" }); all(); };
  const quickLog = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setError(""); try { const r = await api<{ text: string }>("/api/ai/quick", { method: "POST", json: { text: `${quick} (log this as a meal for ${date}; estimate macros and mark them as estimated)` } }); alert(r.text); setModal(null); setQuick(""); all(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  const applyFood = (i: number, f: Food) => { const items = [...meal.items]; const q = Number(items[i].quantity || 1); items[i] = { ...items[i], description: f.name, calories: String(f.calories * q), protein: String(f.protein * q), carbs: String(f.carbs * q), fat: String(f.fat * q), source: "import" }; setMeal({ ...meal, items }); };
  return (
    <div className="space-y-4">
      <PageHeader title="Nutrition" subtitle="Meals, macros, goals. Exact, database and estimated values are labelled separately." action={<><button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, -1))}>←</button><input type="date" className="field !w-auto !py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} /><button className="btn-ghost btn-sm" onClick={() => setDate(addDays(date, 1))}>→</button>{aiConfigured && <button className="btn-ghost btn-sm" onClick={() => setModal("quick")}>AI log</button>}<button className="btn-primary btn-sm" onClick={() => setModal("meal")}>+ Meal</button></>} />
      {day.error && <ErrorBox error={day.error} retry={day.reload} />}
      {day.loading && !d && <Spinner />}
      {d && (
        <>
          <Card title={`${fmtDate(date, { weekday: "long", day: "numeric", month: "short" })}`} action={<button className="btn-ghost btn-sm" onClick={() => { setGoals({ calories: String(d.goals.calories), protein: String(d.goals.protein), carbs: String(d.goals.carbs), fat: String(d.goals.fat) }); setModal("goals"); }}>Goals</button>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{(["calories", "protein", "carbs", "fat"] as const).map((k) => <div key={k}><div className="flex justify-between text-sm"><span className="capitalize">{k}</span><span className="tnum">{fmtNum(d.totals[k], 0)} / {d.goals[k]}{k === "calories" ? " kcal" : " g"}</span></div><Bar value={d.goals[k] ? d.totals[k] / d.goals[k] : 0} tone={d.totals[k] > d.goals[k] * 1.1 ? "warning" : "positive"} /></div>)}</div>
            <p className="mt-2 text-xs muted">{d.exactItems} exact / database items · {d.estimatedItems} estimated items</p>
          </Card>
          {d.meals.length === 0 ? <Empty>No meals logged for this day.</Empty> : d.meals.map((m) => (
            <Card key={m.id} title={<span className="capitalize">{m.type.replace("_", " ")}{m.name ? ` · ${m.name}` : ""}</span>} action={<button className="btn-ghost btn-sm" onClick={async () => { if (confirm("Delete meal?")) { await api(`/api/nutrition/meals/${m.id}`, { method: "DELETE" }); all(); } }}>✕</button>}>
              <ul className="divide-y divide-border text-sm">{m.items.map((i) => <li key={i.id} className="flex items-center gap-2 py-1"><span className="flex-1">{i.description} <span className="muted">× {i.quantity} {i.unit}</span> <Source source={i.source} />{i.confidence != null && <span className="text-[10px] muted"> {i.confidence}%</span>}</span><span className="tnum text-xs muted">{fmtNum(i.calories, 0)} kcal · P {fmtNum(i.protein, 0)} · C {fmtNum(i.carbs, 0)} · F {fmtNum(i.fat, 0)}</span><button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/nutrition/entries/${i.id}`, { method: "DELETE" }); all(); }}>✕</button></li>)}</ul>
            </Card>
          ))}
          <div className="grid gap-3 md:grid-cols-2">
            <Card title="Last 7 days · calories">{summary.data ? <><MiniBars series={summary.data.daily.map((x) => ({ label: x.date.slice(5), a: x.calories, b: x.protein }))} labels={["kcal", "protein g"]} /><p className="mt-1 text-xs muted">Average over {summary.data.daysLogged} logged days: {fmtNum(summary.data.average.calories, 0)} kcal · {fmtNum(summary.data.average.protein, 0)} g protein</p></> : <Spinner />}</Card>
            <Card title="My foods" action={<button className="btn-ghost btn-sm" onClick={() => setModal("food")}>+ Food</button>}>{!foods.data?.length ? <p className="text-sm muted">Save frequent foods (per serving) to log faster.</p> : <ul className="divide-y divide-border text-sm">{foods.data.slice(0, 12).map((f) => <li key={f.id} className="flex justify-between py-1"><span>{f.name}</span><span className="tnum text-xs muted">{f.calories} kcal · P {f.protein} · C {f.carbs} · F {f.fat}</span></li>)}</ul>}</Card>
          </div>
        </>
      )}
      <Modal open={modal === "meal"} onClose={() => setModal(null)} title="Log meal" wide>
        <form onSubmit={saveMeal} className="space-y-3">
          <div className="grid grid-cols-2 gap-2"><Field label="Meal"><select className="field" value={meal.type} onChange={(e) => setMeal({ ...meal, type: e.target.value })}>{["breakfast", "lunch", "dinner", "snack", "pre_workout", "post_workout"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></Field><Field label="Name (optional)"><input className="field" value={meal.name} onChange={(e) => setMeal({ ...meal, name: e.target.value })} /></Field></div>
          {meal.items.map((it, i) => <div key={i} className="rounded-xl border border-border p-2"><div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Field label="Food"><input className="field" list="foods" value={it.description} onChange={(e) => { const items = [...meal.items]; items[i] = { ...it, description: e.target.value }; setMeal({ ...meal, items }); const f = foods.data?.find((x) => x.name === e.target.value); if (f) applyFood(i, f); }} /><datalist id="foods">{foods.data?.map((f) => <option key={f.id} value={f.name} />)}</datalist></Field><Field label="Qty"><input className="field" type="number" step="any" value={it.quantity} onChange={(e) => { const items = [...meal.items]; items[i] = { ...it, quantity: e.target.value }; setMeal({ ...meal, items }); }} /></Field>{(["calories", "protein", "carbs", "fat"] as const).map((k) => <Field key={k} label={k}><input className="field" type="number" step="any" value={it[k]} onChange={(e) => { const items = [...meal.items]; items[i] = { ...it, [k]: e.target.value, source: "user" }; setMeal({ ...meal, items }); }} /></Field>)}<Field label="Values are"><select className="field" value={it.source} onChange={(e) => { const items = [...meal.items]; items[i] = { ...it, source: e.target.value }; setMeal({ ...meal, items }); }}><option value="user">exact</option><option value="estimated">estimated</option><option value="import">database</option></select></Field></div></div>)}
          <div className="flex gap-2"><button type="button" className="btn-ghost btn-sm" onClick={() => setMeal({ ...meal, items: [...meal.items, { ...blankItem }] })}>+ Item</button></div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><button className="btn-primary">Save meal</button></div>
        </form>
      </Modal>
      <Modal open={modal === "goals"} onClose={() => setModal(null)} title="Daily nutrition goals"><form onSubmit={saveGoals} className="space-y-3"><div className="grid grid-cols-2 gap-2">{(["calories", "protein", "carbs", "fat"] as const).map((k) => <Field key={k} label={k}><input className="field" type="number" required value={goals[k]} onChange={(e) => setGoals({ ...goals, [k]: e.target.value })} /></Field>)}</div><p className="text-xs muted">Your routine document states ~2.600 kcal and 155–165 g protein.</p><div className="flex justify-end"><button className="btn-primary">Save</button></div></form></Modal>
      <Modal open={modal === "food"} onClose={() => setModal(null)} title="New food (per serving)"><form onSubmit={saveFood} className="space-y-3"><Field label="Name"><input className="field" required value={food.name} onChange={(e) => setFood({ ...food, name: e.target.value })} /></Field><div className="grid grid-cols-2 gap-2">{(["calories", "protein", "carbs", "fat", "servingGrams"] as const).map((k) => <Field key={k} label={k}><input className="field" type="number" step="any" required={k === "calories"} value={food[k]} onChange={(e) => setFood({ ...food, [k]: e.target.value })} /></Field>)}</div><div className="flex justify-end"><button className="btn-primary">Save</button></div></form></Modal>
      <Modal open={modal === "quick"} onClose={() => setModal(null)} title="AI meal log"><form onSubmit={quickLog} className="space-y-3"><textarea className="field" rows={3} autoFocus placeholder="For breakfast I had 3 eggs, toast and a protein shake" value={quick} onChange={(e) => setQuick(e.target.value)} /><p className="text-xs muted">The AI estimates macros when exact data is unavailable and stores them labelled as <Badge tone="warning" className="!text-[10px]">estimated</Badge>.</p>{error && <p className="text-sm text-negative">{error}</p>}<div className="flex justify-end"><button className="btn-primary" disabled={busy || !quick.trim()}>{busy ? "Logging…" : "Log with AI"}</button></div></form></Modal>
    </div>
  );
}
