/**
 * Phase CA4-B — HR Admin access catalog (code-defined).
 * Only actions that exist in current HRMS operational APIs (CA4-A audit).
 * Enforcement across those APIs is deferred to later CA4 stages.
 */

export const HR_SCOPE_MODES = Object.freeze({
  COMPANY: "COMPANY",
  CUSTOM: "CUSTOM",
});

/** @type {ReadonlyArray<{ key: string, label: string, actions: ReadonlyArray<{ key: string, label: string, description?: string }> }>} */
export const HR_ACCESS_MODULES = Object.freeze([
  {
    key: "dashboard",
    label: "Dashboard",
    actions: [{ key: "view", label: "View", description: "View HR Admin dashboard metrics" }],
  },
  {
    key: "people",
    label: "People Management",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Create" },
      { key: "edit", label: "Edit" },
      { key: "import", label: "Import", description: "Bulk employee import" },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    actions: [
      { key: "view", label: "View", description: "Attendance overview and history" },
      { key: "approve", label: "Approve remote work", description: "Approve or reject hybrid remote-work requests" },
      { key: "manage", label: "Manage exceptions", description: "Review location exceptions and regularize attendance" },
    ],
  },
  {
    key: "leave",
    label: "Leave Management",
    actions: [
      { key: "view", label: "View" },
      { key: "edit", label: "Edit", description: "Change leave type / backup proposals" },
      { key: "approve", label: "Approve", description: "Approve or reject leave requests" },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Create cycle" },
      { key: "calculate", label: "Calculate" },
      { key: "finalize", label: "Finalize" },
      { key: "pay", label: "Record payment" },
    ],
  },
  {
    key: "settlements",
    label: "Settlements",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Initiate" },
      { key: "edit", label: "Edit" },
      { key: "pay", label: "Record payment" },
      { key: "complete", label: "Complete" },
    ],
  },
  {
    key: "hiring",
    label: "Hiring & Offers",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Create" },
      { key: "edit", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "send", label: "Send offer" },
      { key: "withdraw", label: "Withdraw offer" },
      { key: "approve", label: "Approve onboarding" },
    ],
  },
  {
    key: "assets",
    label: "Assets",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Create" },
      { key: "edit", label: "Edit" },
      { key: "delete", label: "Delete" },
      { key: "assign", label: "Assign" },
      { key: "return", label: "Return" },
    ],
  },
  {
    key: "organization",
    label: "Organization",
    actions: [
      { key: "view", label: "View" },
      { key: "manage", label: "Manage", description: "Departments, projects, and explorer teams" },
    ],
  },
  {
    key: "policies",
    label: "Policies",
    actions: [
      { key: "view", label: "View" },
      { key: "create", label: "Create" },
      { key: "edit", label: "Edit" },
      { key: "delete", label: "Delete" },
    ],
  },
  {
    key: "settings",
    label: "Company Settings",
    actions: [
      { key: "view", label: "View" },
      { key: "edit", label: "Edit" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    actions: [
      { key: "view", label: "View", description: "HR intelligence / analytics" },
    ],
  },
  {
    key: "impact",
    label: "Impact Points",
    actions: [
      { key: "view", label: "View" },
      { key: "manage", label: "Manage rules / reverse" },
    ],
  },
  {
    key: "announcements",
    label: "Announcements",
    actions: [
      {
        key: "publish",
        label: "Publish",
        description: "Publish announcements to the company or to selected departments",
      },
    ],
  },
]);

const permissionKeySet = new Set();
for (const mod of HR_ACCESS_MODULES) {
  for (const action of mod.actions) {
    permissionKeySet.add(`${mod.key}.${action.key}`);
  }
}

export const HR_PERMISSION_KEYS = Object.freeze([...permissionKeySet]);

export function isValidHrPermissionKey(key) {
  return permissionKeySet.has(String(key || ""));
}

export function getHrAccessCatalogPublic() {
  return {
    scopeModes: Object.values(HR_SCOPE_MODES),
    modules: HR_ACCESS_MODULES.map((mod) => ({
      key: mod.key,
      label: mod.label,
      actions: mod.actions.map((a) => ({
        key: a.key,
        permissionKey: `${mod.key}.${a.key}`,
        label: a.label,
        description: a.description || "",
      })),
    })),
    permissionKeys: [...HR_PERMISSION_KEYS],
  };
}
