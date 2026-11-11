/**
 * Resolve the authenticated avatar path for an employee-shaped object.
 * Returns "" when no photo is stored so AuthedAvatar can show initials.
 */
export function resolveEmployeeAvatarSrc(employeeOrAvatar) {
  if (!employeeOrAvatar) return "";
  if (typeof employeeOrAvatar === "string") {
    return employeeOrAvatar.trim();
  }
  const direct = employeeOrAvatar.avatar || employeeOrAvatar.avatarUrl || "";
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const id = employeeOrAvatar._id || employeeOrAvatar.id || employeeOrAvatar.employeeId;
  // Only hit the avatar endpoint when the payload indicates a photo exists.
  if (id && (employeeOrAvatar.hasAvatar || employeeOrAvatar.avatarVersion || employeeOrAvatar.avatarUpdatedAt)) {
    return `/api/employees/${id}/avatar`;
  }
  return "";
}

export function initialsFromName(name, fallback = "?") {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] || "" : "";
  return (first + last).toUpperCase() || fallback;
}
