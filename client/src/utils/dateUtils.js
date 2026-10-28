export const DEFAULT_COMPANY_TIMEZONE = "Asia/Kolkata";

export function resolveCompanyTimezone(company) {
  return company?.config?.timezone || company?.timezone || DEFAULT_COMPANY_TIMEZONE;
}

export function getCompanyBusinessDate(date = new Date(), timezone = DEFAULT_COMPANY_TIMEZONE) {
  const instant = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(instant.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return `${instant.getUTCFullYear()}-${String(instant.getUTCMonth() + 1).padStart(2, "0")}-${String(instant.getUTCDate()).padStart(2, "0")}`;
  }
}

export function formatCivilDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCivilDate(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  return null;
}

export function civilDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekdaySunday0(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addCivilDays(year, month, day, delta) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

export function shiftMonth(year, month, delta) {
  const dt = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
  };
}

export function monthTitle(year, month, locale = "en-US") {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function weekdayLong(dateStr, locale = "en-US") {
  const parts = parseCivilDate(dateStr);
  if (!parts) return "";
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString(locale, {
    weekday: "long",
    timeZone: "UTC",
  });
}

export function buildMonthGrid(year, month, { weekStartsOn = 1, todayStr = "" } = {}) {
  const firstWeekday = weekdaySunday0(year, month, 1);
  const startOffset =
    weekStartsOn === 1 ? (firstWeekday === 0 ? 6 : firstWeekday - 1) : firstWeekday;

  const days = [];
  const prev = shiftMonth(year, month, -1);
  const prevDays = civilDaysInMonth(prev.year, prev.month);

  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const day = prevDays - i;
    const dateStr = formatCivilDate(prev.year, prev.month, day);
    days.push({
      year: prev.year,
      month: prev.month,
      day,
      dateStr,
      isOtherMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  const daysInMonth = civilDaysInMonth(year, month);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = formatCivilDate(year, month, day);
    days.push({
      year,
      month,
      day,
      dateStr,
      isOtherMonth: false,
      isToday: dateStr === todayStr,
    });
  }

  const remaining = (7 - (days.length % 7)) % 7;
  const next = shiftMonth(year, month, 1);
  for (let day = 1; day <= remaining; day += 1) {
    const dateStr = formatCivilDate(next.year, next.month, day);
    days.push({
      year: next.year,
      month: next.month,
      day,
      dateStr,
      isOtherMonth: true,
      isToday: dateStr === todayStr,
    });
  }

  return days;
}

export function buildWeekStrip(anchorDate = new Date(), timezone = DEFAULT_COMPANY_TIMEZONE, weekStartsOn = 1) {
  const todayStr = getCompanyBusinessDate(anchorDate, timezone);
  const today = parseCivilDate(todayStr);
  const weekday = weekdaySunday0(today.year, today.month, today.day);
  const startOffset = weekStartsOn === 1 ? (weekday === 0 ? -6 : 1 - weekday) : -weekday;
  const start = addCivilDays(today.year, today.month, today.day, startOffset);
  const names =
    weekStartsOn === 1
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return Array.from({ length: 7 }, (_, index) => {
    const civil = addCivilDays(start.year, start.month, start.day, index);
    const dateStr = formatCivilDate(civil.year, civil.month, civil.day);
    return {
      dateStr,
      dayName: names[index],
      dayNumber: civil.day,
      month: months[civil.month - 1],
      year: civil.year,
      monthNum: civil.month,
      isToday: dateStr === todayStr,
    };
  });
}

export function toDateOnlyString(value, timezone = DEFAULT_COMPANY_TIMEZONE) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return getCompanyBusinessDate(date, timezone);
}

export function dateOnlyInRange(dateStr, startStr, endStr) {
  if (!dateStr || !startStr || !endStr) return false;
  return dateStr >= startStr && dateStr <= endStr;
}

export function formatDisplayDate(value, timezone = DEFAULT_COMPANY_TIMEZONE) {
  const dateStr = toDateOnlyString(value, timezone);
  const parts = parseCivilDate(dateStr);
  if (!parts) return "—";
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function isCompletedToday(task, timezone = DEFAULT_COMPANY_TIMEZONE, now = new Date()) {
  if (!task || task.status !== "APPROVED" || !task.completedAt) return false;
  const todayStr = getCompanyBusinessDate(now, timezone);
  return getCompanyBusinessDate(new Date(task.completedAt), timezone) === todayStr;
}

export function eventsForDate(events, dateStr) {
  if (!Array.isArray(events) || !dateStr) return [];
  return events.filter((event) => {
    const start = toDateOnlyString(event.startDate || event.fromDate, DEFAULT_COMPANY_TIMEZONE);
    const end = toDateOnlyString(event.endDate || event.toDate || event.startDate || event.fromDate, DEFAULT_COMPANY_TIMEZONE);
    return dateOnlyInRange(dateStr, start, end);
  });
}
