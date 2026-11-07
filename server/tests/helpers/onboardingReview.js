/**
 * Shared helpers for onboarding review tests (section-wise HR approval).
 */
import request from "supertest";

export const ONBOARDING_SECTIONS = [
  "personalDetails",
  "residentialAddress",
  "emergencyContact",
  "bankAndTax",
  "documents",
];

/** HR approves a single onboarding section. */
export async function approveSection(app, hrCookie, submissionId, section, note = "") {
  return request(app)
    .post(`/api/onboarding/submissions/${submissionId}/sections/${section}/review`)
    .set("Cookie", hrCookie)
    .send({ decision: "APPROVE", note });
}

/** HR approves every required section; asserts each call succeeds. */
export async function approveAllSections(app, hrCookie, submissionId, sections = ONBOARDING_SECTIONS) {
  const results = [];
  for (const section of sections) {
    const res = await approveSection(app, hrCookie, submissionId, section);
    if (res.status !== 200) {
      throw new Error(
        `Failed approving section ${section}: ${res.status} ${JSON.stringify(res.body)}`
      );
    }
    results.push(res);
  }
  return results;
}
