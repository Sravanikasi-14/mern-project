export default function LocationBanner({ status, error, busy, onAsk, onRetry }) {
  if (status === "granted") return null;

  if (status === "gps-disabled") {
    return (
      <div className="alert alert-error">
        <div>
          <p>Location / GPS is turned off on this device.</p>
          <p className="caption">{error?.action || "Turn on Location in system settings, then retry."}</p>
          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onRetry || onAsk} disabled={busy}>
            {busy ? "Checking..." : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="alert alert-error">
        <div>
          <p>Location is off for this app. Punch in and live tracking need GPS.</p>
          <p className="caption">{error?.action || "Allow location in your device settings, then retry."}</p>
          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onRetry || onAsk} disabled={busy}>
            {busy ? "Asking..." : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (status === "unavailable" || status === "error" || status === "unsupported") {
    return (
      <div className="alert alert-error">
        <div>
          <p>{error?.message || "Location is unavailable right now."}</p>
          <p className="caption">{error?.action || "Please try again."}</p>
          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onRetry || onAsk} disabled={busy}>
            {busy ? "Retrying..." : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  // prompt | prompt-with-rationale | unknown — permission not granted yet
  return (
    <div className="geo-banner">
      <p>This app uses your location only when you punch in, punch out, or start live tracking.</p>
      <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onAsk} disabled={busy}>
        {busy ? "Asking..." : "Allow location"}
      </button>
    </div>
  );
}
