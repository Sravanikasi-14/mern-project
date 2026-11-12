import { useCallback, useEffect, useRef, useState } from "react";

const STATUS = {
  IDLE: "IDLE",
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  UNSUPPORTED: "UNSUPPORTED",
};

function StatusPill({ status }) {
  const colors = {
    IDLE: "#64748b",
    PENDING: "#ca8a04",
    VERIFIED: "#15803d",
    FAILED: "#dc2626",
    UNSUPPORTED: "#9333ea",
  };
  const labels = {
    IDLE: "Pending",
    PENDING: "Checking…",
    VERIFIED: "Verified",
    FAILED: "Failed",
    UNSUPPORTED: "Unsupported",
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        color: colors[status] || colors.IDLE,
      }}
    >
      {labels[status] || status}
    </span>
  );
}

/**
 * Captures a single JPEG frame from the user-facing camera for face verification.
 */
export async function captureFaceImageBase64({ facingMode = "user", quality = 0.92 } = {}) {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Camera is not available in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 450));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export default function AttendanceVerificationPanel({
  requirements,
  faceEnrollment,
  gpsStatus = STATUS.IDLE,
  gpsDetail = "",
  wifiStatus = STATUS.IDLE,
  wifiDetail = "",
  faceStatus = STATUS.IDLE,
  faceDetail = "",
  onCaptureFace,
  onEnrollFace,
  capturingFace = false,
  disabled = false,
}) {
  const methods = requirements?.methods || {};
  const showGps = Boolean(methods.gps?.enabled);
  const showWifi = Boolean(methods.wifi?.enabled);
  const showFace = Boolean(methods.face?.enabled);

  if (!showGps && !showWifi && !showFace) return null;

  const faceNeedsEnroll = showFace && !faceEnrollment?.enrolled;

  return (
    <div
      className="attendance-verification-panel"
      style={{
        marginTop: 12,
        padding: "12px 14px",
        border: "1px solid rgba(22, 101, 52, 0.18)",
        borderRadius: 10,
        background: "linear-gradient(180deg, rgba(240,253,244,0.9), rgba(255,255,255,0.95))",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: "#14532d", marginBottom: 8 }}>
        Attendance verification required
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {showGps && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                GPS geofencing {methods.gps?.mandatory ? "(mandatory)" : "(optional)"}
              </div>
              {gpsDetail ? <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{gpsDetail}</div> : null}
            </div>
            <StatusPill status={gpsStatus} />
          </div>
        )}
        {showWifi && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Office Wi-Fi {methods.wifi?.mandatory ? "(mandatory)" : "(optional)"}
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                {wifiDetail ||
                  "Reliable Wi-Fi verification requires the Android HRMS app. Desktop browsers cannot prove the connected network."}
              </div>
            </div>
            <StatusPill status={wifiStatus === STATUS.IDLE ? STATUS.UNSUPPORTED : wifiStatus} />
          </div>
        )}
        {showFace && (
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Face recognition {methods.face?.mandatory ? "(mandatory)" : "(optional)"}
                </div>
                {faceDetail ? <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{faceDetail}</div> : null}
                {faceNeedsEnroll ? (
                  <div style={{ fontSize: 12, color: "#b45309", marginTop: 2 }}>
                    You must enroll your face before punching when face verification is required.
                  </div>
                ) : null}
              </div>
              <StatusPill status={faceStatus} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {faceNeedsEnroll && onEnrollFace ? (
                <button type="button" className="btn-secondary btn-sm" disabled={disabled || capturingFace} onClick={onEnrollFace}>
                  {capturingFace ? "Capturing…" : "Enroll face"}
                </button>
              ) : null}
              {!faceNeedsEnroll && onCaptureFace ? (
                <button type="button" className="btn-secondary btn-sm" disabled={disabled || capturingFace} onClick={onCaptureFace}>
                  {capturingFace ? "Capturing…" : "Capture face for punch"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { STATUS as VERIFICATION_STATUS };

/**
 * Live preview + consent for enrollment.
 */
export function FaceEnrollmentCapture({ onCaptured, onCancel, consentRequired = true }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setError(err.message || "Unable to open camera.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = useCallback(async () => {
    if (consentRequired && !consent) {
      setError("Consent is required to enroll biometric face data.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const video = videoRef.current;
      if (!video) throw new Error("Camera not ready.");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.92);
      onCaptured?.({ imageBase64, consentAccepted: true });
    } catch (err) {
      setError(err.message || "Capture failed.");
    } finally {
      setBusy(false);
    }
  }, [consent, consentRequired, onCaptured]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <video ref={videoRef} playsInline muted style={{ width: "100%", maxWidth: 360, borderRadius: 8, background: "#0f172a" }} />
      <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>
        Center your face, ensure good lighting, and remove sunglasses. Only one face should be visible.
      </p>
      {consentRequired ? (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I consent to my employer storing an encrypted biometric face template for attendance verification. I can revoke
            this enrollment later.
          </span>
        </label>
      ) : null}
      {error ? <div style={{ color: "#dc2626", fontSize: 12 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={capture}>
          {busy ? "Saving…" : "Capture & enroll"}
        </button>
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
