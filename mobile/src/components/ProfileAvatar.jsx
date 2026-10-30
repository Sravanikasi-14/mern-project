import { useState } from "react";

/**
 * First two letters from a display name.
 * "Sravani" → "SR", "Rahul Kumar" → "RK", missing → "?"
 */
export function initialsFrom(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const word = parts[0].replace(/[^A-Za-z0-9]/g, "");
    if (!word) return "?";
    return word.slice(0, 2).toUpperCase();
  }
  const a = parts[0].replace(/[^A-Za-z0-9]/g, "").charAt(0);
  const b = parts[1].replace(/[^A-Za-z0-9]/g, "").charAt(0);
  const out = `${a}${b}`.toUpperCase();
  return out || "?";
}

function resolvePhotoSrc(photo) {
  if (!photo) return "";
  if (typeof photo === "string") return photo.trim();
  if (typeof photo === "object") {
    return String(photo.url || photo.src || photo.path || "").trim();
  }
  return "";
}

/**
 * Consistent profile identity: photo when available, otherwise initials.
 */
export default function ProfileAvatar({
  name = "",
  photo,
  src,
  avatar,
  size = 40,
  className = "",
  alt = "",
}) {
  const photoSrc = resolvePhotoSrc(photo || src || avatar);
  const [broken, setBroken] = useState(false);
  const showPhoto = Boolean(photoSrc) && !broken;
  const letters = initialsFrom(name);

  return (
    <span
      className={`profile-avatar${showPhoto ? " has-photo" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.34)) }}
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {showPhoto ? (
        <img src={photoSrc} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="profile-avatar__initials">{letters}</span>
      )}
    </span>
  );
}
