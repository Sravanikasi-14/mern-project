import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";

function statusLabel(status) {
  return status || "—";
}

export default function OfferTemplatesPanel({ onClose }) {
  const [templates, setTemplates] = useState([]);
  const [conversion, setConversion] = useState(null);
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef(null);
  const [uploadTargetId, setUploadTargetId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/offer-templates");
      setTemplates(data.templates || []);
      setConversion(data.conversion || null);
      setStorageConfigured(Boolean(data.storageConfigured));
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateBuilder() {
    if (!newName.trim()) {
      setError("Enter a template name.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await api.post("/offer-templates", {
        name: newName.trim(),
        type: "DEFAULT_BUILDER",
      });
      setNewName("");
      setMessage("Builder template created as draft.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Create failed.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateDocx() {
    if (!newName.trim()) {
      setError("Enter a template name.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const { data } = await api.post("/offer-templates", {
        name: newName.trim(),
        type: "UPLOADED_DOCX",
      });
      setNewName("");
      setMessage("DOCX template shell created. Upload a .docx file next.");
      setUploadTargetId(data.template?.id || null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Create failed.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpload(file) {
    if (!uploadTargetId || !file) return;
    setBusyId(uploadTargetId);
    setError("");
    try {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(new Error("Could not read file."));
        reader.readAsDataURL(file);
      });
      const { data } = await api.post(`/offer-templates/${uploadTargetId}/docx`, {
        fileName: file.name,
        fileData,
        mimeType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (data.suggestedMappings?.length) {
        await api.patch(`/offer-templates/${uploadTargetId}`, {
          placeholderMappings: data.suggestedMappings,
          status: "ACTIVE",
        });
      }
      setMessage("DOCX uploaded and activated with suggested placeholder mappings.");
      setUploadTargetId(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Upload failed.");
    } finally {
      setBusyId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handlePreviewPdf(id) {
    setBusyId(id);
    setError("");
    try {
      const res = await api.post(`/offer-templates/${id}/generate-pdf`, {}, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      let msg = "PDF preview failed.";
      try {
        const text = await err.response?.data?.text?.();
        if (text) {
          const parsed = JSON.parse(text);
          msg = parsed.message || msg;
        }
      } catch {
        msg = err.response?.data?.message || err.message || msg;
      }
      setError(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function handlePreviewDocx(id) {
    setBusyId(id);
    setError("");
    try {
      const res = await api.post(`/offer-templates/${id}/generate-docx`, {}, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = "offer-template-preview.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "DOCX preview failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id) {
    setBusyId(id);
    try {
      await api.patch(`/offer-templates/${id}`, { isDefault: true, status: "ACTIVE" });
      setMessage("Default template updated.");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not set default.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="ol-templates-panel" style={{ padding: "8px 0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Offer templates</h2>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted, #646d67)", fontSize: 13 }}>
            HRMS default builder (HTML/PDF) and optional uploaded Word templates. DOCX→PDF needs a LibreOffice worker URL.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Back to offers
          </button>
        ) : null}
      </div>

      {!conversion?.configured ? (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 8,
            fontSize: 13,
            color: "#9a3412",
          }}
        >
          {conversion?.message ||
            "DOCX to PDF is not configured. Uploaded Word templates remain usable via DOCX preview/download."}
        </div>
      ) : null}

      {!storageConfigured ? (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13,
            color: "#334155",
          }}
        >
          Document storage is temporarily unavailable for this company database. Builder templates still work.
        </div>
      ) : null}

      {error ? (
        <div style={{ marginBottom: 12, color: "#b91c1c", fontSize: 13 }} role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 12, color: "#155a37", fontSize: 13 }}>{message}</div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        <input
          type="text"
          className="filter-select"
          style={{ minWidth: 220, flex: 1 }}
          placeholder="New template name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="button" className="btn-secondary" disabled={creating} onClick={handleCreateBuilder}>
          Add builder template
        </button>
        <button type="button" className="btn-primary" disabled={creating || !storageConfigured} onClick={handleCreateDocx}>
          Add DOCX template
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          style={{ display: "none" }}
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading templates…</p>
      ) : (
        <div className="ol-table-card">
          <div className="ol-table-wrap">
            <table className="ol-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name}
                      {t.isDefault ? (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "#2563eb" }}>Default</span>
                      ) : null}
                      {t.isSystemDefault ? (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "#64748b" }}>HRMS</span>
                      ) : null}
                    </td>
                    <td>{t.type === "UPLOADED_DOCX" ? "Word (DOCX)" : "Builder"}</td>
                    <td>{statusLabel(t.status)}</td>
                    <td>v{t.version}</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {t.type === "DEFAULT_BUILDER" ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busyId === t.id}
                            onClick={() => handlePreviewPdf(t.id)}
                          >
                            Preview PDF
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busyId === t.id}
                              onClick={() => {
                                setUploadTargetId(t.id);
                                fileInputRef.current?.click();
                              }}
                            >
                              Upload DOCX
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busyId === t.id || !t.storage}
                              onClick={() => handlePreviewDocx(t.id)}
                            >
                              Download filled DOCX
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busyId === t.id || !t.storage}
                              onClick={() => handlePreviewPdf(t.id)}
                              title={
                                conversion?.configured
                                  ? "Generate PDF via LibreOffice"
                                  : "Requires LIBREOFFICE_CONVERT_URL"
                              }
                            >
                              PDF (if configured)
                            </button>
                          </>
                        )}
                        {!t.isDefault ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={busyId === t.id || t.status !== "ACTIVE"}
                            onClick={() => handleSetDefault(t.id)}
                          >
                            Set default
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No templates yet. Provisioning creates the HRMS default on first visit.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
