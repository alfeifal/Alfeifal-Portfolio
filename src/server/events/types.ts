/**
 * Domain events (phase 2). Emitted by application services only — never by React, API routes or AI tools —
 * right after the database mutation they describe has been committed. Payloads carry ids and the facts a
 * subscriber needs to decide *what to recompute*, never the data itself: subscribers always re-read the
 * source of truth, which is what makes processing an event twice harmless.
 */
export type DomainEvent =
  // Tasks
  | { type: "task.completed"; taskId: string; projectId: string | null; goalId: string | null; date: string }
  | { type: "task.changed"; taskId: string; projectId: string | null; goalId: string | null; reason: "updated" | "reopened" | "deleted" }
  // Training
  | { type: "workout.finished"; sessionId: string; date: string; sets: number }
  | { type: "workout.changed"; sessionId: string | null; date: string | null; reason: "set_logged" | "set_updated" | "set_deleted" | "reopened" | "session_deleted" }
  // Studies (German time arrives here too, through the German bridge)
  | { type: "study.logged"; sessionId: string; subjectId: string | null; minutes: number; date: string; source: string }
  | { type: "study.changed"; sessionId: string; subjectId: string | null; reason: "deleted" }
  // Finance
  | { type: "expense.added"; transactionId: string; amount: number; categoryId: string | null; date: string }
  | { type: "income.added"; transactionId: string; amount: number; categoryId: string | null; date: string }
  | { type: "transaction.changed"; transactionId: string; transactionType: "expense" | "income" | "transfer"; reason: "updated" | "deleted" }
  // German (module state stays the source of truth; these only say "something changed")
  | { type: "german.unit_completed"; eventId: string; unitId: string | null; score: number; kind: "unit_test" | "exam" }
  | { type: "german.state_saved"; revision: number }
  // Derived: emitted by the goals subscriber when a linked goal materially changes (consumed by notifications)
  | {
      type: "goal.progress_changed";
      goalId: string;
      name: string;
      cause: string;
      periodKey: string;
      unit: string | null;
      target: number | null;
      before: GoalState;
      after: GoalState;
    };

export interface GoalState { metricCurrent: number | null; progress: number; status: string; atRisk: boolean }
export type DomainEventType = DomainEvent["type"];

export interface EmitContext {
  /** User timezone, when the caller already has it (saves a lookup). */
  tz?: string;
  /** Nesting depth: subscribers may emit derived events; the bus refuses to go deeper than MAX_DEPTH. */
  depth?: number;
}
