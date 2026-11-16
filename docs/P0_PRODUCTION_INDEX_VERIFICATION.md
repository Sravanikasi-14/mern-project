# P0 production index verification (read-only)

**Date:** 2026-11-13  
**Mode:** READ ONLY — `getIndexes()` only. No create/drop/rebuild, no `syncIndexes()`, no migrations, no app code changes.  
**Tenants inspected:** `company_acme`, `company_globex`, `company_suspended_test`  
**Connection:** existing `server/.env` `MONGO_URI` (credentials not recorded here).

## Verdict

**PASS.** All required P0 indexes are present on all three tenant databases with correct keys, unique/sparse/partial options, and expected names (or equivalent auto-names where schema did not set an explicit name).

OfferLetter `uniq_offer_letter_employeeId_objectId` (unique + partial `$type: objectId`) is intact on all three tenants. No legacy non-unique `employeeId_1` conflict observed.

---

## Expected checklist

| Collection | Expected index | Options |
|------------|----------------|---------|
| `authSessions` | `{ userId: 1, isActive: 1 }` | non-unique |
| `authSessions` | `{ token: 1, isActive: 1 }` | non-unique |
| `notifications` | `{ userId: 1, isRead: 1, createdAt: -1 }` | visibility |
| `notifications` | `{ role: 1, createdAt: -1 }` | visibility |
| `notifications` | `{ userId: 1, createdAt: -1 }` name `notifications_userId_createdAt` | F32 |
| `notifications` | `{ userId: 1, role: 1, createdAt: -1 }` name `notifications_userId_role_createdAt` | F32 |
| `notifications` | `{ metadata.dedupeKey: 1 }` name `notifications_metadata_dedupeKey` | **sparse** (F42) |
| `notification_read_states` | `{ userId: 1, notificationKey: 1 }` name `uniq_notification_read_user_key` | **unique** (F33) |
| `live_tracking_sessions` | `{ startedAt: -1, status: 1 }` | F38 |
| `offer_letters` | `{ employeeId: 1 }` name `uniq_offer_letter_employeeId_objectId` | **unique** + **partial** `{ employeeId: { $type: "objectId" } }` |

---

## Expected vs actual (all tenants)

Status codes: **OK** = present with correct key order and required flags; **MISSING** / **WRONG** would be called out explicitly.

| Tenant | Collection | Expected | Actual name | Key | unique | sparse | partial | Status |
|--------|------------|----------|-------------|-----|--------|--------|---------|--------|
| company_acme | authSessions | `{ userId:1, isActive:1 }` | `userId_1_isActive_1` | `{ userId:1, isActive:1 }` | no | no | — | **OK** |
| company_acme | authSessions | `{ token:1, isActive:1 }` | `token_1_isActive_1` | `{ token:1, isActive:1 }` | no | no | — | **OK** |
| company_acme | notifications | `{ userId:1, isRead:1, createdAt:-1 }` | `userId_1_isRead_1_createdAt_-1` | match | no | no | — | **OK** |
| company_acme | notifications | `{ role:1, createdAt:-1 }` | `role_1_createdAt_-1` | match | no | no | — | **OK** |
| company_acme | notifications | `notifications_userId_createdAt` | present | `{ userId:1, createdAt:-1 }` | no | no | — | **OK** |
| company_acme | notifications | `notifications_userId_role_createdAt` | present | `{ userId:1, role:1, createdAt:-1 }` | no | no | — | **OK** |
| company_acme | notifications | `notifications_metadata_dedupeKey` | present | `{ metadata.dedupeKey:1 }` | no | **yes** | — | **OK** |
| company_acme | notification_read_states | `uniq_notification_read_user_key` | present | `{ userId:1, notificationKey:1 }` | **yes** | no | — | **OK** |
| company_acme | live_tracking_sessions | `{ startedAt:-1, status:1 }` | `startedAt_-1_status_1` | match | no | no | — | **OK** |
| company_acme | offer_letters | `uniq_offer_letter_employeeId_objectId` | present | `{ employeeId:1 }` | **yes** | no | `{ employeeId: { $type: "objectId" } }` | **OK** |
| company_globex | authSessions | `{ userId:1, isActive:1 }` | `userId_1_isActive_1` | match | no | no | — | **OK** |
| company_globex | authSessions | `{ token:1, isActive:1 }` | `token_1_isActive_1` | match | no | no | — | **OK** |
| company_globex | notifications | visibility + F32 compounds | present (same set as acme) | match | — | — | — | **OK** |
| company_globex | notifications | `notifications_metadata_dedupeKey` | present | `{ metadata.dedupeKey:1 }` | no | **yes** | — | **OK** |
| company_globex | notification_read_states | `uniq_notification_read_user_key` | present | `{ userId:1, notificationKey:1 }` | **yes** | no | — | **OK** |
| company_globex | live_tracking_sessions | `{ startedAt:-1, status:1 }` | `startedAt_-1_status_1` | match | no | no | — | **OK** |
| company_globex | offer_letters | `uniq_offer_letter_employeeId_objectId` | present | `{ employeeId:1 }` | **yes** | no | `$type objectId` | **OK** |
| company_suspended_test | authSessions | `{ userId:1, isActive:1 }` | `userId_1_isActive_1` | match | no | no | — | **OK** |
| company_suspended_test | authSessions | `{ token:1, isActive:1 }` | `token_1_isActive_1` | match | no | no | — | **OK** |
| company_suspended_test | notifications | visibility + F32 + dedupeKey | present (same set) | match | dedupe **sparse** | — | — | **OK** |
| company_suspended_test | notification_read_states | `uniq_notification_read_user_key` | present | `{ userId:1, notificationKey:1 }` | **yes** | no | — | **OK** |
| company_suspended_test | live_tracking_sessions | `{ startedAt:-1, status:1 }` | `startedAt_-1_status_1` | match | no | no | — | **OK** |
| company_suspended_test | offer_letters | `uniq_offer_letter_employeeId_objectId` | present | `{ employeeId:1 }` | **yes** | no | `$type objectId` | **OK** |

Also present on all three (supporting, not required by this checklist):  
`notification_read_states.userId_1_readAt_-1`; live tracking `{ employeeId:1, status:1 }`, `{ status:1, expiresAt:1 }`, `{ employeeId:1, createdAt:-1 }`.

---

## Flags and conflicts

| Check | Result |
|-------|--------|
| Sparse on `notifications_metadata_dedupeKey` | **Yes** on all three tenants |
| Unique on `uniq_notification_read_user_key` | **Yes** on all three |
| Unique + partial on OfferLetter employeeId | **Yes** on all three; PFE `{ employeeId: { $type: "objectId" } }` |
| Conflicting indexes (same key, incompatible options) | **None** observed for required keys |
| Legacy OfferLetter `employeeId_1` (non-unique) | **Absent** on all three (desired unique partial is alone) |
| AuthSession also has single-field `token_1` alongside `token_1_isActive_1` | Harmless redundancy; not a conflict |

---

## Missing / incorrect indexes

**None.** No repairs attempted.

---

## Method notes

1. Connected with mongoose using env from `server/.env` (URI not logged).  
2. Listed databases; confirmed the three tenant names exist.  
3. For each tenant, called `collection.indexes()` on `authSessions`, `notifications`, `notification_read_states`, `live_tracking_sessions`, `offer_letters`.  
4. Compared keys (ordered), `unique`, `sparse`, `partialFilterExpression`, and index names against schema expectations.

---

## STOP

Read-only verification complete. No index or application changes were made.
