import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Electronic signature capture: Draw / Upload / Type.
 *
 * onChange({ method: "DRAW"|"UPLOAD"|"TYPE", dataUrl: string, typedText: string })
 *   - dataUrl is a PNG/JPEG/WebP data URL ("" when the current tab is empty)
 *   - typedText is only set for the TYPE tab
 * The parent decides what "valid" means (non-empty dataUrl, or typedText for TYPE).
 */

const TABS = [
  { id: "DRAW", label: "Draw" },
  { id: "UPLOAD", label: "Upload" },
  { id: "TYPE", label: "Type" },
];

const MAX_BYTES = 500 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const CANVAS_W = 480;
const CANVAS_H = 160;
const SCRIPT_FONT = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
const INK = "#1e3a8a";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

/** Render typed text into a transparent PNG so every method yields a real image. */
function typedTextToDataUrl(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = INK;
  ctx.textBaseline = "middle";
  let size = 48;
  ctx.font = `${size}px ${SCRIPT_FONT}`;
  while (ctx.measureText(value).width > CANVAS_W - 24 && size > 18) {
    size -= 2;
    ctx.font = `${size}px ${SCRIPT_FONT}`;
  }
  ctx.fillText(value, 12, 52);
  return canvas.toDataURL("image/png");
}

const styles = {
  wrap: { border: "1px solid var(--hair, #d9dee7)", borderRadius: 10, background: "#fff", overflow: "hidden" },
  tabs: { display: "flex", borderBottom: "1px solid var(--hair, #d9dee7)", background: "#f8fafc" },
  tab: (active) => ({
    flex: 1,
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    background: active ? "#fff" : "transparent",
    color: active ? "var(--g-800, #155a37)" : "var(--muted, #64748b)",
    borderBottom: active ? "2px solid var(--g-800, #155a37)" : "2px solid transparent",
  }),
  body: { padding: 12 },
  canvas: {
    display: "block",
    width: "100%",
    height: "auto",
    aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
    border: "1px dashed var(--hair, #cbd5e1)",
    borderRadius: 8,
    background: "#fff",
    touchAction: "none",
    cursor: "crosshair",
  },
  hint: { margin: "8px 0 0", fontSize: 12, color: "var(--muted, #64748b)" },
  error: { margin: "8px 0 0", fontSize: 12.5, color: "#b91c1c" },
  row: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" },
  btn: {
    padding: "6px 12px",
    fontSize: 12.5,
    borderRadius: 8,
    border: "1px solid var(--hair, #cbd5e1)",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    color: "var(--ink, #0f172a)",
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--hair, #cbd5e1)",
    fontSize: 14,
    boxSizing: "border-box",
  },
  preview: {
    minHeight: 84,
    marginTop: 10,
    padding: "8px 12px",
    border: "1px dashed var(--hair, #cbd5e1)",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    background: "#fff",
    overflow: "hidden",
  },
};

