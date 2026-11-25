import { parseCivilDate, weekdaySunday0 } from "../utils/dateUtils.js";

const DAYS_OF_WEEK_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Pure calculation helper for attendance trend capsule bars.
 * Supports "TODAY", "7D", and "30D" ranges with active headcount scaling.
 *
 * @param {object} [overview] Attendance overview summary series from server
 * @param {Array} [calendarDays] Fallback attendance calendar days
 * @param {number} [totalEmployees] Total headcount for attendance percentage
 * @param {"TODAY" | "7D" | "30D"} [attendanceRange] Selected date range
 * @returns {Array<object>} Formatted bar items
 */
export function computeWeeklyBars(
  overview = {},
  calendarDays = [],
  totalEmployees = 1,
  attendanceRange = "7D"
) {
  const ov = overview || {};
  const cDays = Array.isArray(calendarDays) ? calendarDays : [];
  const activeHeadcount = Math.max(
    1,
    ov.activeEmployees || totalEmployees || 1
  );

  let sourceDays = [];
  if (attendanceRange === "TODAY") {
    const today =
      (ov.week || ov.days || []).find((d) => d.isToday) ||
      cDays.find((d) => d.isToday) ||
      null;
    sourceDays = today ? [today] : [];
  } else if (attendanceRange === "30D") {
    sourceDays = ov.thirtyDays || [];
    if (!sourceDays.length && cDays.length) {
      let end = cDays.findIndex((d) => d.isToday);
      if (end < 0) {
        end = cDays.length - 1;
        for (let i = cDays.length - 1; i >= 0; i -= 1) {
          if (!cDays[i].isFuture) {
            end = i;
            break;
          }
        }
      }
      const start = Math.max(0, end - 29);
      sourceDays = cDays.slice(start, end + 1);
    }
  } else {
    // 7D — prefer backend rolling week ending at selected/today date
    sourceDays = ov.week || ov.days || [];
    if (!sourceDays.length && cDays.length) {
      let end = cDays.findIndex((d) => d.isToday);
      if (end < 0) {
        end = cDays.length - 1;
        for (let i = cDays.length - 1; i >= 0; i -= 1) {
          if (!cDays[i].isFuture) {
            end = i;
            break;
          }
        }
      }
      const start = Math.max(0, end - 6);
      sourceDays = cDays.slice(start, end + 1);
    }
  }

  if (!sourceDays.length) return [];

  return sourceDays.map((d) => {
    const present = d.presentCount ?? d.present ?? 0;
    const parts = parseCivilDate(d.date);
    const dayIdx =
      d.dayOfWeek != null
        ? d.dayOfWeek
        : parts
          ? weekdaySunday0(parts.year, parts.month, parts.day)
          : 0;
    const pct = Math.min(100, Math.round((present / activeHeadcount) * 100));
    const heightVal = present > 0 ? Math.max(0.18, pct / 100) : 0.08;

    return {
      date: d.date,
      dayLetter: DAYS_OF_WEEK_LETTERS[dayIdx] || "•",
      pct,
      heightVal,
      present,
      absent: d.absentCount ?? d.absent ?? 0,
      late: d.lateCount ?? d.late ?? 0,
      onLeave: d.leaveCount ?? d.onLeave ?? 0,
      isWeekend: Boolean(d.isWeekend),
      isToday: Boolean(d.isToday),
      isHoliday: Boolean(d.isHoliday),
      isFuture: Boolean(d.isFuture),
    };
  });
}
