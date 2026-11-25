import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { computeWeeklyBars } from "./attendanceTrendsModel.js";

const root = dirname(fileURLToPath(import.meta.url));
const attendanceTrendsSrc = readFileSync(join(root, "AttendanceTrends.jsx"), "utf8");
const adminDashboardSrc = readFileSync(join(root, "../pages/AdminDashboard.jsx"), "utf8");

describe("AttendanceTrends pure calculations", () => {
  it("returns empty array when source data is absent", () => {
    assert.deepEqual(computeWeeklyBars({}, [], 10, "7D"), []);
    assert.deepEqual(computeWeeklyBars(null, null, 0, "TODAY"), []);
  });

  it("calculates percentage and height scaling for 7D overview", () => {
    const overview = {
      activeEmployees: 50,
      week: [
        { date: "2026-11-16", dayOfWeek: 1, present: 45, absent: 3, late: 2, onLeave: 0, isToday: false },
        { date: "2026-11-17", dayOfWeek: 2, present: 25, absent: 20, late: 5, onLeave: 0, isToday: false },
        { date: "2026-11-18", dayOfWeek: 3, present: 0, absent: 50, late: 0, onLeave: 0, isToday: true },
      ],
    };
    const bars = computeWeeklyBars(overview, [], 50, "7D");
    assert.equal(bars.length, 3);

    // 45 / 50 = 90% (peak)
    assert.equal(bars[0].pct, 90);
    assert.ok(bars[0].heightVal >= 0.18);
    assert.equal(bars[0].dayLetter, "M");

    // 25 / 50 = 50% (light)
    assert.equal(bars[1].pct, 50);
    assert.equal(bars[1].present, 25);

    // 0 present -> minimal height floor 0.08
    assert.equal(bars[2].pct, 0);
    assert.equal(bars[2].heightVal, 0.08);
    assert.equal(bars[2].isToday, true);
  });

  it("extracts today's record accurately in TODAY mode", () => {
    const overview = {
      days: [
        { date: "2026-11-17", dayOfWeek: 2, present: 30, isToday: false },
        { date: "2026-11-18", dayOfWeek: 3, present: 42, isToday: true },
      ],
    };
    const bars = computeWeeklyBars(overview, [], 50, "TODAY");
    assert.equal(bars.length, 1);
    assert.equal(bars[0].isToday, true);
    assert.equal(bars[0].present, 42);
    assert.equal(bars[0].pct, 84);
  });

  it("slices 30 days accurately in 30D mode", () => {
    const thirtyDays = Array.from({ length: 30 }, (_, idx) => ({
      date: `2026-11-${String(idx + 1).padStart(2, "0")}`,
      dayOfWeek: (idx + 1) % 7,
      present: 40,
      absent: 10,
    }));
    const bars = computeWeeklyBars({ thirtyDays }, [], 50, "30D");
    assert.equal(bars.length, 30);
    assert.equal(bars[0].pct, 80);
    assert.equal(bars[29].pct, 80);
  });
});

describe("AdminDashboard & AttendanceTrends isolation contracts", () => {
  it("verifies hoveredDay state is removed from AdminDashboard root", () => {
    assert.doesNotMatch(
      adminDashboardSrc,
      /const\s*\[\s*hoveredDay\s*,\s*setHoveredDay\s*\]\s*=\s*useState/
    );
    assert.doesNotMatch(adminDashboardSrc, /setHoveredDay\(/);
    assert.doesNotMatch(adminDashboardSrc, /onMouseEnter=\{\(\)\s*=>\s*setHoveredDay/);
  });

  it("verifies attendanceRange state is removed from AdminDashboard root", () => {
    assert.doesNotMatch(
      adminDashboardSrc,
      /const\s*\[\s*attendanceRange\s*,\s*setAttendanceRange\s*\]\s*=\s*useState/
    );
  });

  it("verifies weeklyBars calculation is removed from AdminDashboard root", () => {
    assert.doesNotMatch(adminDashboardSrc, /const\s+weeklyBars\s*=/);
    assert.doesNotMatch(adminDashboardSrc, /const\s+hasAttendanceTrendData\s*=/);
  });

  it("verifies AdminDashboard delegates to AttendanceTrends component", () => {
    assert.match(adminDashboardSrc, /import\s+AttendanceTrends\s+from\s+["']\.\.\/components\/AttendanceTrends["']/);
    assert.match(adminDashboardSrc, /<AttendanceTrends\b/);
  });

  it("verifies AttendanceTrends encapsulates hoveredDay and memoizes export", () => {
    assert.match(
      attendanceTrendsSrc,
      /const\s*\[\s*hoveredDay\s*,\s*setHoveredDay\s*\]\s*=\s*useState/
    );
    assert.match(attendanceTrendsSrc, /setHoveredDay\(bar\)/);
    assert.match(attendanceTrendsSrc, /setHoveredDay\(null\)/);
    assert.match(attendanceTrendsSrc, /export\s+default\s+memo\(AttendanceTrends\)/);
  });
});
