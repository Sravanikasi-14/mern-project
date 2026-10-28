import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCivilDays,
  buildMonthGrid,
  buildWeekStrip,
  civilDaysInMonth,
  formatCivilDate,
  getCompanyBusinessDate,
  getCompanyDayBounds,
  shiftMonth,
  weekdayLong,
  weekdaySunday0,
} from "../utils/companyTime.js";

describe("companyTime civil calendars", () => {
  it("counts days in 30-day, 31-day, and leap February", () => {
    assert.equal(civilDaysInMonth(2026, 4), 30);
    assert.equal(civilDaysInMonth(2026, 10), 31);
    assert.equal(civilDaysInMonth(2024, 2), 29);
    assert.equal(civilDaysInMonth(2025, 2), 28);
  });

  it("aligns October 2026 (Thursday start) on a Monday-first grid", () => {
    assert.equal(weekdaySunday0(2026, 10, 1), 4);
    const days = buildMonthGrid(2026, 10, { weekStartsOn: 1 });
    assert.equal(days.length % 7, 0);
    assert.equal(days[0].dateStr, "2026-09-28");
    assert.equal(days[3].dateStr, "2026-10-01");
    assert.equal(days[3].day, 1);
    assert.equal(days[3].isOtherMonth, false);
    const oct31 = days.find((d) => d.dateStr === "2026-10-31");
    assert.equal(oct31.isOtherMonth, false);
    assert.equal(weekdaySunday0(2026, 10, 31), 6);
  });

  it("aligns a month that begins on Sunday and a month that begins on Monday", () => {
    assert.equal(weekdaySunday0(2023, 1, 1), 0);
    const jan = buildMonthGrid(2023, 1, { weekStartsOn: 1 });
    assert.equal(jan[0].dateStr, "2022-12-26");
    assert.equal(jan[6].dateStr, "2023-01-01");

    assert.equal(weekdaySunday0(2025, 9, 1), 1);
    const sep = buildMonthGrid(2025, 9, { weekStartsOn: 1 });
    assert.equal(sep[0].dateStr, "2025-09-01");
    assert.equal(sep[0].isOtherMonth, false);
  });

  it("navigates December to January and January to December without invalid months", () => {
    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.equal(formatCivilDate(2027, 1, 1), "2027-01-01");
  });

  it("keeps weekday names on the civil date, not a UTC-shifted local date", () => {
    assert.equal(weekdayLong("2026-10-28"), "Wednesday");
    assert.equal(weekdayLong("2026-01-26"), "Monday");
  });
});

describe("companyTime timezone day bounds", () => {
  it("treats an IST evening instant as the same Kolkata business day", () => {
    const instant = new Date("2026-10-28T18:30:00.000Z");
    assert.equal(getCompanyBusinessDate(instant, "Asia/Kolkata"), "2026-10-29");
    const bounds = getCompanyDayBounds(new Date("2026-10-28T20:00:00.000Z"), "Asia/Kolkata");
    assert.equal(bounds.dateStr, "2026-10-29");
    assert.ok(instant >= bounds.start && instant < bounds.end);
  });

  it("does not use UTC ISO date for early morning IST", () => {
    const earlyIst = new Date("2026-10-27T20:30:00.000Z");
    assert.equal(earlyIst.toISOString().slice(0, 10), "2026-10-27");
    assert.equal(getCompanyBusinessDate(earlyIst, "Asia/Kolkata"), "2026-10-28");
  });

  it("builds a Monday-Sunday strip whose today matches company timezone", () => {
    const wednesdayIst = new Date("2026-10-28T06:00:00.000Z");
    const week = buildWeekStrip(wednesdayIst, "Asia/Kolkata", 1);
    assert.equal(week.length, 7);
    assert.equal(week[0].dayName, "Mon");
    assert.equal(week[0].dateStr, "2026-10-26");
    assert.equal(week[2].dateStr, "2026-10-28");
    assert.equal(week[2].isToday, true);
  });

  it("adds civil days across month boundaries", () => {
    assert.deepEqual(addCivilDays(2026, 10, 31, 1), { year: 2026, month: 11, day: 1 });
    assert.deepEqual(addCivilDays(2024, 2, 28, 1), { year: 2024, month: 2, day: 29 });
  });
});
