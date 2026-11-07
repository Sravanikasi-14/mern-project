import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import api from "../../services/api";

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  const mb = size / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function fileUrl(conversationId, messageId, fileId) {
  return `/conversations/${conversationId}/messages/${messageId}/attachments/${fileId}`;
}

async function fetchFile(conversationId, messageId, fileId) {
  const response = await api.get(fileUrl(conversationId, messageId, fileId), { responseType: "blob" });
  return response.data;
}

function ChatImage({ conversationId, messageId, file }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setFailed(false);
    fetchFile(conversationId, messageId, file.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, messageId, file.id]);

  if (failed) return <p className="msg-muted">Image could not be loaded.</p>;
  if (!url) return <p className="msg-muted">Loading image…</p>;
  return <img className="msg-attachment-image" src={url} alt={file.fileName} />;
}

function FileCard({ conversationId, messageId, file }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await fetchFile(conversationId, messageId, file.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file.fileName || "download";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = String(file.fileName || "").split(".").pop()?.toUpperCase() || "FILE";
  return (
    <div className="msg-file-card">
      <FileText size={18} aria-hidden="true" />
      <span className="msg-file-copy">
        <strong>{file.fileName}</strong>
        <span>{typeLabel} · {formatSize(file.size)}</span>
      </span>
      <button type="button" className="btn-secondary btn-sm" onClick={download} disabled={busy}>
        {busy ? "Downloading…" : "Download"}
      </button>
      {failed ? <span className="msg-file-error">Download failed.</span> : null}
    </div>
  );
}

export default function MessageAttachments({ conversationId, messageId, files }) {
  if (!files?.length) return null;
  return (
    <div className="msg-attachments">
      {files.map((file) => (
        String(file.mimeType || "").startsWith("image/")
          ? <ChatImage key={file.id} conversationId={conversationId} messageId={messageId} file={file} />
          : <FileCard key={file.id} conversationId={conversationId} messageId={messageId} file={file} />
      ))}
    </div>
  );
}

export function formatAttachmentSize(bytes) {
  return formatSize(bytes);
}
