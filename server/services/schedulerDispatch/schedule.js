/**
 * Daily schedule helpers in an IANA timezone (no external tz library).
 */

import { getCompanyBusinessDate, getCompanyMinutesOfDay } from "../../utils/companyTime.js";

/**
 * Convert a civil date + local HH:mm in `timeZone` to a UTC Date.
 * Iteratively corrects for DST / offset using Intl.
 */
export function zonedCivilDateTimeToUtc(civilYmd, hour, minute, timeZone) {
  const match = String(civilYmd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const h = Number(hour);
  const m = Number(minute);
  if (![year, month, day, h, m].every((n) => Number.isFinite(n))) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;

  // Initial guess: treat civil components as UTC, then nudge toward the zone.
  let utcMs = Date.UTC(year, month - 1, day, h, m, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    let gotH = get("hour");
    if (gotH === 24) gotH = 0;
    const got = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: gotH,
      minute: get("minute"),
    };
    if (
      got.year === year &&
      got.month === month &&
      got.day === day &&
      got.hour === h &&
      got.minute === m
    ) {
      return new Date(utcMs);
    }
    const asUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0, 0);
    const desired = Date.UTC(year, month - 1, day, h, m, 0, 0);
    utcMs += desired - asUtc;
  }
  return new Date(utcMs);
}

export function addCivilDays(civilYmd, days) {
  const match = String(civilYmd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const next = new Date(base + Number(days) * 86_400_000);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(
    next.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * Next daily fire at local hour:minute in timezone, strictly after `from` when
 * today's slot has already passed (or equals — use `inclusive` for due checks).
 */
export function computeNextDailyRunAt(
  from = new Date(),
  { timezone = "Asia/Kolkata", hour = 0, minute = 0 } = {},
  { inclusive = false } = {}
) {
  const instant = from instanceof Date ? from : new Date(from);
  const civilToday = getCompanyBusinessDate(instant, timezone);
  const minutesNow = getCompanyMinutesOfDay(instant, timezone);
  const targetMinutes = hour * 60 + minute;
  if (minutesNow == null || !civilToday) return null;

  const todayPassed = inclusive ? minutesNow > targetMinutes : minutesNow >= targetMinutes;
  const civil = todayPassed ? addCivilDays(civilToday, 1) : civilToday;
  return zonedCivilDateTimeToUtc(civil, hour, minute, timezone);
}

export function isJobDue(job, now = new Date()) {
  if (!job?.enabled) return false;
  if (!job.nextRunAt) return true;
  return new Date(job.nextRunAt).getTime() <= now.getTime();
}
