# F42 — Attendance punch notification performance

## Audit summary (Step 1)

| Question | Answer |
|----------|--------|
| When are notifications created? | After a **successful** punch-in/out (and related attendance events). Geofence **BLOCK** uses a separate rejection path. |
| Sequential writes before F42? | Yes — `Notification.create` per HR recipient inside `deliverHrPortalAttendanceNotifications`. |
| Awaited by punch response? | Yes — `await notifyAttendanceStakeholders(...).catch(...)` after attendance is already saved. |
| Duplicate risk on retries? | Client retry after success usually fails “already punched”; F42 adds event `dedupeKey` so re-notify is a no-op. |
| Personal + role broadcast? | Prefer personal docs for active `HR_ADMIN` / `COMPANY_ADMIN` users; if none, role-broadcast fallback (`userId: null`). |
| Required for attendance correctness? | **No.** Punch/audit correctness does not depend on notifications. GPS/Wi-Fi/face/geofence run **before** notify. |

## Architecture (after F42)

```
punchIn / punchOut (attendance already persisted)
  └─ await notifyAttendanceStakeholders({ dedupeKey })
       ├─ optional findOne(metadata.dedupeKey) → skip if present
       ├─ resolveHrPortalNotificationRecipients (one User query)
       ├─ build employee + HR docs (visibility rules unchanged)
       └─ insertMany(docs, { ordered: false })
            └─ on failure: log + return { error }; punch stays successful
```

Notifications remain on the synchronous punch path (awaited) so delivery is durable Mongo persistence — **not** fire-and-forget promises or in-memory queues. Partial `insertMany` success keeps inserted docs (`ordered: false`).

## Failure handling

| Case | Behavior |
|------|----------|
| Punch succeeded, notify throws | Punch HTTP 200; error logged; no attendance rollback |
| Partial insertMany | Inserted recipient docs kept; remainder logged |
| Retry same `dedupeKey` | `{ deduped: true, delivered: 0 }` — no duplicate fan-out |
| Geofence BLOCK | Unchanged rejection + audit; notify path independent of success punch |

## Visibility (unchanged)

- Employee: personal `userId` notification.
- HR Admin / Company Admin: personal notifications when active portal users exist.
- Fallback: `role: HR_ADMIN` and `role: COMPANY_ADMIN` broadcasts.
- Company Admin continues to see HR role broadcasts via existing visibility filter.

## Indexes / migration

| Index | Purpose |
|-------|---------|
| `notifications_metadata_dedupeKey` (sparse) | Faster event-level dedupe lookups |

Applied via Notification schema `createIndexes` during tenant provisioning (`provisionCompany` / `provisionAllTenants`). No OfferLetter `syncIndexes()`. No Redis/Kafka.

## Configuration

No new env flags. Existing punch / geofence / verification policy unchanged.

## Throughput: structural vs measured

| Improvement | Type |
|-------------|------|
| One HR recipient query per notify | **Structural** |
| `insertMany` instead of N sequential `create` | **Structural** (fewer round-trips as HR count grows) |
| Event `dedupeKey` on punch in/out | **Structural** |
| Logged (non-silent) notify failures | **Structural** |

No production latency benchmarks are claimed in CI. Expected: punch notification write time scales closer to **one bulk write** than **O(HR users)** round-trips.

## Files

| File | Change |
|------|--------|
| `services/attendanceLocationService.js` | Bulk insert helpers; dedupe; exported deliver builders |
| `services/attendanceService.js` | Punch dedupeKey + error logging |
| `models/Notification.js` | Sparse `metadata.dedupeKey` index |
| `tests/f42_attendance_notifications.test.js` | Regression suite |
| `docs/F42_ATTENDANCE_NOTIFICATIONS.md` | This doc |

## Remaining limitations

- Notify is still awaited on the punch path (latency includes one bulk write, not zero).
- Hard kill after attendance save but before `insertMany` can lose that event’s notifications (same class of risk as before; punch remains correct).
- Digest / “employee-only for routine success” was **not** adopted — HR Admin + Company Admin recipients preserved per product rules.
