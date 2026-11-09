import { useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import AuthedAvatar from "./AuthedAvatar";
import "./ProfilePhotoField.css";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

function initialsOf(name, fallback = "U") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Shared "My Profile" photo control for every authenticated company role.
 * Uploads to POST /auth/profile/avatar (server stores on the User and any linked Employee),
 * removes via DELETE, and then updates AuthContext so the header refreshes immediately.
 */
export default function ProfilePhotoField({ size = 88, onChanged, className = "", hideAvatar = false }) {
  const { user, updateUser } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const displayName = user?.fullName || user?.name || user?.email || "";
  const initials = initialsOf(user?.fullName || user?.name || user?.email?.split("@")[0], "U");
  const hasPhoto = Boolean(user?.avatar);

  const applyResult = (data, text) => {
    if (data?.user) updateUser(data.user);
    setMessage(text);
    if (onChanged) onChanged(data);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Photo must be 2 MB or smaller.");
      return;
    }

    try {
      setBusy(true);
      const fileData = await readAsDataUrl(file);
      const res = await api.post("/auth/profile/avatar", {
        fileName: file.name,
        mimeType: file.type,
        fileData,
      });
      applyResult(res.data, "Profile photo updated.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to upload photo.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setError("");
    setMessage("");
    try {
      setBusy(true);
      const res = await api.delete("/auth/profile/avatar");
      applyResult(res.data, "Profile photo removed.");
    } catch (err) {
      setError(err.response?.data?.message || "Failed to remove photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`profile-photo-field ${className}`.trim()}>
      {hideAvatar ? null : (
        <AuthedAvatar
          className="profile-photo-field__avatar"
          style={{ width: size, height: size, fontSize: Math.round(size / 3) }}
          src={user?.avatar}
          initials={initials}
          alt={displayName ? `${displayName} profile photo` : "Profile photo"}
        />
      )}
      <div className="profile-photo-field__body">
        <div className="profile-photo-field__actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="profile-photo-field__input"
            onChange={handleFile}
            aria-label="Choose profile photo"
          />
          <button
            type="button"
            className="profile-photo-field__btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Working..." : hasPhoto ? "Change photo" : "Upload photo"}
          </button>
          {hasPhoto ? (
            <button
              type="button"
              className="profile-photo-field__btn profile-photo-field__btn--ghost"
              disabled={busy}
              onClick={handleRemove}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="profile-photo-field__hint">PNG, JPEG or WebP, up to 2 MB.</p>
        {error ? (
          <p className="profile-photo-field__msg profile-photo-field__msg--error" role="alert">
            {error}
          </p>
        ) : null}
        {message && !error ? (
          <p className="profile-photo-field__msg" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
