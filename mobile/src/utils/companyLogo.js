import api from "../services/api";

let cachedKey = "";
let cachedUrl = "";
let inflight = null;

/**
 * Loads the company logo via authenticated blob download and caches the object URL.
 */
export async function loadCompanyLogoObjectUrl(logoKey = "default") {
  const key = String(logoKey || "default");
  if (cachedUrl && cachedKey === key) return cachedUrl;
  if (inflight && cachedKey === key) return inflight;

  cachedKey = key;
  inflight = (async () => {
    const res = await api.get("/auth/company-logo", { responseType: "blob" });
    if (cachedUrl) URL.revokeObjectURL(cachedUrl);
    cachedUrl = URL.createObjectURL(res.data);
    return cachedUrl;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function clearCompanyLogoCache() {
  if (cachedUrl) URL.revokeObjectURL(cachedUrl);
  cachedUrl = "";
  cachedKey = "";
  inflight = null;
}
