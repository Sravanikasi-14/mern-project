# Known limitation: Offer-letter send HTTP 502 (SMTP / email)

**Status:** Documented environmental dependency (tests should mock SMTP)  
**Scope:** Offer letter email delivery only  
**Not caused by:** Employee provisioning pathways (A/B/C), shared `provisionEmployeeAccount`, activation, or auth changes

## Symptom

`POST /api/offer-letters/:id/send` returns **502** when tenant SMTP is unconfigured or delivery fails.

Historically this also failed:

- File: `tests/policy_configuration_workflows.test.js`
- Test: `5. Downstream Integration: Offer Letter expiration dynamically honors policy offerValidityDays`

That workflow test now configures tenant `emailSettings` and injects a mock transporter via `emailService.setTransporter`, matching `offer_letter_email.test.js`.

## Cause

Offer-letter send depends on company SMTP / email delivery. When outbound mail is unavailable or misconfigured, the send endpoint surfaces **502**. This is independent of employee account provisioning, which intentionally does **not** send activation emails.

## Impact

- Manual employee create, bulk import, activation links, and multi-tenant login are unaffected.
- HR can still create/send offer drafts when SMTP is correctly configured for the tenant.
- Path A/C activation continues to use copyable links without SMTP.

## Remediation

1. Production: configure tenant SMTP (`emailSettings`).
2. Automated tests: always mock `emailService` (do not rely on real SMTP).
3. Do **not** change `employeeProvisioningService`, auth, or employee create APIs to “fix” SMTP failures.
