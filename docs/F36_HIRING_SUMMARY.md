# F36 — Hiring summary stage calculation

## Audit: how counters were calculated (before)

`GET /api/hiring/candidates` ran **one** aggregation:

1. `buildBaseStages` over **every** `OfferLetter` in the tenant DB  
   - Project list fields (still excluding HTML blobs)  
   - `$lookup` users on `ifNull(candidateUserId, onboardingId)` → `_id` (F34)  
   - Pull section review map, document count, names, timestamps from `User.onboarding`  
   - Derive `stage` via `$switch` mirroring `deriveHiringStage`
2. `$facet`  
   - `counts`: `$group` by `stage` → chip summary  
   - `rows`: filter stage/search → sort → skip/limit  
   - `total`: filtered count  

**Summary chips always used the full derived-stage set** (search/stage filters applied only to `rows`/`total`).

| Counter | How derived |
|---------|-------------|
| `offers` | stage = OFFERS (`status` not ACCEPTED, not WITHDRAWN path; draft/sent/etc.) |
| `onboarding` | ACCEPTED + onboarding not in later stages (default) |
| `hrReview` | ACCEPTED + SUBMITTED / PROCESSING_APPROVAL |
| `corrections` | ACCEPTED + CHANGES_REQUESTED |
| `accountSetup` | ACCEPTED + APPROVED / ACCOUNT_SETUP_* |
| `completed` | ACTIVATED, or onboarding/offer `employeeId` set |
| `rejected` | ACCEPTED + REJECTED |
| `withdrawn` | offer `status` WITHDRAWN |
| `all` | sum of all except `withdrawn` |

Stage-changing writers (not modified in F36; still drive live derivation):

- Offer create / edit / send / withdraw / accept  
- Onboarding submit / request-corrections / approve / reject / activation  
- Linking `offer.employeeId` / `onboarding.employeeId`

## Selected approach (safer than denormalized `hiringStage`)

**Light aggregation for summary + page ids; heavy hydrate only for the current page.**

1. `buildLightStageStages` — same join key + same `stageExpression`, but user projection is only `onboarding.status` + `onboarding.employeeId` (+ ids/updatedAt).  
2. `$facet` → global `counts`, filtered `pageIds`, filtered `total`.  
3. Second aggregate: `buildBaseStages` with `{ _id: { $in: pageIds } }` for list row fields (sections, docsCount, etc.), order preserved in app code.

### Why not persist `hiringStage`?

- Many writers across offer + onboarding + employee linking would need perfect coverage.  
- Missed writers → silent counter drift (explicitly disallowed).  
- Would need backfill + reconciliation + OfferLetter index work (`syncIndexes` forbidden).  
- Light pipeline preserves **exact** semantics with no migration and no consistency window.

Expected improvement is **structural** (less data per offer in the full scan; heavy lookup bounded by page size ≤ 100). It is **not** a measured production latency claim.

## API / semantics

- Response contract unchanged (`candidates`, `summary`, `stage`, `pagination`).  
- Stage definitions unchanged (`deriveHiringStage` / `$switch`).  
- Tenant isolation unchanged (tenant `OfferLetter` / `User` only).  
- No new indexes; no OfferLetter `syncIndexes()`; no migration.

## Files

- `server/controllers/hiringWorkspaceController.js`  
- `server/tests/f36_hiring_summary.test.js`  
- `docs/F36_HIRING_SUMMARY.md`  
- Findings index / Phase 2 status updates  

## Limitations

- Summary still touches every offer once (light path). Very large historical offer sets may still need a later denormalized stage **with** full writer coverage.  
- Two aggregations per list request (light facet + page hydrate).  
- Search still uses case-insensitive regex on offer fields (pre-existing; F58).  
- Explain in tests validates pipeline executability only — not production timing.
