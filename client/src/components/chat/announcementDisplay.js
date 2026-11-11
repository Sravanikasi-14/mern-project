export const PRIORITY_LABEL = Object.freeze({
  NORMAL: "Normal",
  IMPORTANT: "Important",
  URGENT: "Urgent",
});

export const STATUS_LABEL = Object.freeze({
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  WITHDRAWN: "Archived",
  ARCHIVED: "Archived",
});

export function formatAnnouncementDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function announcementTiming(item) {
  if (!item) return { iso: "", label: "", kind: "" };
  if (item.status === "PUBLISHED" && item.publishedAt) {
    return { iso: item.publishedAt, label: formatAnnouncementDate(item.publishedAt), kind: "published" };
  }
  if (item.status === "SCHEDULED" && item.scheduledAt) {
    return { iso: item.scheduledAt, label: formatAnnouncementDate(item.scheduledAt), kind: "scheduled" };
  }
  if (item.status === "WITHDRAWN" && (item.withdrawnAt || item.publishedAt || item.createdAt)) {
    const iso = item.withdrawnAt || item.publishedAt || item.createdAt;
    return { iso, label: formatAnnouncementDate(iso), kind: "withdrawn" };
  }
  const iso = item.createdAt || item.updatedAt || "";
  return { iso, label: formatAnnouncementDate(iso), kind: "created" };
}

export function audienceLabelFor(item) {
  if (!item) return "";
  if (item.audience === "DEPARTMENTS" || item.audienceType === "DEPARTMENTS") {
    const names = (item.departmentNames || []).filter(Boolean);
    return names.length ? names.join(", ") : "Selected departments";
  }
  return "Entire company";
}

export function timingPrefix(kind) {
  if (kind === "published") return "Published";
  if (kind === "scheduled") return "Scheduled";
  if (kind === "withdrawn") return "Archived";
  return "Created";
}
