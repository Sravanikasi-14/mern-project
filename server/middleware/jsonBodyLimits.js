/**
 * F72 — JSON body size limits.
 *
 * Default parser is intentionally small. Elevated parsers are mounted on
 * specific paths *before* the default so large face/media payloads still work.
 * FACE_MAX_BASE64_CHARS is 8_000_000 (~6MB decoded); face routes allow 10mb JSON
 * envelope headroom. Avatar/logo/chat image clients cap near 2MB → 3mb JSON.
 */

import express from "express";

export const JSON_BODY_LIMIT_DEFAULT = process.env.JSON_BODY_LIMIT_DEFAULT || "256kb";
export const JSON_BODY_LIMIT_FACE = process.env.JSON_BODY_LIMIT_FACE || "10mb";
export const JSON_BODY_LIMIT_MEDIA = process.env.JSON_BODY_LIMIT_MEDIA || "3mb";

export const defaultJsonParser = express.json({ limit: JSON_BODY_LIMIT_DEFAULT });
export const faceJsonParser = express.json({ limit: JSON_BODY_LIMIT_FACE });
export const mediaJsonParser = express.json({ limit: JSON_BODY_LIMIT_MEDIA });

/**
 * Mount elevated JSON parsers for known large-body routes.
 * Must run before {@link defaultJsonParser}.
 */
export function mountElevatedJsonBodyParsers(app) {
  // Attendance face punch + challenge
  app.use("/api/employees/me/attendance/punch-in", faceJsonParser);
  app.use("/api/employees/me/attendance/punch-out", faceJsonParser);
  app.use("/api/employees/me/attendance/verification-challenge", faceJsonParser);

  // Face enrollment (self + HR-by-id)
  app.use("/api/employees/me/face-enrollment", faceJsonParser);
  app.use("/api/employees/:id/face-enrollment", faceJsonParser);

  // Profile / company branding / chat group image (JSON data-URL uploads)
  app.use("/api/auth/profile/avatar", mediaJsonParser);
  app.use("/api/settings/company/logo", mediaJsonParser);
  app.use("/api/settings/company/signature", mediaJsonParser);
  app.use("/api/conversations/groups", mediaJsonParser);
  // Group image updates use PATCH /api/conversations/:id with JSON data-URL.
  app.use("/api/conversations/:id", mediaJsonParser);
}
