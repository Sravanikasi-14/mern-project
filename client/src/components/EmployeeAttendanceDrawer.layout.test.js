import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const drawerSrc = readFileSync(
  join(root, "client/src/components/EmployeeAttendanceDrawer.jsx"),
  "utf8"
);
const modalCss = readFileSync(join(root, "client/src/components/AppModal.css"), "utf8");
const attendanceCss = readFileSync(join(root, "client/src/pages/Attendance.css"), "utf8");

describe("EmployeeAttendanceDrawer profile layout contracts", () => {
  test("profile row uses att-drawer-emp-profile, not avatar class on the wrapper", () => {
    assert.match(drawerSrc, /className="att-drawer-emp-profile"/);
    assert.doesNotMatch(
      drawerSrc,
      /className="att-drawer-emp-avatar"\s+style=\{\{\s*display:\s*"flex"/
    );
    assert.match(drawerSrc, /className="att-drawer-emp-info"/);
    assert.match(drawerSrc, /className="att-drawer-emp-meta"/);
  });

  test("AuthedAvatar keeps the avatar class without shrinking the profile row", () => {
    assert.match(
      drawerSrc,
      /<AuthedAvatar[\s\S]*?className="att-drawer-emp-avatar"/
    );
    assert.match(modalCss, /\.att-drawer-emp-avatar\s*\{[\s\S]*?flex:\s*0\s+0\s+48px/);
    assert.match(modalCss, /\.att-drawer-emp-info\s*\{[\s\S]*?min-width:\s*0/);
  });

  test("modal body scrolls when content exceeds available height", () => {
    assert.match(
      modalCss,
      /\.app-modal-panel\.att-employee-drawer\s+\.app-modal-body\s*\{[\s\S]*?overflow-y:\s*auto/
    );
    assert.match(
      modalCss,
      /\.app-modal-panel\.att-employee-drawer\s+\.app-modal-body\s*\{[\s\S]*?min-height:\s*0/
    );
    assert.doesNotMatch(
      modalCss,
      /\.app-modal-panel\.att-employee-drawer\s+\.app-modal-body\s*\{[^}]*overflow:\s*visible/
    );
  });

  test("profile section has spacing before calendar content", () => {
    assert.match(
      modalCss,
      /\.att-drawer-emp-profile\s*\{[\s\S]*?margin:[^;]*16px/
    );
  });

  test("shared attendance drawer avatar styles remain non-shrinking", () => {
    assert.match(attendanceCss, /\.att-drawer-emp-avatar\s*\{[\s\S]*?flex:\s*0\s+0\s+56px/);
    assert.match(attendanceCss, /\.att-drawer-emp-info\s*\{[\s\S]*?min-width:\s*0/);
  });
});
