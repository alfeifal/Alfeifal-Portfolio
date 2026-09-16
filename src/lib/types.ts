/** Client-side types for API payloads (kept small and structural on purpose). */
export interface Task { id: string; title: string; description: string | null; status: "todo" | "in_progress" | "done" | "cancelled"; priority: "low" | "medium" | "high" | "urgent"; category: string | null; dueDate: string | null; dueTime: string | null; projectId: string | null; goalId: string | null; recurrence: string | null; estimatedMinutes: number | null; completedAt: string | null; source: string }
export interface EventItem { id: string; title: string; description: string | null; kind: string; startAt: string; endAt: string; allDay: boolean; location: string | null; taskId: string | null; projectId: string | null; goalId: string | null; source: string }
export interface Goal { id: string; name: string; description: string | null; category: string; status: string; priority: string; deadline: string | null; progress: number; metricName: string | null; metricUnit: string | null; metricTarget: number | null; metricCurrent: number | null; metricSource: string | null; metricKind: string | null; metricRef: string | null; metricPeriod: string | null }
export interface PlanItem { id: string; kind: "task" | "event" | "note"; status: "proposed" | "accepted" | "rejected" | "skipped"; title: string; notes: string | null; date: string | null; startAt: string | null; endAt: string | null; allDay: boolean; estimatedMinutes: number | null; eventKind: string | null; priority: string | null; projectId: string | null; goalId: string | null; createdTaskId: string | null; createdEventId: string | null }
export interface Plan { id: string; horizon: "day" | "week"; periodKey: string; status: "draft" | "accepted" | "partially_accepted" | "rejected" | "superseded"; title: string | null; content: string; acceptedAt: string | null; rejectedAt: string | null; createdAt: string; items: PlanItem[] }
export interface PlanAcceptResult { itemId: string; title: string; kind: string; status: "created" | "already_created" | "skipped" | "failed"; taskId?: string; eventId?: string; error?: string }
/**
 * `computedProgress` is the number to show. `progressBasis` says where it came from — tasks,
 * milestones or a value the user set by hand — so a percentage on screen is never unexplained.
 */
export interface Project {
  id: string; name: string; description: string | null; kind: string; status: string; priority: string;
  deadline: string | null; notes: string | null; progress: number;
  openTasks: number; doneTasks: number; totalMilestones: number; doneMilestones: number;
  overdueTasks: number; overdueMilestones: number;
  computedProgress: number; progressBasis: "tasks" | "milestones" | "manual" | "none";
  progressDone: number; progressTotal: number;
}
export interface Transaction { id: string; type: "expense" | "income" | "transfer"; amount: number; currency: string; date: string; description: string; merchant: string | null; accountId: string | null; toAccountId: string | null; categoryId: string | null; categoryName?: string | null; accountName?: string | null; source: string }
export interface DashboardData {
  today: string; widgets: string[]; unreadNotifications: number;
  tasks: { today: Task[]; overdue: Task[]; counts: { today: number; overdue: number; open: number } };
  events: EventItem[];
  training: { workout: { dayIndex: number; day: { name: string; isRest: boolean; notes: string | null; exercises: unknown[] } | null; session: { id: string; finishedAt: string | null } | null } | null; recent: { id: string; date: string; dayName: string | null; sets: number; volume: number; status: "started" | "in_progress" | "completed" | "empty"; isWorkout: boolean }[]; week: { from: string; to: string; completed: number; sessions: number; emptySessions: number; plannedDays: number | null; plannedSoFar: number | null } | null };
  finance: { income: number; expenses: number; net: number; savingsRate: number | null; byCategory: { name: string; total: number }[]; budgets: unknown[]; financeBalance: number; accounts: unknown[]; recent: Transaction[]; savings: { id: string; name: string; currentAmount: number; targetAmount: number }[] } | null;
  goals: Goal[]; projects: Project[];
  plan: { day: { id: string; periodKey: string; status: string; title: string | null; items: { id: string; kind: string; status: string; title: string; date: string | null; startAt: string | null; materialised: boolean }[]; pendingItems: number } | null; week: { id: string; status: string; pendingItems: number } | null; draftsAwaitingAnswer: number } | null;
  investing: { totalValue: number; totalCost: number; unrealized: number; cash: number; positions: { asset: { id: string; symbol: string }; value: number | null }[]; unpriced: string[] } | null;
  trading: { openTrades: { id: string; symbol: string; direction: string; mode: string }[]; watchlists: { items: { symbol: string }[] }[]; economicEvents: { id: string; title: string }[] };
  news: { id: string; headline: string; url: string; source: string }[];
  studies: { totalMinutes: number; bySubject: { name: string; minutes: number; weeklyGoalMinutes: number | null }[]; exams: { title: string; date: string }[]; german: { streak: number; xp: number; unitsPassed: number } | null } | null;
  nutrition: { totals: { calories: number; protein: number }; goals: { calories: number; protein: number }; meals: number; estimatedItems: number } | null;
}

