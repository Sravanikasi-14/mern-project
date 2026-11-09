import { useEffect, useState } from "react";
import api from "../services/api";

/**
 * Profile photos live behind authenticated API routes (cookie / bearer auth), so a plain
 * <img src> cannot load them cross-origin. Same pattern as the company logo: fetch through the
 * shared axios client as a blob and render an object URL.
 *
 * `src` is the server-provided path (e.g. "/api/auth/avatar?v=123"). The axios baseURL already
 * ends in "/api", so the leading "/api" is stripped. The `?v=` query makes cache-busting work.
 */
const blobUrlCache = new Map();
const MAX_CACHED = 50;

export function toApiRequestPath(src) {
  if (!src || typeof src !== "string") return "";
  if (/^https?:\/\//i.test(src)) return src;
  return src.replace(/^\/api(?=\/)/, "");
}

export default function useAuthedImage(src) {
  const [url, setUrl] = useState(() => (src ? blobUrlCache.get(src) || "" : ""));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (!src) {
      setUrl("");
      return undefined;
    }

    const cached = blobUrlCache.get(src);
    if (cached) {
      setUrl(cached);
      return undefined;
    }

    setUrl("");
    api
      .get(toApiRequestPath(src), { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(res.data);
        if (blobUrlCache.size >= MAX_CACHED) {
          const oldest = blobUrlCache.keys().next().value;
          URL.revokeObjectURL(blobUrlCache.get(oldest));
          blobUrlCache.delete(oldest);
        }
        blobUrlCache.set(src, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setUrl("");
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  return { url, failed };
}
