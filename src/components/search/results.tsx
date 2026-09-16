"use client";
import { FileText, CheckSquare, CalendarDays, BookOpen, Target, FolderKanban, ClipboardList, Wallet, Apple, Dumbbell, GraduationCap, TrendingUp, CandlestickChart, Sparkles, Bell, Newspaper, Languages, Search as SearchIcon } from "lucide-react";

/** Wire shape of a hit. `id` is an internal reference: it is used to navigate, never shown. */
export interface SearchHit {
  type: string; module: string; id: string; title: string;
  snippet?: string | null; date?: string | null; href: string; key?: string | null; score: number;
}
export interface SearchResponse { query: string; terms: string[]; hits: SearchHit[]; truncated: boolean; total: number }

/** Module → how it is labelled and iconed in results. Keeps the palette and the page identical. */
export const MODULE_META: Record<string, { label: string; icon: typeof CheckSquare }> = {
  tasks: { label: "Tasks", icon: CheckSquare },
  calendar: { label: "Calendar", icon: CalendarDays },
  journal: { label: "Journal", icon: BookOpen },
  goals: { label: "Goals", icon: Target },
  projects: { label: "Projects", icon: FolderKanban },
  planner: { label: "Planner", icon: ClipboardList },
  finance: { label: "Finance", icon: Wallet },
  nutrition: { label: "Nutrition", icon: Apple },
  training: { label: "Training", icon: Dumbbell },
  studies: { label: "Studies", icon: GraduationCap },
  investing: { label: "Investing", icon: TrendingUp },
  trading: { label: "Trading", icon: CandlestickChart },
  academy: { label: "Academy", icon: GraduationCap },
  ai: { label: "Assistant", icon: Sparkles },
  reviews: { label: "Reviews", icon: FileText },
  notifications: { label: "Notifications", icon: Bell },
  market: { label: "Market news", icon: Newspaper },
  german: { label: "German", icon: Languages },
};

export const moduleMeta = (m: string) => MODULE_META[m] ?? { label: m, icon: SearchIcon };
export const typeLabel = (t: string) => t.replace(/_/g, " ");

/** Groups hits by module, keeping the best-scoring modules first (hits arrive already ranked). */
export function groupByModule(hits: SearchHit[]) {
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const g = groups.get(h.module);
    if (g) g.push(h);
    else groups.set(h.module, [h]);
  }
  return [...groups.entries()].map(([module, items]) => ({ module, items }));
}