/** Analytics payload (see services/analytics.ts). Rates are null when their denominator is zero. */
export type Period = "week" | "month" | "quarter" | "year";
export type Section = "overview" | "training" | "nutrition" | "finance" | "studies" | "productivity" | "goals";
interface Consistency { macroCalories: number; delta: number; tolerance: number; ok: boolean }
interface Macros { calories: number; protein: number; carbs: number; fat: number }
export interface Analytics {
  period: string; range: { from: string; to: string }; previousRange: { from: string; to: string }; rangeDays: number;
  finance: {
    current: { income: number; expenses: number; net: number; savingsRate: number | null; byCategory: { name: string; total: number }[] };
    previous: { income: number; expenses: number; net: number };
    change: { income: number | null; expenses: number | null; net: number | null };
    monthly: { month: string; income: number; expenses: number }[]; financeBalance: number;
    budgets: { id: string; name: string; amount: number; spent: number; remaining: number; pct: number }[];
  };
  training: {
    current: { sessions: number; emptySessions: number; sets: number; volume: number; minutes: number; weekly: { week: string; sessions: number; volume: number }[] };
    previous: { sessions: number; volume: number; sets: number; minutes: number };
    change: { sessions: number | null; volume: number | null };
    adherence: { plannedDays: number | null; plannedSoFar: number | null; completedDays: number; missedDays: number | null; extraDays: number | null; adherencePct: number | null };
    perWeek: number | null;
  };
  studies: {
    current: { totalMinutes: number; bySubject: { name: string; minutes: number; days: number; weeklyGoalMinutes: number | null }[]; daily: { date: string; minutes: number }[] };
    previous: { totalMinutes: number }; change: { minutes: number | null };
    consistency: { daysStudied: number; daysInRange: number; pct: number | null; avgMinutesPerStudyDay: number | null };
    exams: { total: number; upcoming: number; inRange: number; withResult: number };
    assignments: { total: number; open: number; overdue: number; completedInRange: number };
  };
  german: { totalMinutes: number; xp: number; streak: number; unitsPassed: number };
  trading: Record<"real" | "paper", { trades: number; winRate: number; totalPnl: number }>;
  nutrition: {
    average: Macros; daysLogged: number; daily: (Macros & { date: string; consistency: Consistency })[];
    previous: { average: Macros; daysLogged: number }; change: { calories: number | null; protein: number | null };
    coverage: { daysLogged: number; daysInRange: number; pct: number | null };
    compliance: Record<"calories" | "protein" | "carbs" | "fat", { target: number; daysOnTarget: number | null; pct: number | null }>;
    consistency: Consistency;
  };
  productivity: { done: number; created: number; open: number; overdue: number; completionRate: number | null; perDay: number | null; daily: { date: string; n: number }[]; byWeekday: { day: string; n: number }[] };
  calendar: { byKind: { kind: string; events: number; hours: number }[]; totalHours: number; events: number };
  journal: { entries: number; daysWithEntry: number; daysInRange: number; withMood: number; avgMood: number | null };
  investing: { snapshots: { date: string; totalValue: number; cash: number }[]; first: { date: string; totalValue: number } | null; last: { date: string; totalValue: number } | null; changePct: number | null };
  goals: { active: number; completed: number; avgProgress: number; completedInRange: number; linked: number; pastDeadline: number; milestones: { total: number; completed: number; completedInRange: number } };
  projects: { active: number; completed: number; total: number; avgProgress: number; milestones: { total: number } };
}
