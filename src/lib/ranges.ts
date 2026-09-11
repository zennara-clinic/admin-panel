/**
 * The reporting windows every metrics page offers — Overview, Analytics (all
 * tabs), Consultations and a dermatologist's page — so the same figure never
 * means two different periods on two screens.
 *
 *   This month    the 1st of the current clinic month to today (the default)
 *   Last 90 days  today and the 89 days before it
 *   All time      everything the clinic holds
 *
 * Days are clinic (Asia/Kolkata) day keys, never the browser's local date.
 */
import { addClinicDays, clinicMonthStart, dayKeyDate, fmtDayKey, isoDay } from "./format";

export const METRIC_RANGES = ["This month", "Last 90 days", "All time"] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];
export const DEFAULT_METRIC_RANGE: MetricRange = "This month";

export const isMetricRange = (v: string | null | undefined): v is MetricRange =>
  !!v && (METRIC_RANGES as readonly string[]).includes(v);

/**
 * Start date sent for "All time" to the endpoints that fall back to their own
 * last-30-days when no start is given (financial, appointments, services, a
 * dermatologist's stats). Older than any record the clinic holds. The dashboard
 * endpoint is sent no start at all and finds the oldest record itself.
 */
export const ALL_TIME_FLOOR = "2015-01-01";

/** Whole clinic days from `from` to `to`, both counted. */
export const daysInclusive = (from: string, to: string) =>
  Math.max(1, Math.round((dayKeyDate(to).getTime() - dayKeyDate(from).getTime()) / 86_400_000) + 1);

export type MetricWindow = {
  /** Undefined only for All time — see `floorStart` for endpoints that need a date. */
  startDate?: string;
  endDate: string;
  /** Start to send to endpoints that cannot take an open start. */
  floorStart: string;
  /** Length of the window in days (for endpoints that take `days`). */
  days: number;
  /** "1 Sep – 11 Sep 2026" — the period in words, for subtitles and exports. */
  label: string;
};

const shortDay = (key: string) => fmtDayKey(key, { day: "numeric", month: "short" });
const longDay = (key: string) => fmtDayKey(key, { day: "numeric", month: "short", year: "numeric" });

function span(from: string, to: string) {
  if (from === to) return longDay(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${shortDay(from)} – ${longDay(to)}` : `${longDay(from)} – ${longDay(to)}`;
}

export function metricWindow(range: string, today: string = isoDay()): MetricWindow {
  if (range === "All time") {
    return { startDate: undefined, endDate: today, floorStart: ALL_TIME_FLOOR, days: daysInclusive(ALL_TIME_FLOOR, today), label: "All time" };
  }
  const start = range === "Last 90 days" ? addClinicDays(today, -89) : clinicMonthStart(today);
  return { startDate: start, endDate: today, floorStart: start, days: daysInclusive(start, today), label: span(start, today) };
}

/** A custom from–to window in the same shape. */
export function customWindow(startDate: string, endDate: string): MetricWindow {
  return { startDate, endDate, floorStart: startDate, days: daysInclusive(startDate, endDate), label: span(startDate, endDate) };
}
