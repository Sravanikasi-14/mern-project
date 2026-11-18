import { GoogleGenAI } from "@google/genai";
import { HttpError } from "../utils/httpError.js";

/**
 * Default Gemini Flash model for Ask-AI / HR analyst.
 * Override with GEMINI_MODEL on the API service (e.g. gemini-2.5-flash,
 * gemini-3.5-flash-lite) when Google rotates model IDs.
 */
export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

let cachedClient = null;
let lastApiKey = null;

/**
 * Resolves the GoogleGenAI client singleton securely using process.env.GEMINI_API_KEY.
 * Never logs or exposes the API key.
 */
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new HttpError(
      503,
      "AI assistant service is currently unavailable. GEMINI_API_KEY is not configured on the server."
    );
  }

  if (!cachedClient || lastApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    lastApiKey = apiKey;
  }

  return cachedClient;
}