export default function SignatureCapture({
  onChange,
  disabled = false,
  initialMethod = "DRAW",
  defaultTypedText = "",
  maxTypedLength = 60,
  label = "Signature",
}) {
  const [method, setMethod] = useState(initialMethod);
  const [typedText, setTypedText] = useState(defaultTypedText);
  const [uploadUrl, setUploadUrl] = useState("");
  const [drawHasInk, setDrawHasInk] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const drawUrlRef = useRef("");

  const emit = useCallback(
    (next) => {
      if (typeof onChange === "function") onChange(next);
    },
    [onChange]
  );

  const emitForMethod = useCallback(
    (m, overrides = {}) => {
      if (m === "DRAW") {
        emit({ method: "DRAW", dataUrl: overrides.draw ?? drawUrlRef.current, typedText: "" });
      } else if (m === "UPLOAD") {
        emit({ method: "UPLOAD", dataUrl: overrides.upload ?? uploadUrl, typedText: "" });
      } else {
        const text = overrides.typed ?? typedText;
        emit({ method: "TYPE", dataUrl: typedTextToDataUrl(text), typedText: String(text || "").trim() });
      }
    },
    [emit, uploadUrl, typedText]
  );

  // Prepare the drawing surface (HiDPI-safe fixed internal resolution).
  useEffect(() => {
    if (method !== "DRAW") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    if (drawUrlRef.current) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      img.src = drawUrlRef.current;
    }
  }, [method]);

  const pointFromEvent = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const handlePointerDown = (event) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    canvas.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    const p = pointFromEvent(event);
    lastPointRef.current = p;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current || disabled) return;
    const ctx = canvasRef.current.getContext("2d");
    const p = pointFromEvent(event);
    const last = lastPointRef.current || p;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPointRef.current = p;
  };

  const handlePointerUp = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current.releasePointerCapture?.(event.pointerId);
    drawUrlRef.current = canvasRef.current.toDataURL("image/png");
    setDrawHasInk(true);
    setError("");
    emit({ method: "DRAW", dataUrl: drawUrlRef.current, typedText: "" });
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError("");
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Signature image must be 500 KB or smaller.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setUploadUrl(dataUrl);
      emit({ method: "UPLOAD", dataUrl, typedText: "" });
    } catch (err) {
      setError(err.message || "Could not read the selected file.");
    }
  };

  const handleClear = () => {
    setError("");
    if (method === "DRAW") {
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d").clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawUrlRef.current = "";
      setDrawHasInk(false);
      emit({ method: "DRAW", dataUrl: "", typedText: "" });
    } else if (method === "UPLOAD") {
      setUploadUrl("");
      emit({ method: "UPLOAD", dataUrl: "", typedText: "" });
    } else {
      setTypedText("");
      emit({ method: "TYPE", dataUrl: "", typedText: "" });
    }
  };

  const switchTab = (next) => {
    if (next === method || disabled) return;
    setError("");
    setMethod(next);
    emitForMethod(next);
  };

  const handleTyped = (event) => {
    const value = event.target.value.slice(0, maxTypedLength);
    setTypedText(value);
    setError("");
    emitForMethod("TYPE", { typed: value });
  };

  return (
    <div style={styles.wrap} aria-label={label}>
      <div style={styles.tabs} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={method === tab.id}
            style={styles.tab(method === tab.id)}
            onClick={() => switchTab(tab.id)}
            disabled={disabled}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={styles.body}>
        {method === "DRAW" && (
          <>
            <canvas
              ref={canvasRef}
              style={styles.canvas}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              aria-label="Draw your signature"
            />
            <p style={styles.hint}>
              {drawHasInk ? "Looks good? Clear to start over." : "Sign inside the box using your mouse, finger or stylus."}
            </p>
          </>
        )}

        {method === "UPLOAD" && (
          <>
            <label style={{ ...styles.btn, display: "inline-block", margin: 0 }}>
              {uploadUrl ? "Choose a different image" : "Choose signature image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} hidden disabled={disabled} />
            </label>
            <p style={styles.hint}>PNG, JPEG, or WebP, up to 500 KB. A signature on a white or transparent background works best.</p>
            {uploadUrl && (
              <div style={styles.preview}>
                <img src={uploadUrl} alt="Uploaded signature preview" style={{ maxHeight: 80, maxWidth: "100%" }} />
              </div>
            )}
          </>
        )}

        {method === "TYPE" && (
          <>
            <input
              type="text"
              value={typedText}
              onChange={handleTyped}
              placeholder="Type your full name"
              maxLength={maxTypedLength}
              style={styles.input}
              disabled={disabled}
              aria-label="Type your signature"
            />
            <div style={styles.preview} aria-live="polite">
              {typedText.trim() ? (
                <span style={{ fontFamily: SCRIPT_FONT, fontSize: 32, color: INK, lineHeight: 1.2, whiteSpace: "nowrap" }}>
                  {typedText}
                </span>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--muted, #64748b)" }}>Your typed signature preview</span>
              )}
            </div>
          </>
        )}

        <div style={styles.row}>
          <button type="button" style={styles.btn} onClick={handleClear} disabled={disabled}>
            Clear
          </button>
        </div>
        {error && (
          <p style={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** True when a SignatureCapture value is usable (image present, or typed text for TYPE). */
export function isSignatureValueComplete(value) {
  if (!value) return false;
  if (value.method === "TYPE") return Boolean(String(value.typedText || "").trim());
  return Boolean(value.dataUrl);
}
