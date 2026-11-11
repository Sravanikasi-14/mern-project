process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUNCH_ELIGIBILITY_CODES,
  describeLocationExceptionPunchEligibility,
  describeRemoteRequestPunchEligibility,
  evaluateApprovedSessionPeriod,
} from "../services/attendanceLocationService.js";

const hybrid = { job: { workArrangement: { mode: "HYBRID" } } };
const office = { job: { workArrangement: { mode: "OFFICE" } } };
const wfh = { job: { workArrangement: { mode: "WFH" } } };
const policyRequired = { workArrangementRules: { hybridRemoteApprovalRequired: true } };

describe("remote request punch eligibility", () => {
  it("marks pending hybrid requests as approval pending", () => {
    const result = describeRemoteRequestPunchEligibility({
      request: { status: "PENDING", workDate: "2026-11-11", sessionPeriod: {} },
      employee: hybrid,
      policy: policyRequired,
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T10:00:00+05:30"),
    });
    assert.equal(result.code, PUNCH_ELIGIBILITY_CODES.APPROVAL_PENDING);
    assert.equal(result.label, "Approval pending");
    assert.equal(result.remotePunchAllowed, false);
    assert.equal(result.officePunchAllowed, true);
  });

  it("allows remote punch only on the approved unused date within the window", () => {
    const allowed = describeRemoteRequestPunchEligibility({
      request: {
        status: "APPROVED",
        workDate: "2026-11-11",
        sessionPeriod: { startTime: "09:00", endTime: "18:00" },
        consumedAt: null,
      },
      employee: hybrid,
      policy: policyRequired,
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(allowed.code, PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED);
    assert.equal(allowed.remotePunchAllowed, true);

    const outsideDate = describeRemoteRequestPunchEligibility({
      request: {
        status: "APPROVED",
        workDate: "2026-11-10",
        sessionPeriod: {},
        consumedAt: null,
      },
      employee: hybrid,
      policy: policyRequired,
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(outsideDate.code, PUNCH_ELIGIBILITY_CODES.REMOTE_NOT_AUTHORIZED);
    assert.equal(outsideDate.remotePunchAllowed, false);

    const consumed = describeRemoteRequestPunchEligibility({
      request: {
        status: "APPROVED",
        workDate: "2026-11-11",
        sessionPeriod: {},
        consumedAt: new Date("2026-11-11T09:30:00+05:30"),
      },
      employee: hybrid,
      policy: policyRequired,
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(consumed.remotePunchAllowed, false);
  });

  it("requires office location for OFFICE mode and keeps rejected requests unauthorized", () => {
    const officeResult = describeRemoteRequestPunchEligibility({
      request: { status: "APPROVED", workDate: "2026-11-11", sessionPeriod: {} },
      employee: office,
      policy: policyRequired,
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(officeResult.code, PUNCH_ELIGIBILITY_CODES.OFFICE_LOCATION_REQUIRED);
    assert.equal(officeResult.remotePunchAllowed, false);

    const rejected = describeRemoteRequestPunchEligibility({
      request: { status: "REJECTED", workDate: "2026-11-11" },
      employee: hybrid,
      policy: policyRequired,
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(rejected.label, "Remote attendance not authorized");
    assert.equal(rejected.remotePunchAllowed, false);
  });

  it("allows WFH remote punch under work mode without treating the request as the only grant", () => {
    const result = describeRemoteRequestPunchEligibility({
      request: { status: "PENDING", workDate: "2026-11-11" },
      employee: wfh,
      policy: { workArrangementRules: { wfhLocationMode: "WFH_UNRESTRICTED" } },
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(result.code, PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED);
    assert.equal(result.remotePunchAllowed, true);
    assert.equal(result.officePunchAllowed, false);
  });
});

describe("location exception punch eligibility", () => {
  it("never lets an exception grant remote rights", () => {
    const open = describeLocationExceptionPunchEligibility({
      exception: { status: "OPEN", type: "OUTSIDE_GEOFENCE", sessionType: "OFFICE" },
      employee: hybrid,
      policy: policyRequired,
      activeRemoteApproval: null,
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(open.exceptionGrantsRemote, false);
    assert.equal(open.remotePunchAllowed, false);
    assert.equal(open.code, PUNCH_ELIGIBILITY_CODES.EXCEPTION_PENDING_REVIEW);
    assert.equal(open.label, "Exception pending review");

    const reviewed = describeLocationExceptionPunchEligibility({
      exception: { status: "REVIEWED", type: "OUTSIDE_GEOFENCE" },
      employee: hybrid,
      policy: policyRequired,
      activeRemoteApproval: null,
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(reviewed.exceptionGrantsRemote, false);
    assert.equal(reviewed.remotePunchAllowed, false);
    assert.equal(reviewed.label, "Remote attendance not authorized");
  });

  it("shows remote allowed when a separate approved request authorizes today", () => {
    const result = describeLocationExceptionPunchEligibility({
      exception: { status: "OPEN", type: "LOW_ACCURACY" },
      employee: hybrid,
      policy: policyRequired,
      activeRemoteApproval: {
        _id: "req1",
        status: "APPROVED",
        workDate: "2026-11-11",
        sessionPeriod: {},
        consumedAt: null,
      },
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(result.remotePunchAllowed, true);
    assert.equal(result.exceptionGrantsRemote, false);
    assert.equal(result.code, PUNCH_ELIGIBILITY_CODES.REMOTE_PUNCH_ALLOWED);
    assert.match(result.detail, /not by this location exception/i);
  });

  it("keeps OFFICE employees on office location required / pending review", () => {
    const result = describeLocationExceptionPunchEligibility({
      exception: { status: "OPEN", type: "PUNCH_OUTSIDE" },
      employee: office,
      policy: policyRequired,
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(result.remotePunchAllowed, false);
    assert.equal(result.officePunchAllowed, true);
    assert.equal(result.exceptionGrantsRemote, false);
  });
});

describe("approved session period evaluation", () => {
  it("accepts all-day and rejects outside windows without throwing", () => {
    assert.equal(
      evaluateApprovedSessionPeriod({
        sessionPeriod: {},
        workDate: "2026-11-11",
        companyTimezone: "Asia/Kolkata",
        now: new Date("2026-11-11T23:50:00+05:30"),
      }).ok,
      true
    );
    const outside = evaluateApprovedSessionPeriod({
      sessionPeriod: { startTime: "09:00", endTime: "10:00" },
      workDate: "2026-11-11",
      companyTimezone: "Asia/Kolkata",
      now: new Date("2026-11-11T12:00:00+05:30"),
    });
    assert.equal(outside.ok, false);
    assert.ok(outside.message);
  });
});
