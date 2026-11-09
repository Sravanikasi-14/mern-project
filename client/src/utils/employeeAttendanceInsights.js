import {
  addCivilDays,
  formatCivilDate,
  parseCivilDate,
  weekdaySunday0,
} from "./dateUtils";

/**
 * Pure helpers that turn real attendance records (from
 * GET /admin/attendance/employee/:id) into summary numbers for the HR
 * Employee Details page. Nothing here invents data: days without a record are
 * reported as absent only when they were expected working days that already
 * passed, using the active company policy for weekends / holidays.
 */

export function parseTimeToMinutes(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getHours() * 60 + value.getMinutes();
  }
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(value, timeZone) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    const asStr = String(value);
    return /^\d{1,2}:\d{2}/.test(asStr) ? asStr.slice(0, 5) : "";
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function holidayKey(h) {
  if (!h) return "";
  if (typeof h === "string") return h.slice(0, 10);
  if (h.date) return String(h.date).slice(0, 10);
  return "";
}

export function buildHolidaySet(holidays) {
  const set = new Set();
  for (const h of Array.isArray(holidays) ? holidays : []) {
    const key = holidayKey(h);
    if (key) set.add(key);
  }
  return set;
}

export function formatHours(record) {
  const raw = record?.workingHours;
  if (raw && raw !== "--" && raw !== "—") return String(raw);
  const minutes = Number(record?.durationMinutes) || 0;
  if (minutes > 0) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return "";
}

export const ATTENDANCE_STATUS_LABELS = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  leave: "On leave",
};

function isPresentRecord(rec) {
  return Boolean(
    rec &&
      (rec.checkIn || ["PRESENT", "CHECKED_IN", "CHECKED_OUT", "HALF_DAY"].includes(rec.status))
  );
}

/**
 * @returns {{
 *   days: Array, rows: Array, counts: object, workingDays: number, attended: number,
 *   rate: number|null, weekly: Array, today: object|null
 * }}
 */
export function analyzeAttendance({
  records = [],
  startDate,
  endDate,
  todayStr,
  weekendRules = { saturdayOff: true, sundayOff: true },
  holidaySet = new Set(),
  officeStart = "09:30",
  graceMinutes = 15,
  timeZone,
}) {
  const empty = {
    days: [],
    rows: [],
    counts: { present: 0, late: 0, absent: 0, leave: 0 },
    workingDays: 0,
    attended: 0,
    rate: null,
    weekly: [],
    today: null,
  };
  const start = parseCivilDate(startDate);
  const end = parseCivilDate(endDate);
  if (!start || !end || !todayStr) return empty;

  const lastDate = endDate < todayStr ? endDate : todayStr;
  const lastParts = parseCivilDate(lastDate);
  if (!lastParts || startDate > lastDate) return empty;

  const byDate = new Map();
  for (const r of records) if (r?.date) byDate.set(String(r.date).slice(0, 10), r);

  const lateThreshold = (parseTimeToMinutes(officeStart) ?? 570) + (Number(graceMinutes) || 0);
  const days = [];
  const counts = { present: 0, late: 0, absent: 0, leave: 0 };
  let workingDays = 0;

  let cursor = { ...start };
  // Hard cap protects against absurd ranges.
  for (let i = 0; i < 400; i += 1) {
    const dateStr = formatCivilDate(cursor.year, cursor.month, cursor.day);
    if (dateStr > lastDate) break;
    const dow = weekdaySunday0(cursor.year, cursor.month, cursor.day);
    const isWeekend =
      (weekendRules.saturdayOff !== false && dow === 6) ||
      (weekendRules.sundayOff !== false && dow === 0);
    const isHoliday = holidaySet.has(dateStr);
    const rec = byDate.get(dateStr) || null;
    let statusKey;

    if (rec && (rec.status === "ON_LEAVE" || rec.status === "LEAVE")) {
      statusKey = "leave";
    } else if (isHoliday) {
      statusKey = "holiday";
    } else if (isWeekend) {
      statusKey = "weekend";
    } else if (isPresentRecord(rec)) {
      let late = false;
      if (rec.checkIn) {
        const mins =
          parseTimeToMinutes(formatClock(rec.checkIn, timeZone)) ?? parseTimeToMinutes(rec.checkIn);
        late = mins !== null && mins > lateThreshold;
      }
      statusKey = late ? "late" : "present";
    } else {
      statusKey = "absent";
    }

    const countsAsWorking = statusKey !== "holiday" && statusKey !== "weekend";
    if (countsAsWorking) workingDays += 1;
    if (counts[statusKey] !== undefined) counts[statusKey] += 1;

    days.push({
      date: dateStr,
      statusKey,
      record: rec,
      checkIn: rec ? formatClock(rec.checkIn, timeZone) : "",
      checkOut: rec ? formatClock(rec.checkOut, timeZone) : "",
      hours: rec ? formatHours(rec) : "",
    });
    cursor = addCivilDays(cursor.year, cursor.month, cursor.day, 1);
  }

  const attended = counts.present + counts.late;
  const rate = workingDays > 0 ? Math.round((attended / workingDays) * 100) : null;

  // Log rows: working days + any day with a real punch, newest first.
  const rows = days
    .filter((d) => (d.statusKey !== "weekend" && d.statusKey !== "holiday") || d.record)
    .slice()
    .reverse();

  // Weekly buckets of working-day attendance.
  const weekly = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    const working = slice.filter((d) => d.statusKey !== "weekend" && d.statusKey !== "holiday");
    if (!working.length) continue;
    const att = working.filter((d) => d.statusKey === "present" || d.statusKey === "late").length;
    weekly.push({
      startDate: slice[0].date,
      attended: att,
      working: working.length,
      rate: Math.round((att / working.length) * 100),
    });
  }

  const today = days.find((d) => d.date === todayStr) || null;

  return { days, rows, counts, workingDays, attended, rate, weekly, today };
}
