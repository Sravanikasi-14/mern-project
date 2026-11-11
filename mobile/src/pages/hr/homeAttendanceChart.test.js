import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const home = readFileSync(join(root, "HomePage.jsx"), "utf8");
const chart = readFileSync(join(root, "../../components/AttendanceCapsuleChart.jsx"), "utf8");

describe("mobile HR attendance chart data source", () => {
  it("prefers overview week and ends calendar fallback at today", () => {
    assert.doesNotMatch(home, /calendarDays\.slice\(\s*-7\s*\)/);
    assert.match(home, /overview\.week \|\| overview\.days/);
    assert.match(home, /isToday/);
    assert.match(home, /end - 6/);
    assert.match(home, /calendarDays\.slice\(start, end \+ 1\)/);
  });

  it("caps chart series only when longer than a week", () => {
    assert.match(chart, /days\.length > 7 \? days\.slice\(-7\) : days/);
    assert.doesNotMatch(chart, /const source = Array\.isArray\(days\) \? days\.slice\(-7\)/);
  });
});
