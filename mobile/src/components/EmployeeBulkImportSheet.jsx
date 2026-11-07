import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import Modal from "./Modal";
import api from "../services/api";
import { documentErrorMessage, saveDocument } from "../services/documents";

const MAX_ROWS = 500; // server rejects larger payloads
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEMPLATE_NAME = "employee-import-template.csv";

const STEPS = [
  { key: "file", label: "File" },
  { key: "preview", label: "Preview" },
  { key: "result", label: "Result" },
];

/**
 * Quote-aware CSV parser (handles "" escapes and newlines inside quotes).
 * CSV-only on mobile: the `xlsx` package is not a mobile dependency.
 */
function parseCsv(text) {
  const src = String(text || "").replace(/^\uFEFF/, "");
  const records = [];
  let cell = "";
  let record = [];
  let inQuotes = false;

  const pushCell = () => {
    record.push(cell.trim());
    cell = "";
  };
  const pushRecord = () => {
    pushCell();
    if (record.some((c) => c !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || record.length) pushRecord();

  if (records.length < 2) return [];
  const headers = records[0].map((h) => h.trim());
  return records.slice(1).map((cells) => {
    const row = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = cells[idx] ?? "";
    });
    return row;
  });
}

function errorList(errors) {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map(String);
  if (typeof errors === "string") return [errors];
  return Object.entries(errors).map(([field, msg]) => `${field}: ${msg}`);
}

