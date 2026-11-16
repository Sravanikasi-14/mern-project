import test from "node:test";
import assert from "node:assert/strict";
import {
  HR_PORTAL_MODULES,
  adminLocationAllowed,
  firstAccessibleHrPath,
  platformModuleForAdminPath,
  visibleHrPortalModules,
} from "./hrPortalAccess.js";

const ALL_MODULES_ON = Object.freeze({
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

function companyWith(entitlementOverrides = {}, extra = {}) {
  return {
    hrAccessEnforcement: { mode: "ENFORCED" },
    entitlements: {
      modules: { ...ALL_MODULES_ON, ...entitlementOverrides },
      capabilities: {},
    },
    ...extra,
  };
}

const enforced = companyWith();
const off = companyWith({}, { hrAccessEnforcement: { mode: "OFF" } });

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
    "AI Reports",
    "Impact Points",
    "Work",
  ]);
  assert.equal(HR_PORTAL_MODULES.filter((item) => item.companyAdminOnly).length, 1);
});

test("enforced HR admin keeps entitled modules visible without view permission", () => {
  const labels = visibleHrPortalModules(
    hr(["dashboard.view", "people.view", "settlements.view"]),
    enforced
  ).map((item) => item.label);
  // Nav stays visible; content access is enforced by HrModuleGate / adminLocationAllowed.
  assert.equal(labels.includes("Dashboard"), true);
  assert.equal(labels.includes("Employees"), true);
  assert.equal(labels.includes("Payroll"), true);
  assert.equal(labels.includes("Settlements"), true);
  assert.equal(labels.includes("HR Management"), false);
  assert.equal(adminLocationAllowed(hr(["dashboard.view"]), enforced, "/admin/payroll", ""), false);
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
  assert.equal(labels.includes("Payroll"), true);
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
  assert.equal(payrollLabels.includes("Settlements"), true);

  const neither = hr(["dashboard.view"]);
  assert.equal(firstAccessibleHrPath(neither, enforced, "/admin/payroll"), "/admin/dashboard");
  const neitherLabels = visibleHrPortalModules(neither, enforced).map((item) => item.label);
  assert.equal(neitherLabels.includes("Payroll"), true);
  assert.equal(neitherLabels.includes("Settlements"), true);
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
    true
  );
  assert.equal(adminLocationAllowed(none, enforced, "/admin/policies", ""), false);
});

test("messages stay available when HR module permissions are limited but chat is entitled", () => {
  const limited = hr(["dashboard.view"]);
  assert.equal(adminLocationAllowed(limited, enforced, "/admin/messages", ""), true);
  assert.equal(visibleHrPortalModules(limited, enforced).some((item) => item.id === "messages"), false);
});

test("company admin is not filtered by HR permissions when modules are entitled", () => {
  const user = { role: "COMPANY_ADMIN" };
  assert.equal(adminLocationAllowed(user, enforced, "/admin/payroll", ""), true);
  assert.equal(adminLocationAllowed(user, enforced, "/admin/hr-management", ""), true);
});

test("platform entitlements block company admin deep links", () => {
  const user = { role: "COMPANY_ADMIN" };
  const payrollOff = companyWith({ payroll: false });
  assert.equal(adminLocationAllowed(user, payrollOff, "/admin/payroll", ""), false);
  assert.equal(adminLocationAllowed(user, payrollOff, "/admin/dashboard", ""), true);
  assert.equal(adminLocationAllowed(user, payrollOff, "/admin/hr-management", ""), true);

  const workOff = companyWith({ work: false });
  assert.equal(platformModuleForAdminPath("/admin/work-management"), "work");
  assert.equal(adminLocationAllowed(user, workOff, "/admin/work-management", ""), false);
  // people remains available even when work is off
  assert.equal(adminLocationAllowed(user, workOff, "/admin", ""), true);

  const missingEntitlements = { hrAccessEnforcement: { mode: "OFF" } };
  assert.equal(adminLocationAllowed(user, missingEntitlements, "/admin/payroll", ""), false);
});

test("work path uses work module gate independent of people entitlement alone", () => {
  const user = hr(["dashboard.view", "people.view"]);
  const peopleOnWorkOff = companyWith({ work: false });
  assert.equal(adminLocationAllowed(user, peopleOnWorkOff, "/admin/work-management", ""), false);
  assert.equal(
    visibleHrPortalModules(user, peopleOnWorkOff).some((item) => item.id === "work"),
    false
  );

  const bothOn = companyWith({ work: true, people: true });
  assert.equal(adminLocationAllowed(user, bothOn, "/admin/work-management", ""), true);
});

test("chat entitlement gates messages URL", () => {
  const user = hr(["dashboard.view"]);
  const chatOff = companyWith({ chat: false });
  assert.equal(adminLocationAllowed(user, chatOff, "/admin/messages", ""), false);
});

test("live tracking path uses liveTracking module not only attendance permission", () => {
  const user = hr(["dashboard.view", "attendance.view"]);
  const trackingOff = companyWith({ liveTracking: false });
  assert.equal(platformModuleForAdminPath("/admin/live-tracking"), "liveTracking");
  assert.equal(platformModuleForAdminPath("/admin/attendance/live"), "liveTracking");
  assert.equal(adminLocationAllowed(user, trackingOff, "/admin/live-tracking", ""), false);
  assert.equal(adminLocationAllowed(user, trackingOff, "/admin/attendance/live", ""), false);
  assert.equal(adminLocationAllowed(user, trackingOff, "/admin/attendance", ""), true);
});
