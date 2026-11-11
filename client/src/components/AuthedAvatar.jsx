import useAuthedImage from "../hooks/useAuthedImage";
import { initialsFromName, resolveEmployeeAvatarSrc } from "../utils/employeeAvatar";

/**
 * Circular photo (loaded through the authenticated API client) with an initials fallback.
 * Prefer `src` or an employee-shaped `employee` / `avatar` field from APIs.
 */
export default function AuthedAvatar({
  src,
  employee,
  avatar,
  name,
  initials,
  alt = "",
  className = "",
  style,
  imgClassName = "",
}) {
  const resolvedSrc =
    src ||
    resolveEmployeeAvatarSrc(avatar) ||
    resolveEmployeeAvatarSrc(employee);
  const { url, failed } = useAuthedImage(resolvedSrc);
  const label =
    initials ||
    initialsFromName(name || employee?.fullName || employee?.name || alt || "", "?");

  return (
    <span className={className} style={style} title={alt || name || undefined}>
      {url && !failed ? (
        <img
          className={imgClassName}
          src={url}
          alt={alt || name || ""}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" }}
        />
      ) : (
        <span aria-hidden="true">{label}</span>
      )}
    </span>
  );
}