export default function EmployeeBulkImportSheet({ open, onClose, onImported }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState("file");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const reset = useCallback(() => {
    setStep("file");
    setFileName("");
    setRows([]);
    setPreview(null);
    setResult(null);
    setBusy(false);
    setTemplateBusy(false);
    setError("");
    setNotice("");
    setShowInvalidOnly(false);
    setCopiedId(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = () => {
    if (busy) return;
    const imported = (result?.summary?.createdCount ?? 0) > 0;
    reset();
    onClose?.(imported);
  };

  const downloadTemplate = async () => {
    setError("");
    setNotice("");
    setTemplateBusy(true);
    try {
      const res = await api.get("/employees/import/template", { responseType: "blob" });
      // CSV is text/*, which blobFromAxiosResponse rejects as non-binary — save the blob directly.
      const blob =
        res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv" });
      await saveDocument({ blob, filename: TEMPLATE_NAME, mimeType: "text/csv" });
      setNotice("Template ready. Fill it in, then choose the file below.");
    } catch (err) {
      setError(documentErrorMessage(err, "Could not download the template."));
    } finally {
      setTemplateBusy(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    setError("");
    setNotice("");
    setPreview(null);
    setResult(null);
    setRows([]);
    setFileName("");
    if (!file) return;

    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
      setError("Please choose a .csv file. Excel files are not supported on mobile — export as CSV first.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("This file is too large. Keep imports under 2 MB.");
      event.target.value = "";
      return;
    }

    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) {
        setError("No data rows found. Make sure the file has a header row and at least one employee.");
        return;
      }
      if (parsed.length > MAX_ROWS) {
        setError(`This file has ${parsed.length} rows. Import up to ${MAX_ROWS} rows at a time.`);
        return;
      }
      setFileName(file.name);
      setRows(parsed);
      const res = await api.post("/employees/import/preview", { rows: parsed });
      setPreview(res.data);
      setShowInvalidOnly(false);
      setStep("preview");
    } catch (err) {
      setError(err.response?.data?.message || "Could not read or validate this file.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const commit = async () => {
    if (!rows.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/employees/import", { rows, importValidOnly: true });
      setResult(res.data);
      setPreview(null);
      setStep("result");
      if ((res.data?.summary?.createdCount ?? 0) > 0) onImported?.(res.data);
    } catch (err) {
      // Server may return per-row failures alongside a non-2xx status.
      if (err.response?.data?.failed || err.response?.data?.summary) {
        setResult(err.response.data);
        setPreview(null);
        setStep("result");
      } else {
        setError(err.response?.data?.message || "Import failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (item) => {
    const link = item.activationLink || item.inviteLink;
    if (!link) return;
    try {
      await navigator.clipboard?.writeText(link);
      setCopiedId(item.employeeId);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setError("Could not copy the link on this device.");
    }
  };

  const summary = preview?.summary || {};
  const validRows = summary.validRows ?? 0;
  const invalidRows = summary.invalidRows ?? 0;
  const previewRows = useMemo(() => {
    const list = preview?.rows || [];
    return showInvalidOnly ? list.filter((r) => !r.valid) : list;
  }, [preview, showInvalidOnly]);

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  let footer = null;
  if (step === "file") {
    footer = (
      <button type="button" className="btn-secondary" onClick={handleClose} disabled={busy}>
        Cancel
      </button>
    );
  } else if (step === "preview") {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={reset} disabled={busy}>
          Choose another
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={commit}
          disabled={busy || validRows < 1}
        >
          {busy ? "Importing..." : `Import ${validRows} valid`}
        </button>
      </>
    );
  } else {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={reset}>
          Import more
        </button>
        <button type="button" className="btn-primary" onClick={handleClose}>
          Done
        </button>
      </>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Import Employees" footer={footer}>
      <div className="ebi">
        <ol className="ebi-steps" aria-label="Import progress">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={`ebi-step${i === stepIndex ? " is-current" : ""}${i < stepIndex ? " is-done" : ""}`}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              <span>{i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {error ? (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice && !error ? <div className="alert alert-ok">{notice}</div> : null}

        {step === "file" ? (
          <div className="ebi-section">
            <p className="caption">
              Add many people at once from a CSV file. Every row is validated before anything is
              created. Duplicate emails or employee codes are rejected.
            </p>

            <div className="ebi-card">
              <div className="ebi-card-head">
                <FileSpreadsheet size={18} strokeWidth={1.85} aria-hidden="true" />
                <strong>1. Download the template</strong>
              </div>
              <p className="caption">
                Columns: fullName, email, employeeCode, jobTitle, department, employmentType,
                joiningDate, monthlySalary, projectName, workLocation, phoneNumber,
                reportingManagerCode.
              </p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={downloadTemplate}
                disabled={templateBusy || busy}
              >
                <Download size={16} strokeWidth={1.85} aria-hidden="true" />
                {templateBusy ? "Preparing..." : "Download template"}
              </button>
            </div>

            <div className="ebi-card">
              <div className="ebi-card-head">
                <Upload size={18} strokeWidth={1.85} aria-hidden="true" />
                <strong>2. Choose your filled CSV</strong>
              </div>
              <p className="caption">CSV only · up to {MAX_ROWS} rows · max 2 MB.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv"
                hidden
                onChange={handleFile}
                disabled={busy}
              />
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? "Validating..." : "Choose CSV file"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "preview" && preview ? (
          <div className="ebi-section">
            <p className="caption">{fileName}</p>
            <div className="ebi-stats">
              <div>
                <strong>{summary.totalRows ?? rows.length}</strong>
                <span>Total</span>
              </div>
              <div className="is-ok">
                <strong>{validRows}</strong>
                <span>Valid</span>
              </div>
              <div className={invalidRows ? "is-bad" : ""}>
                <strong>{invalidRows}</strong>
                <span>Invalid</span>
              </div>
            </div>

            {invalidRows > 0 ? (
              <div className="alert alert-warn">
                {validRows > 0
                  ? `${invalidRows} row(s) have errors and will be skipped. Only the ${validRows} valid row(s) will be imported.`
                  : "No valid rows to import. Fix the errors in your file and choose it again."}
              </div>
            ) : null}

            {invalidRows > 0 && validRows > 0 ? (
              <label className="ebi-toggle">
                <input
                  type="checkbox"
                  checked={showInvalidOnly}
                  onChange={(e) => setShowInvalidOnly(e.target.checked)}
                />
                Show invalid rows only
              </label>
            ) : null}

            <ul className="ebi-list">
              {previewRows.map((r) => (
                <li key={r.rowIndex} className={r.valid ? "is-valid" : "is-invalid"}>
                  <div className="ebi-row-head">
                    <span className="ebi-row-num">Row {r.rowIndex + 1}</span>
                    <span className={`ebi-chip ${r.valid ? "is-ok" : "is-bad"}`}>
                      {r.valid ? "Valid" : "Invalid"}
                    </span>
                  </div>
                  <strong>{r.data?.fullName || "—"}</strong>
                  <span className="ebi-meta">
                    {r.data?.email || "—"} · {r.data?.employeeCode || "—"}
                  </span>
                  {!r.valid
                    ? errorList(r.errors).map((msg) => (
                        <span key={msg} className="ebi-err">
                          {msg}
                        </span>
                      ))
                    : null}
                </li>
              ))}
              {previewRows.length === 0 ? <li className="ebi-empty">No rows to show.</li> : null}
            </ul>
          </div>
        ) : null}

        {step === "result" && result ? (
          <div className="ebi-section">
            <div className="ebi-done">
              <CheckCircle2 size={22} strokeWidth={1.85} aria-hidden="true" />
              <strong>{result.message || "Import completed."}</strong>
            </div>
            <div className="ebi-stats">
              <div className="is-ok">
                <strong>{result.summary?.createdCount ?? (result.created || []).length}</strong>
                <span>Created</span>
              </div>
              <div className={(result.summary?.failedCount ?? (result.failed || []).length) ? "is-bad" : ""}>
                <strong>{result.summary?.failedCount ?? (result.failed || []).length}</strong>
                <span>Failed</span>
              </div>
              <div>
                <strong>{result.summary?.invalidRows ?? 0}</strong>
                <span>Skipped</span>
              </div>
            </div>

            {(result.failed || []).length > 0 ? (
              <>
                <p className="caption">Failed rows</p>
                <ul className="ebi-list">
                  {result.failed.map((f, i) => (
                    <li key={`${f.rowIndex}-${i}`} className="is-invalid">
                      <span className="ebi-row-num">Row {Number(f.rowIndex) + 1}</span>
                      {f.data?.fullName || f.data?.email ? (
                        <strong>{f.data?.fullName || f.data?.email}</strong>
                      ) : null}
                      {errorList(f.errors || f.message).map((msg) => (
                        <span key={msg} className="ebi-err">
                          {msg}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {(result.created || []).length > 0 ? (
              <>
                <p className="caption">
                  Created — activation links are shown only now. Copy and share them securely.
                </p>
                <ul className="ebi-list">
                  {result.created.map((c) => (
                    <li key={c.employeeId || c.email} className="is-valid">
                      <strong>
                        {c.fullName}
                        {c.employeeCode ? ` (${c.employeeCode})` : ""}
                      </strong>
                      <span className="ebi-meta">{c.email}</span>
                      {c.activationLink || c.inviteLink ? (
                        <button
                          type="button"
                          className="btn-secondary btn-sm ebi-copy"
                          onClick={() => copyLink(c)}
                        >
                          {copiedId === c.employeeId ? "Copied" : "Copy activation link"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
