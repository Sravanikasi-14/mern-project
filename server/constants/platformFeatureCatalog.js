/**
 * Canonical Platform Admin feature catalogue.
 * Module/capability keys align with HR portal modules and hrAccessCatalog permissions.
 *
 * --- Catalogue completeness decisions (do not expand without product sign-off) ---
 *
 * Chat (`chat` module): INCLUDED. Covers tenant messaging / conversations
 * (`/api/conversations`). Platform Admin can disable messaging globally or per company.
 * Does NOT cover Ask-AI / chatbot (`/api/chat`).
 *
 * Ask-AI chatbot (`/api/chat`): INTENTIONALLY EXCLUDED from Platform Admin module
 * controls. It is an authenticated assistant overlay (desktop + mobile Ask AI sheet),
 * not an HR portal module. Access remains session-authenticated only. Adding a
 * catalogue entry would change product behaviour and requires an explicit decision
 * (e.g. whether CA/HR/Employee should lose Ask AI when a module is off).
 *
 * Announcements (`/api/announcements`): INTENTIONALLY EXCLUDED as a Platform Admin
 * module. Controlled by tenant HR permissions (`announcements.*`) and company policy,
 * not by plan/global feature toggles. `moduleKeyForHrPermission("announcements.*")`
 * returns null so entitlement middleware does not invent a platform module. Do not
 * add an `announcements` catalogue entry without defining plan entitlement + PA UX.
 *
 * Fail-closed rule: unknown/missing platform module keys deny access; exclusions
 * above are deliberate non-catalogue surfaces, not silent entitlement bypasses for
 * catalogued modules.
 */

/** @typedef {{ key: string, label: string, description?: string, hrPermission?: string, dependsOn?: string[] }} PlatformCapability */
/** @typedef {{ key: string, label: string, description?: string, hrModuleKey?: string, portalModuleIds?: string[], dependsOn?: string[], capabilities: PlatformCapability[] }} PlatformModule */

