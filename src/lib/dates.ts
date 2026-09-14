import { addDays, differenceInCalendarDays, endOfMonth, endOfWeek, format, formatISO, parseISO, startOfMonth, startOfWeek } from "date-fns";

export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE ?? "Europe/Madrid";

/** YYYY-MM-DD in a given timezone. */
export function todayKey(tz: string = DEFAULT_TZ, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function dateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function isoWeekKey(d: Date): string {
  // ISO week: Monday start
  const start = startOfWeek(d, { weekStartsOn: 1 });
  const year = format(start, "RRRR");
  const week = format(start, "II");
  return `${year}-W${week}`;
}

export function weekRange(d: Date) {
  return { start: startOfWeek(d, { weekStartsOn: 1 }), end: endOfWeek(d, { weekStartsOn: 1 }) };
}
export function monthRange(d: Date) {
  return { start: startOfMonth(d), end: endOfMonth(d) };
}

export function daysBetween(a: string, b: string) {
  return differenceInCalendarDays(parseISO(b), parseISO(a));
}
export function addDaysKey(key: string, n: number) {
  return dateKey(addDays(parseISO(key), n));
}
export const toIso = (d: Date) => formatISO(d);
