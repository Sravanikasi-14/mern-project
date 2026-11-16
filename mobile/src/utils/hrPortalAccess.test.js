import test from "node:test";
import assert from "node:assert/strict";
import {
  firstAccessiblePath,
  locationAllowed,
  moreItemVisible,
  platformModuleForPath,
  platformModuleAllowed,
} from "./hrPortalAccess.js";

const ALL_ON = Object.freeze({
  dashboard: true,
  people: true,
  organization: true,
  attendance: true,
  liveTracking: true,
  leave: true,
  payroll: true,
  settlements: true,
  hiring: true,
  offers: true,
  onboarding: true,
  chat: true,
  work: true,
  assets: true,
  reports: true,
  impact: true,
  policies: true,
  settings: true,
});

function companyWith(overrides = {}) {
  return {
    hrAccessEnforcement: { mode: "ENFORCED" },
    entitlements: { modules: { ...ALL_ON, ...overrides }, capabilities: {} },
  };
}

test("mobile live tracking path maps to liveTracking not attendance", () => {
  assert.equal(platformModuleForPath("/admin/attendance/live"), "liveTracking");
  assert.equal(platformModuleForPath("/admin/attendance"), "attendance");
  assert.equal(platformModuleForPath("/admin/attendance/abc"), "attendance");
});

test("employee deep links map to platform modules", () => {
  assert.equal(platformModuleForPath("/app/tasks"), "work");
  assert.equal(platformModuleForPath("/app/impact-points"), "impact");
  assert.equal(platformModuleForPath("/app/work-impact"), "impact");
  assert.equal(platformModuleForPath("/app/payslips"), "payroll");
  assert.equal(platformModuleForPath("/app/documents"), "people");
  assert.equal(platformModuleForPath("/app/messages"), "chat");
  assert.equal(platformModuleForPath("/app"), null);
  assert.equal(platformModuleForPath("/app/settings"), null);
  assert.equal(platformModuleForPath("/app/profile"), null);
});

test("disabled module blocks employee and HR deep links", () => {
  const company = companyWith({ work: false, liveTracking: false, chat: false });
  const emp = { role: "EMPLOYEE" };
  const hr = { role: "HR_ADMIN", hrAccess: { permissions: ["people.view", "attendance.view"] } };
  const ca = { role: "COMPANY_ADMIN" };

  assert.equal(locationAllowed(emp, company, "/app/tasks"), false);
  assert.equal(locationAllowed(emp, company, "/app"), true);
  assert.equal(locationAllowed(hr, company, "/admin/work-management"), false);
  assert.equal(locationAllowed(hr, company, "/admin/attendance/live"), false);
  assert.equal(locationAllowed(hr, company, "/admin/attendance"), true);
  assert.equal(locationAllowed(ca, company, "/company/messages"), false);
  assert.equal(locationAllowed(ca, company, "/company"), true);
});

test("missing entitlements fail closed for gated paths", () => {
  const bare = { hrAccessEnforcement: { mode: "OFF" } };
  assert.equal(platformModuleAllowed(bare, "payroll"), false);
  assert.equal(locationAllowed({ role: "EMPLOYEE" }, bare, "/app/payslips"), false);
  assert.equal(locationAllowed({ role: "EMPLOYEE" }, bare, "/app"), true);
});

test("enforced HR without permission is blocked even when module is on", () => {
  const company = companyWith();
  const hr = { role: "HR_ADMIN", hrAccess: { permissions: ["dashboard.view"] } };
  assert.equal(locationAllowed(hr, company, "/admin/payroll"), false);
  assert.equal(locationAllowed(hr, company, "/admin/dashboard"), true);
});

test("more menu hides disabled modules", () => {
  const company = companyWith({ assets: false, work: false });
  const emp = { role: "EMPLOYEE" };
  assert.equal(moreItemVisible(emp, company, { id: "assets", path: "/app/assets" }), false);
  assert.equal(moreItemVisible(emp, company, { id: "tasks", path: "/app/tasks" }), false);
  assert.equal(moreItemVisible(emp, company, { id: "profile", path: "/app/profile" }), true);
});

test("settlements payroll query uses settlements module", () => {
  assert.equal(platformModuleForPath("/admin/payroll", "?tab=ff_settlements"), "settlements");
  assert.equal(platformModuleForPath("/admin/payroll", "?settlementId=x"), "settlements");
  assert.equal(platformModuleForPath("/admin/payroll", ""), "payroll");
  const company = companyWith({ settlements: false });
  const hr = {
    role: "HR_ADMIN",
    hrAccess: { permissions: ["payroll.view", "settlements.view"] },
  };
  assert.equal(locationAllowed(hr, company, "/admin/payroll", "?tab=settlements"), false);
  assert.equal(locationAllowed(hr, company, "/admin/payroll", ""), true);
});

test("firstAccessiblePath falls back to role home or more", () => {
  const company = companyWith({ dashboard: false });
  const hr = { role: "HR_ADMIN", hrAccess: { permissions: [] } };
  // enforcement OFF path: company mode ENFORCED with empty perms blocks dashboard.view
  assert.equal(firstAccessiblePath(hr, company, "/admin/work-management"), "/admin/more");
});
