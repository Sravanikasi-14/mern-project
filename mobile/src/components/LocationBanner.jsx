export default function LocationBanner({ status, error, busy, onAsk, onRetry }) {
  if (status === "granted") return null;

  if (status === "denied") {
    return (
      <div className="alert alert-error">
        <div>
          <p>Location is off for this app. Punch in and live tracking need GPS.</p>
          <p className="caption">{error?.action || "Allow location in your device settings, then retry."}</p>
          <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onRetry || onAsk}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="geo-banner">
      <p>This app uses your location only when you punch in, punch out, or start live tracking.</p>
      <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={onAsk} disabled={busy}>
        {busy ? "Asking..." : "Allow location"}
      </button>
    </div>
  );
}
