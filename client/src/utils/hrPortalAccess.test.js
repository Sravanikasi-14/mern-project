import test from "node:test";
import assert from "node:assert/strict";
import {
  HR_PORTAL_MODULES,
  adminLocationAllowed,
  firstAccessibleHrPath,
  visibleHrPortalModules,
} from "./hrPortalAccess.js";

const enforced = { hrAccessEnforcement: { mode: "ENFORCED" } };
const off = { hrAccessEnforcement: { mode: "OFF" } };

function hr(permissions) {
  return { role: "HR_ADMIN", hrAccess: { permissions } };
}

test("company admin sees every module with HR Management second", () => {
  const labels = visibleHrPortalModules({ role: "COMPANY_ADMIN" }, enforced).map((item) => item.label);
  assert.deepEqual(labels, [
    "Dashboard",
    "HR Management",
    "Employees",
    "Attendance",
    "Live Tracking",
    "Leave",
    "Payroll",
    "Settlements",
    "Hiring & Onboarding",
    "Assets",
    "Organization",
    "Policies & Settings",
    "Reports",
    "Impact Points",
    "Work",
  ]);
  assert.equal(HR_PORTAL_MODULES.filter((item) => item.companyAdminOnly).length, 1);
});

test("enforced HR admin hides modules without the view permission", () => {
  const labels = visibleHrPortalModules(
    hr(["dashboard.view", "people.view", "settlements.view"]),
    enforced
  ).map((item) => item.label);
  assert.deepEqual(labels, ["Dashboard", "Employees", "Settlements", "Work"]);
  assert.equal(labels.includes("HR Management"), false);
  assert.equal(labels.includes("Payroll"), false);

  const withoutPeople = visibleHrPortalModules(hr(["dashboard.view", "settlements.view"]), enforced)
    .map((item) => item.label);
  assert.deepEqual(withoutPeople, ["Dashboard", "Settlements"]);
});

test("enforcement off keeps the full HR catalog except HR Management", () => {
  const labels = visibleHrPortalModules(hr([]), off).map((item) => item.label);
  assert.equal(labels.includes("HR Management"), false);
  assert.equal(labels.includes("Payroll"), true);
  assert.equal(labels.includes("Settlements"), true);
  assert.equal(labels.length, HR_PORTAL_MODULES.length - 1);
});

test("employees receive no HR portal modules", () => {
  assert.deepEqual(visibleHrPortalModules({ role: "EMPLOYEE" }, enforced), []);
});

test("a blocked module URL redirects to the first other allowed module", () => {
  const user = hr(["dashboard.view", "attendance.view"]);
  assert.equal(adminLocationAllowed(user, enforced, "/admin/payroll", ""), false);
  assert.equal(adminLocationAllowed(user, enforced, "/admin/attendance", ""), true);
  assert.equal(adminLocationAllowed(user, enforced, "/admin/hr-management", ""), false);
  assert.equal(
    firstAccessibleHrPath(user, enforced, "/admin/payroll"),
    "/admin/dashboard"
  );
  assert.equal(
    firstAccessibleHrPath(user, enforced, "/admin/dashboard"),
    "/admin/attendance"
  );
});

test("payroll and settlements use separate view permissions", () => {
  const settlementsOnly = hr(["dashboard.view", "settlements.view"]);
  assert.equal(adminLocationAllowed(settlementsOnly, enforced, "/admin/payroll", ""), false);
  assert.equal(
    adminLocationAllowed(settlementsOnly, enforced, "/admin/payroll", "?tab=ff_settlements"),
    true
  );
  assert.equal(
    firstAccessibleHrPath(settlementsOnly, enforced, "/admin/payroll"),
    "/admin/payroll?tab=ff_settlements"
  );
  const labels = visibleHrPortalModules(settlementsOnly, enforced).map((item) => item.label);
  assert.equal(labels.includes("Payroll"), false);
  assert.equal(labels.includes("Settlements"), true);

  const payrollOnly = hr(["dashboard.view", "payroll.view"]);
  assert.equal(
    adminLocationAllowed(payrollOnly, enforced, "/admin/payroll", "?settlementId=abc"),
    false
  );
  assert.equal(
    firstAccessibleHrPath(payrollOnly, enforced, "/admin/payroll?tab=ff_settlements"),
    "/admin/payroll"
  );
  const payrollLabels = visibleHrPortalModules(payrollOnly, enforced).map((item) => item.label);
  assert.equal(payrollLabels.includes("Payroll"), true);
  assert.equal(payrollLabels.includes("Settlements"), false);

  const neither = hr(["dashboard.view"]);
  assert.equal(firstAccessibleHrPath(neither, enforced, "/admin/payroll"), "/admin/dashboard");
  const neitherLabels = visibleHrPortalModules(neither, enforced).map((item) => item.label);
  assert.equal(neitherLabels.includes("Payroll"), false);
  assert.equal(neitherLabels.includes("Settlements"), false);
});

test("policies and settings share one nav entry and keep separate routes", () => {
  const both = hr(["policies.view", "settings.view"]);
  const bothNav = visibleHrPortalModules(both, enforced);
  assert.equal(bothNav.filter((item) => item.label === "Policies & Settings").length, 1);
  assert.equal(bothNav.find((item) => item.id === "policies-settings").path, "/admin/policies");
  assert.equal(adminLocationAllowed(both, enforced, "/admin/policies", ""), true);
  assert.equal(adminLocationAllowed(both, enforced, "/admin/settings", ""), true);

  const policiesOnly = hr(["dashboard.view", "policies.view"]);
  assert.equal(
    visibleHrPortalModules(policiesOnly, enforced).find((item) => item.id === "policies-settings").path,
    "/admin/policies"
  );
  assert.equal(adminLocationAllowed(policiesOnly, enforced, "/admin/settings", ""), false);
  assert.equal(firstAccessibleHrPath(policiesOnly, enforced, "/admin/settings"), "/admin/policies");

  const settingsOnly = hr(["dashboard.view", "settings.view"]);
  assert.equal(
    visibleHrPortalModules(settingsOnly, enforced).find((item) => item.id === "policies-settings").path,
    "/admin/settings"
  );
  assert.equal(adminLocationAllowed(settingsOnly, enforced, "/admin/policies", ""), false);
  assert.equal(firstAccessibleHrPath(settingsOnly, enforced, "/admin/policies"), "/admin/settings");

  const none = hr(["dashboard.view"]);
  assert.equal(
    visibleHrPortalModules(none, enforced).some((item) => item.id === "policies-settings"),
    false
  );
});

test("messages stay available when HR module permissions are limited", () => {
  const limited = hr(["dashboard.view"]);
  assert.equal(adminLocationAllowed(limited, enforced, "/admin/messages", ""), true);
  assert.equal(visibleHrPortalModules(limited, enforced).some((item) => item.id === "messages"), false);
});

test("company admin is not filtered by HR permissions", () => {
  const user = { role: "COMPANY_ADMIN" };
  assert.equal(adminLocationAllowed(user, enforced, "/admin/payroll", ""), true);
  assert.equal(adminLocationAllowed(user, enforced, "/admin/hr-management", ""), true);
});