/** @type {ReadonlyArray<PlatformModule>} */
export const PLATFORM_FEATURE_MODULES = Object.freeze([
  {
    key: "people",
    label: "People Management",
    hrModuleKey: "people",
    portalModuleIds: ["people"],
    capabilities: [
      { key: "people.view", label: "View people", hrPermission: "people.view" },
      { key: "people.create", label: "Create employees", hrPermission: "people.create" },
      { key: "people.edit", label: "Edit employees", hrPermission: "people.edit" },
      { key: "people.import", label: "Import employees", hrPermission: "people.import" },
    ],
  },
  {
    key: "organization",
    label: "Organization",
    hrModuleKey: "organization",
    portalModuleIds: ["organization"],
    capabilities: [
      { key: "organization.view", label: "View organization", hrPermission: "organization.view" },
      { key: "organization.manage", label: "Manage structure", hrPermission: "organization.manage" },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    hrModuleKey: "attendance",
    portalModuleIds: ["attendance"],
    capabilities: [
      { key: "attendance.view", label: "View attendance", hrPermission: "attendance.view" },
      { key: "attendance.approve", label: "Approve remote work", hrPermission: "attendance.approve" },
      { key: "attendance.manage", label: "Manage exceptions", hrPermission: "attendance.manage" },
      {
        key: "attendance.gps",
        label: "GPS verification",
        description: "Location-based attendance checks",
        dependsOn: ["attendance"],
      },
      {
        key: "attendance.wifi",
        label: "Wi-Fi verification",
        description: "Office Wi-Fi attendance checks",
        dependsOn: ["attendance"],
      },
      {
        key: "attendance.faceVerification",
        label: "Face verification",
        description: "Biometric face checks for attendance",
        dependsOn: ["attendance"],
      },
    ],
  },
  {
    key: "liveTracking",
    label: "Live Tracking",
    hrModuleKey: "attendance",
    portalModuleIds: ["live-tracking"],
    dependsOn: ["attendance"],
    capabilities: [
      {
        key: "liveTracking.view",
        label: "View live tracking",
        hrPermission: "attendance.view",
        dependsOn: ["attendance", "liveTracking"],
      },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    hrModuleKey: "leave",
    portalModuleIds: ["leave"],
    capabilities: [
      { key: "leave.view", label: "View leave", hrPermission: "leave.view" },
      { key: "leave.edit", label: "Edit leave", hrPermission: "leave.edit" },
      { key: "leave.approve", label: "Approve leave", hrPermission: "leave.approve" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    hrModuleKey: "payroll",
    portalModuleIds: ["payroll"],
    capabilities: [
      { key: "payroll.view", label: "View payroll", hrPermission: "payroll.view" },
      { key: "payroll.create", label: "Create cycles", hrPermission: "payroll.create" },
      { key: "payroll.calculate", label: "Calculate", hrPermission: "payroll.calculate" },
      { key: "payroll.finalize", label: "Finalize", hrPermission: "payroll.finalize" },
      { key: "payroll.pay", label: "Record payment", hrPermission: "payroll.pay" },
    ],
  },
  {
    key: "settlements",
    label: "Settlements",
    hrModuleKey: "settlements",
    portalModuleIds: ["settlements"],
    capabilities: [
      { key: "settlements.view", label: "View settlements", hrPermission: "settlements.view" },
      { key: "settlements.create", label: "Initiate", hrPermission: "settlements.create" },
      { key: "settlements.edit", label: "Edit", hrPermission: "settlements.edit" },
      { key: "settlements.pay", label: "Record payment", hrPermission: "settlements.pay" },
      { key: "settlements.complete", label: "Complete", hrPermission: "settlements.complete" },
    ],
  },
  {
    key: "hiring",
    label: "Recruitment",
    hrModuleKey: "hiring",
    portalModuleIds: ["hiring"],
    capabilities: [
      { key: "hiring.view", label: "View hiring", hrPermission: "hiring.view" },
      { key: "hiring.create", label: "Create candidates/offers", hrPermission: "hiring.create" },
      { key: "hiring.edit", label: "Edit hiring", hrPermission: "hiring.edit" },
      { key: "hiring.delete", label: "Delete", hrPermission: "hiring.delete" },
    ],
  },
  {
    key: "offers",
    label: "Offer Letters",
    hrModuleKey: "hiring",
    portalModuleIds: ["hiring"],
    dependsOn: ["hiring"],
    capabilities: [
      { key: "offers.send", label: "Send offers", hrPermission: "hiring.send", dependsOn: ["hiring", "offers"] },
      { key: "offers.withdraw", label: "Withdraw offers", hrPermission: "hiring.withdraw", dependsOn: ["hiring", "offers"] },
    ],
  },
  {
    key: "onboarding",
    label: "Onboarding",
    hrModuleKey: "hiring",
    portalModuleIds: ["hiring"],
    dependsOn: ["hiring"],
    capabilities: [
      {
        key: "onboarding.approve",
        label: "Approve onboarding",
        hrPermission: "hiring.approve",
        dependsOn: ["hiring", "onboarding"],
      },
    ],
  },
  {
    key: "chat",
    label: "Chat and Messages",
    portalModuleIds: [],
    capabilities: [
      { key: "chat.use", label: "Use messaging" },
    ],
  },
  {
    key: "work",
    label: "Tasks and Work Management",
    hrModuleKey: "people",
    portalModuleIds: ["work"],
    capabilities: [
      { key: "work.view", label: "View work / tasks", hrPermission: "people.view" },
      { key: "work.manage", label: "Manage tasks", hrPermission: "people.edit" },
    ],
  },
  {
    key: "assets",
    label: "Company Assets",
    hrModuleKey: "assets",
    portalModuleIds: ["assets"],
    capabilities: [
      { key: "assets.view", label: "View assets", hrPermission: "assets.view" },
      { key: "assets.create", label: "Create assets", hrPermission: "assets.create" },
      { key: "assets.edit", label: "Edit assets", hrPermission: "assets.edit" },
      { key: "assets.assign", label: "Assign assets", hrPermission: "assets.assign" },
    ],
  },
  {
    key: "reports",
    label: "Reports and AI Intelligence",
    hrModuleKey: "reports",
    portalModuleIds: ["reports"],
    capabilities: [
      { key: "reports.view", label: "View AI reports", hrPermission: "reports.view" },
    ],
  },
  {
    key: "impact",
    label: "Impact Points",
    hrModuleKey: "impact",
    portalModuleIds: ["impact-points"],
    capabilities: [
      { key: "impact.view", label: "View impact points", hrPermission: "impact.view" },
      { key: "impact.manage", label: "Manage impact points", hrPermission: "impact.manage" },
    ],
  },
  {
    key: "dashboard",
    label: "HR Dashboard",
    hrModuleKey: "dashboard",
    portalModuleIds: ["dashboard"],
    capabilities: [
      { key: "dashboard.view", label: "View dashboard", hrPermission: "dashboard.view" },
    ],
  },
  {
    key: "policies",
    label: "Policies",
    hrModuleKey: "policies",
    portalModuleIds: ["policies-settings"],
    capabilities: [
      { key: "policies.view", label: "View policies", hrPermission: "policies.view" },
      { key: "policies.edit", label: "Edit policies", hrPermission: "policies.edit" },
    ],
  },
  {
    key: "settings",
    label: "Company Settings",
    hrModuleKey: "settings",
    portalModuleIds: ["policies-settings"],
    capabilities: [
      { key: "settings.view", label: "View settings", hrPermission: "settings.view" },
      { key: "settings.edit", label: "Edit settings", hrPermission: "settings.edit" },
    ],
  },
]);

const moduleByKey = new Map(PLATFORM_FEATURE_MODULES.map((m) => [m.key, m]));
const capabilityByKey = new Map();
for (const mod of PLATFORM_FEATURE_MODULES) {
  for (const cap of mod.capabilities) {
    capabilityByKey.set(cap.key, { ...cap, moduleKey: mod.key });
  }
}

/** Permission key (people.view) → platform module key */
const permissionToModule = new Map();
for (const mod of PLATFORM_FEATURE_MODULES) {
  for (const cap of mod.capabilities) {
    if (cap.hrPermission && !permissionToModule.has(cap.hrPermission)) {
      permissionToModule.set(cap.hrPermission, mod.key);
    }
  }
}
// Prefer primary modules for shared permissions
permissionToModule.set("attendance.view", "attendance");
permissionToModule.set("people.view", "people");
permissionToModule.set("hiring.view", "hiring");
permissionToModule.set("hiring.send", "offers");
permissionToModule.set("hiring.withdraw", "offers");
permissionToModule.set("hiring.approve", "onboarding");

export function getPlatformFeatureCatalogPublic() {
  return {
    modules: PLATFORM_FEATURE_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description || "",
      hrModuleKey: m.hrModuleKey || null,
      portalModuleIds: [...(m.portalModuleIds || [])],
      dependsOn: [...(m.dependsOn || [])],
      capabilities: m.capabilities.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description || "",
        hrPermission: c.hrPermission || null,
        dependsOn: [...(c.dependsOn || [])],
      })),
    })),
  };
}

