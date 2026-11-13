# Attendance Verification System

Extends the existing HRMS punch-in / punch-out flow with HR-configurable **GPS geofencing**, **Wi-Fi**, and **face recognition**. Legacy companies keep working: all new methods default to **disabled**.

## HR configuration

Policy field: `attendanceVerification` (Admin Policies → Verification).

| Field | Meaning |
| --- | --- |
| `verificationRequired` | If true, at least one method must be enabled |
| `gps.enabled` / `mandatory` | Uses existing `locationRules` office lat/lng/radius/accuracy |
| `wifi.enabled` / `mandatory` | Match against `wifiNetworks[]` (SSID / BSSID) + server challenge |
| `face.enabled` / `mandatory` | Server-side embedding match against enrolled template |
| `face.matchThreshold` | Euclidean distance (default `0.55`, lower = stricter) |
| `face.requireLiveness` | Heuristic gate only — **not** production anti-spoofing |

Authorized remote / WFH sessions do **not** force office GPS verification. Unrelated mandatory methods (Wi-Fi / face) still apply.

`GET /api/policies/active` includes `verificationOperationalStatus` with readiness warnings for HR.

## Platform (informational only)

`AuthSession.clientPlatform` is informational for audit / live-tracking UX.

- Punch gates **never** trust request body or client-supplied platform headers.
- A client-reported Android platform is **not** proof of device authenticity.
- **Do not** put shared secrets in the mobile app. `VITE_HRMS_NATIVE_CLIENT_SECRET` must not be set.
- Google Play Integrity / app-integrity attestation is **not** used in this phase.

## Wi-Fi verification

1. `POST /api/employees/me/attendance/verification-challenge` → single-use `PUNCH` challenge (bound to employee + tenant)
2. Android app reads SSID/BSSID via `@capgo/capacitor-wifi` (handles disabled Wi-Fi, permissions, location requirements, hidden SSID / unknown BSSID)
3. Punch includes `wifiEvidence: { ssid, bssid, capturedAt, challengeId, challengeNonce }`
4. Server validates freshness, authorized networks, then **atomically consumes** the challenge
5. Reused, expired, missing, or invalid evidence is rejected

Client booleans such as `wifiVerified: true` are ignored.

### Limitation (explicit)

SSID/BSSID are **OS-reported best-effort** signals. This is **not** 802.1X / certificate-bound network identity. Challenge binding prevents simple replay of old evidence but cannot stop a compromised device from fabricating OS Wi-Fi fields.

`capturedAt` is **required** when Wi-Fi is mandatory.

## GPS geofencing

Uses the existing location / geofence pipeline (`locationRules`):

- HR configures office coordinates and radius
- Backend calculates distance and validates accuracy / capture timestamp
- Punch-in and punch-out both enforce applicable mandatory rules
- Approved remote / WFH / hybrid workflows continue to work without duplicating geolocation services

## Face recognition

### Dependencies

```bash
cd server
npm install
npm run face:models   # downloads weights into server/assets/face-models
```

Packages: `@vladmandic/face-api`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-cpu`, `@napi-rs/canvas`

Set `FACE_MODELS_DIR` if models live elsewhere. Production startup validates biometric key configuration; missing models keep the engine fail-closed.

### Biometric encryption

| Variable | Purpose |
| --- | --- |
| `FACE_BIOMETRIC_KEY` | **Required in production** (≥32 chars). Generate: `openssl rand -base64 48` |

- Never derived from `JWT_SECRET`
- No hardcoded production fallback
- Dev-only: `ALLOW_INSECURE_FACE_BIOMETRIC_FALLBACK=true`
- **Rotation:** changing the key invalidates existing embeddings — revoke and re-enroll (or migrate offline with the old key)

### Liveness / PAD

Heuristic landmark/confidence checks are **not** production-grade anti-spoofing and **cannot** unlock mandatory face.

| Variable | Purpose |
| --- | --- |
| `FACE_LIVENESS_PROVIDER` | Must be a **registered** id from `faceLivenessProvider.js`. Default `heuristic` keeps mandatory face unavailable. `minifasnet` is reserved for Phase 2 and does **not** unlock until PAD models are implemented and `isReady()` succeeds. Arbitrary strings (e.g. `vendor:foo`) are rejected. |

See [FACE_VERIFICATION_PHASE0.md](./FACE_VERIFICATION_PHASE0.md) for licensing, Vercel constraints, and Phase 2 prerequisites.

Optional face may still be used for readiness testing with heuristic checks; do not treat it as spoof-resistant. **Do not enable mandatory face in production yet.**

## Backend enforcement

1. Authenticate employee; load HR policy
2. Resolve work arrangement / geofence (existing)
3. Resolve platform from AuthSession only (informational; never body/headers)
4. Run Wi-Fi / face gates with challenge binding where required
5. Reject if any mandatory method fails
6. Persist verification audit on the session

## Environment summary

| Variable | Where | Notes |
| --- | --- | --- |
| `FACE_BIOMETRIC_KEY` | server | Required in production |
| `FACE_MODELS_DIR` | server | Optional path override |
| `FACE_LIVENESS_PROVIDER` | server | Strict allowlist only; mandatory face blocked until a registered PAD provider is implemented and ready |
| `ALLOW_LEGACY_NATIVE_HMAC_PROOF` | server tests only | Never enable in production |
| ~~`PLAY_INTEGRITY_*`~~ | — | **Removed — not used** |
| ~~`VITE_HRMS_NATIVE_CLIENT_SECRET`~~ | — | **Removed — do not configure** |

## Remaining blockers before claiming production readiness

1. Phase 2: implement MiniFASNet PAD and register a ready provider (Phase 0/1 only closed the config bypass)
2. Face recognition models installed on every production host (or dedicated face worker)
3. Counsel sign-off on face-api recognition weights **or** migrate to YuNet + SFace (Apache-2.0)
4. Face challenge binding / replay protection
5. `FACE_BIOMETRIC_KEY` set and backed up
6. Wi-Fi remains best-effort OS evidence (no 802.1X claim)
7. Android device smoke tests for permission / location / Wi-Fi / face edge cases
