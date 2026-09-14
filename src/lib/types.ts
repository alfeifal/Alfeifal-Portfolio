/** Client-side types for API payloads (kept small and structural on purpose). */
export interface Task { id: string; title: string; description: string | null; status: "todo" | "in_progress" | "done" | "cancelled"; priority: "low" | "medium" | "high" | "urgent"; category: string | null; dueDate: string | null; dueTime: string | null; projectId: string | null; goalId: string | null; recurrence: string | null; estimatedMinutes: number | null; completedAt: string | null; source: string }
export interface EventItem { id: string; title: string; description: string | null; kind: string; startAt: string; endAt: string; allDay: boolean; location: string | null; taskId: string | null; projectId: string | null; goalId: string | null; source: string }
export interface Goal { id: string; name: string; description: string | null; category: string; status: string; priority: string; deadline: string | null; progress: number; metricName: string | null; metricUnit: string | null; metricTarget: number | null; metricCurrent: number | null }
export interface Project { id: string; name: string; description: string | null; kind: string; status: string; priority: string; deadline: string | null; notes: string | null; progress: number; openTasks: number; doneTasks: number; computedProgress: number }
export interface Transaction { id: string; type: "expense" | "income" | "transfer"; amount: number; currency: string; date: string; description: string; merchant: string | null; accountId: string | null; toAccountId: string | null; categoryId: string | null; categoryName?: string | null; accountName?: string | null; source: string }
export interface DashboardData {
  today: string; widgets: string[]; unreadNotifications: number;
  tasks: { today: Task[]; overdue: Task[]; counts: { today: number; overdue: number; open: number } };
  events: EventItem[];
  training: { workout: { dayIndex: number; day: { name: string; isRest: boolean; notes: string | null; exercises: unknown[] } | null; session: { id: string; finishedAt: string | null } | null } | null; recent: { id: string; date: string; dayName: string | null; sets: number; volume: number }[] };
  finance: { income: number; expenses: number; net: number; savingsRate: number | null; byCategory: { name: string; total: number }[]; budgets: unknown[]; netWorth: number; accounts: unknown[]; recent: Transaction[]; savings: { id: string; name: string; currentAmount: number; targetAmount: number }[] } | null;
  goals: Goal[]; projects: Project[];
  investing: { totalValue: number; totalCost: number; unrealized: number; cash: number; positions: { asset: { id: string; symbol: string }; value: number | null }[]; unpriced: string[] } | null;
  trading: { openTrades: { id: string; symbol: string; direction: string; mode: string }[]; watchlists: { items: { symbol: string }[] }[]; economicEvents: { id: string; title: string }[] };
  news: { id: string; headline: string; url: string; source: string }[];
  studies: { totalMinutes: number; bySubject: { name: string; minutes: number; weeklyGoalMinutes: number | null }[]; exams: { title: string; date: string }[]; german: { streak: number; xp: number; unitsPassed: number } | null } | null;
  nutrition: { totals: { calories: number; protein: number }; goals: { calories: number; protein: number }; meals: number; estimatedItems: number } | null;
}
