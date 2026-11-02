# Known limitation: Offer-letter send HTTP 502 (SMTP / email)

**Status:** Pre-existing / environmental  
**Scope:** Offer letter email delivery only  
**Not caused by:** Employee provisioning pathways (A/B/C), shared `provisionEmployeeAccount`, activation, or auth changes

## Symptom

Full suite failure in:

- File: `tests/policy_configuration_workflows.test.js`
- Test: `5. Downstream Integration: Offer Letter expiration dynamically honors policy offerValidityDays`
- Assertion: `POST /api/offer-letters/:id/send` returns **502** instead of **200**

## Cause

Offer-letter send depends on company SMTP / email delivery. When outbound mail is unavailable or misconfigured in the test/runtime environment, the send endpoint surfaces **502**. This is independent of employee account provisioning, which intentionally does **not** send activation emails.

## Impact

- Manual employee create, bulk import, activation links, and multi-tenant login are unaffected.
- HR can still create/send offer drafts when SMTP is correctly configured for the tenant.
- Path A/C activation continues to use copyable links without SMTP.

## Remediation (separate workstream)

1. Configure tenant SMTP (`emailSettings`) or test doubles for mail transport.
2. Optionally make offer-letter send degrade gracefully (token created, email optional) — product decision, not part of provisioning.
3. Do **not** change `employeeProvisioningService`, auth, or employee create APIs to “fix” this failure.