export function getPlatformModule(key) {
  return moduleByKey.get(String(key || "")) || null;
}

export function getPlatformCapability(key) {
  return capabilityByKey.get(String(key || "")) || null;
}

export function listPlatformModuleKeys() {
  return PLATFORM_FEATURE_MODULES.map((m) => m.key);
}

export function listPlatformCapabilityKeys() {
  return [...capabilityByKey.keys()];
}

export function moduleKeyForHrPermission(permissionKey) {
  const key = String(permissionKey || "");
  if (permissionToModule.has(key)) return permissionToModule.get(key);
  const prefix = key.split(".")[0];
  if (moduleByKey.has(prefix)) return prefix;
  if (prefix === "announcements") return null;
  return null;
}

/**
 * Seed blueprint only — runtime entitlements come from PlatformPlan documents.
 * Kept for ensureDefaultPlansSeeded() compatibility.
 */
export const PLATFORM_PLAN_ENTITLEMENTS = Object.freeze({
  TRIAL: { modules: "ALL" },
  GROWTH: { modules: "ALL" },
  ENTERPRISE: { modules: "ALL" },
  BASIC: {
    modules: [
      "dashboard",
      "people",
      "organization",
      "attendance",
      "leave",
      "chat",
      "policies",
      "settings",
    ],
  },
  RESTRICTED: {
    modules: ["dashboard", "people", "settings"],
  },
});

/**
 * @deprecated Prefer planAllowsModuleFromRecord() with a PlatformPlan document.
 * Sync helper used only against the seed blueprint (tests / migration aids).
 */
export function planAllowsModule(plan, moduleKey) {
  const entry = PLATFORM_PLAN_ENTITLEMENTS[String(plan || "").toUpperCase()];
  if (!entry) return false;
  if (entry.modules === "ALL") return true;
  return Array.isArray(entry.modules) && entry.modules.includes(moduleKey);
}
