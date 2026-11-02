# Path B – Onboarding Integration Contract

**Status:** Contract only. Do not reactivate or rebuild paused offer/onboarding UI in this change set.

All employee account creation must go through the shared service:

```js
import { provisionEmployeeAccount, PROVISIONING_SOURCES } from "../services/employeeProvisioningService.js";
```

## When to call

Invoke **only after authorised onboarding approval** (HR_ADMIN, tenant-scoped). Never provision from candidate self-service endpoints.

## Recommended call shape

```js
const result = await provisionEmployeeAccount(
  {
    models: req.auth.models,          // from getCompanyModels(company)
    company: req.auth.company,        // central Company document
    actorUserId: req.auth.user._id,
    actorEmail: req.auth.user.email,
    actorRole: req.auth.user.role,
    clientBaseUrl: process.env.CLIENT_URL,
    ipAddress: req.ip || "",
  },
  {
    fullName: candidate.fullName,
    email: candidate.email,           // must match candidate User.email
    employeeCode,                     // or omit + generateCodeIfMissing: true
    jobTitle,
    department,
    employmentType,
    joiningDate,
    monthlySalary,
    workLocation,
    phoneNumber,
    offerLetterId: offer._id,         // optional link when architecture supports it
  },
  {
    source: PROVISIONING_SOURCES.ONBOARDING,
    existingUserId: candidateUser._id, // reuse CANDIDATE → EMPLOYEE user
    generateCodeIfMissing: true,
    session,                           // prefer a Mongo transaction when available
  }
);
```

## Guarantees

| Concern | Behaviour |
|---|---|
| Duplicate approval retry | Unique indexes + service duplicate checks → `409` / idempotent failure; no second Employee |
| Activation | Same hashed token + `/activate?token=` flow as Path A |
| Role | Always `EMPLOYEE` assigned by backend |
| Email | Service does **not** send mail; caller may email `result.activation.activationLink` if desired |
| Linking | Pass `offerLetterId` and/or set `user.onboarding.employeeId` after success |

## Do not

- Create a parallel CandidateOnboarding collection.
- Create User/Employee documents outside this service.
- Accept client-supplied `role`, `companyId`, or passwords.
- Persist raw activation tokens in logs or employee records.

## Existing approval flow

`approveOnboardingAndCreateEmployee` in `onboardingReviewController.js` remains the live candidate pipeline. When that module is next refactored, replace its inline User/Employee creation with `provisionEmployeeAccount(..., { existingUserId, source: ONBOARDING })` while keeping the `PROCESSING_APPROVAL` lock for concurrency.
