/**
 * Pure helpers for Company Admin HR Management UI (testable without React).
 */

export function validateHrInviteForm({ fullName, email } = {}) {
  const errors = {};
  const name = typeof fullName === "string" ? fullName.trim() : "";
  const mail = typeof email === "string" ? email.trim() : "";

  if (!name) errors.fullName = "Name is required.";
  if (!mail) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    errors.email = "Please enter a valid email address.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { fullName: name, email: mail.toLowerCase() },
  };
}

export function resolveHrManagementListState({ isLoading, isError, data, error } = {}) {
  if (isLoading && !data) {
    return { state: "loading", message: null };
  }
  if (isError && !data) {
    return {
      state: "error",
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Unable to load HR Admins.",
    };
  }
  const items = data?.items || [];
  if (!items.length) {
    return { state: "empty", message: "No HR Admin accounts yet." };
  }
  return { state: "success", message: null };
}

export function hrAdminActionAvailability(hrAdmin) {
  const invite = hrAdmin?.invitationStatus;
  const active = Boolean(hrAdmin?.isActive);
  return {
    canResend: invite === "PENDING" || invite === "EXPIRED",
    canRevoke: invite === "PENDING" || invite === "EXPIRED",
    canDeactivate: active,
    canActivate: !active && (invite === "ACCEPTED" || Boolean(hrAdmin?.lastLoginAt)),
    canView: true,
  };
}
