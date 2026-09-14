import type { SessionUser } from "@/server/auth/session";
import { listMemory, touchMemories } from "@/server/services/memory";
import { listTasks } from "@/server/services/tasks";
import { listEvents } from "@/server/services/calendar";
import { listGoals } from "@/server/services/goals";
import { workoutForDate } from "@/server/services/training";
import { financialSummary } from "@/server/services/finance";
import { todayKey } from "@/lib/dates";
import { UNITS } from "@/modules/german/content";

/**
 * Structured context (spec §8): profile + long-term memory + a compact "current state" snapshot.
 * Historical detail is fetched on demand through read tools, not stuffed into the prompt.
 */
export async function buildSystemPrompt(user: SessionUser, extra?: string) {
  const tz = user.timezone;
  const today = todayKey(tz);
  const now = new Date();
  const [memory, tasksToday, overdue, eventsToday, goals, workout, finance] = await Promise.all([
    listMemory(user.id, { limit: 60 }),
    listTasks(user.id, { view: "today", tz, limit: 15 }),
    listTasks(user.id, { view: "overdue", tz, limit: 10 }),
    listEvents(user.id, { from: new Date(today + "T00:00:00"), to: new Date(today + "T23:59:59") }).catch(() => []),
    listGoals(user.id, "active", tz),
    workoutForDate(user.id, today).catch(() => null),
    financialSummary(user.id, { from: today.slice(0, 7) + "-01", to: today }).catch(() => null),
  ]);
  touchMemories(memory.map((m) => m.id)).catch(() => {});
  const fmtTime = (d: Date) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const lines = [
    `You are the AI core of "${process.env.APP_NAME ?? "Personal OS"}", the private Personal Operating System of ${user.name} (${user.email}).`,
    `Current date/time: ${now.toLocaleString("en-GB", { timeZone: tz })} (${tz}). Today is ${today}. Currency: ${user.currency}. The user writes in Spanish or English; answer in the language they use.`,
    "",
    "RULES",
    "- You act only through tools. Never claim something was saved, changed, logged or deleted unless the tool result confirms it. If a tool fails or is pending confirmation, say so plainly.",
    "- Prefer doing the action over asking, for low-risk tools (expenses, tasks, journal, workout sets, study sessions, meals). Ask a short clarifying question only when a required detail is genuinely missing.",
    "- Before modifying existing records, read them first (get_* tools) to obtain ids.",
    "- Dates: resolve 'today', 'tomorrow', 'next Friday' relative to the current date in the user's timezone; use YYYY-MM-DD.",
    "- Label information sources: figures from tools are exact; anything you estimate (e.g. nutrition values) must be marked as an estimate. Never invent market data or news.",
    "- Never give guaranteed-return claims or unsolicited BUY/SELL recommendations; explain and educate instead.",
    "- Training: the user's routine is an 8-day cycle (3-1-3-1) seeded from their own document; use get_training_plan / get_today_workout and real history, never a generic plan.",
    "- German: the course is the integrated 'Deutsch' module (28 units, book: Basic German – Schenke & Seago). Use german tools for progress.",
    "- Keep answers compact and useful; use short lists when summarizing.",
    "",
    "LONG-TERM MEMORY (user-controlled; use remember_memory to add durable facts the user tells you):",
    ...(memory.length ? memory.map((m) => `- [${m.kind}${m.key ? ":" + m.key : ""}] ${m.content}`) : ["- (empty)"]),
    "",
    "CURRENT STATE SNAPSHOT",
    `- Tasks due today/overdue-included (${tasksToday.length}): ${tasksToday.map((t) => `${t.title}${t.dueDate && t.dueDate < today ? " (overdue)" : ""} [${t.priority}, id ${t.id.slice(0, 8)}]`).join("; ") || "none"}`,
    overdue.length ? `- Overdue tasks: ${overdue.length}` : "",
    `- Calendar today: ${eventsToday.map((e) => `${fmtTime(e.startAt)}–${fmtTime(e.endAt)} ${e.title} (${e.kind})`).join("; ") || "nothing scheduled"}`,
    `- Active goals: ${goals.slice(0, 8).map((g) => `${g.name} ${g.progress}%${g.deadline ? " by " + g.deadline : ""}`).join("; ") || "none"}`,
    workout ? `- Training today (cycle day ${workout.dayIndex + 1}/${workout.plan.cycleLength}): ${workout.day ? (workout.day.isRest ? "Rest day — " + (workout.day.notes ?? "") : workout.day.name + " · " + workout.day.exercises.length + " exercises") : "no plan day"}${workout.session ? (workout.session.finishedAt ? " (session finished)" : " (session in progress)") : ""}` : "- Training: no active plan",
    finance ? `- Finance this month: income ${finance.income}, expenses ${finance.expenses}, net ${finance.net}, top categories ${finance.byCategory.slice(0, 3).map((c) => `${c.name} ${c.total}`).join(", ") || "none"}` : "",
    `- German course units: ${UNITS.length}.`,
    extra ? "\n" + extra : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}
