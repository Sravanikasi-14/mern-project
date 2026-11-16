process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPLOYEE_RELATIONSHIPS } from "../services/employeeRelationshipService.js";
import { serializePeopleSearchHit } from "../services/employeeVisibilityService.js";
import {
  buildPeopleSearchQuery,
  hitMatchesAuthorizedQuery,
  PEOPLE_SEARCH_MAX_LIMIT,
} from "../services/employeePeopleSearchService.js";

describe("serializePeopleSearchHit (global search hierarchy)", () => {
  const base = {
    _id: "507f1f77bcf86cd799439011",
    fullName: "Ada Lovelace",
    employeeCode: "E001",
    email: "ada@example.com",
    avatar: "https://example.com/a.png",
    phoneNumber: "9999999999",
    bankDetails: { accountNumber: "secret" },
    job: {
      jobTitle: "Engineer",
      department: "R&D",
      workLocation: "HQ",
      employmentType: "Full-time",
    },
  };

  it("UPWARD returns name + designation only", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.DIRECT_MANAGER);
    assert.equal(hit.fullName, "Ada Lovelace");
    assert.equal(hit.jobTitle, "Engineer");
    assert.equal(hit.visibilityTier, "UPWARD");
    assert.equal(hit.canOpenProfile, false);
    assert.equal(hit.email, undefined);
    assert.equal(hit.employeeCode, undefined);
    assert.equal(hit.department, undefined);
    assert.equal(hit.avatar, undefined);
    assert.equal(hit.phoneNumber, undefined);
    assert.equal(hit.bankDetails, undefined);
    assert.equal(hit.employmentType, undefined);
  });

  it("OTHER returns name + designation only", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.OTHER);
    assert.equal(hit.fullName, "Ada Lovelace");
    assert.equal(hit.jobTitle, "Engineer");
    assert.equal(hit.canOpenProfile, false);
    assert.equal(hit.email, undefined);
    assert.equal(hit.department, undefined);
    assert.equal(hit.employmentType, undefined);
    assert.equal(hit.phoneNumber, undefined);
  });

  it("PEER includes professional fields + email + employmentType, not phone", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.PEER);
    assert.equal(hit.department, "R&D");
    assert.equal(hit.employeeCode, "E001");
    assert.equal(hit.workLocation, "HQ");
    assert.equal(hit.email, "ada@example.com");
    assert.equal(hit.employmentType, "Full-time");
    assert.equal(hit.phoneNumber, undefined);
    assert.equal(hit.canOpenProfile, true);
  });

  it("DOWNWARD includes professional fields + email, not phone", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.DIRECT_REPORT);
    assert.equal(hit.employeeCode, "E001");
    assert.equal(hit.department, "R&D");
    assert.equal(hit.avatar, "https://example.com/a.png");
    assert.equal(hit.workLocation, "HQ");
    assert.equal(hit.employmentType, "Full-time");
    assert.equal(hit.email, "ada@example.com");
    assert.equal(hit.phoneNumber, undefined);
    assert.equal(hit.canOpenProfile, true);
  });

  it("SELF includes email and phone for self-search", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.SELF);
    assert.equal(hit.email, "ada@example.com");
    assert.equal(hit.phoneNumber, "9999999999");
    assert.equal(hit.bankDetails, undefined);
    assert.equal(hit.canOpenProfile, true);
  });

  it("HR expanded includes email and phone but never bank", () => {
    const hit = serializePeopleSearchHit(base, EMPLOYEE_RELATIONSHIPS.OTHER, {
      hrExpanded: true,
    });
    assert.equal(hit.email, "ada@example.com");
    assert.equal(hit.phoneNumber, "9999999999");
    assert.equal(hit.department, "R&D");
    assert.equal(hit.employmentType, "Full-time");
    assert.equal(hit.bankDetails, undefined);
    assert.equal(hit.canOpenProfile, true);
  });
});

describe("buildPeopleSearchQuery", () => {
  it("searches multiple identity and job attributes", () => {
    const query = buildPeopleSearchQuery("Ada");
    assert.equal(query.status, "ACTIVE");
    assert.ok(Array.isArray(query.$or));
    const fields = query.$or.map((clause) => Object.keys(clause)[0]);
    assert.ok(fields.includes("fullName"));
    assert.ok(fields.includes("employeeCode"));
    assert.ok(fields.includes("job.jobTitle"));
    assert.ok(fields.includes("job.department"));
    assert.ok(fields.includes("job.workLocation"));
    assert.ok(fields.includes("job.employmentType"));
    assert.ok(fields.includes("email"));
    assert.ok(fields.includes("phoneNumber"));
  });

  it("adds digit-tolerant phone matching for numeric queries", () => {
    const query = buildPeopleSearchQuery("99999");
    assert.ok(query.$or.some((clause) => clause.phoneNumber instanceof RegExp));
  });

  it("exports a bounded max limit", () => {
    assert.ok(PEOPLE_SEARCH_MAX_LIMIT <= 20);
  });
});

describe("hitMatchesAuthorizedQuery (no restricted-attribute leak)", () => {
  it("allows match on name/title for UPWARD hits", () => {
    const hit = {
      fullName: "Ada Lovelace",
      jobTitle: "Engineer",
      visibilityTier: "UPWARD",
    };
    assert.equal(hitMatchesAuthorizedQuery(hit, "Ada"), true);
    assert.equal(hitMatchesAuthorizedQuery(hit, "Eng"), true);
  });

  it("rejects department/email/phone when those fields are not on the hit", () => {
    const hit = {
      fullName: "Ada Lovelace",
      jobTitle: "Engineer",
      visibilityTier: "OTHER",
    };
    assert.equal(hitMatchesAuthorizedQuery(hit, "R&D"), false);
    assert.equal(hitMatchesAuthorizedQuery(hit, "HQ"), false);
    assert.equal(hitMatchesAuthorizedQuery(hit, "Full"), false);
    assert.equal(hitMatchesAuthorizedQuery(hit, "E001"), false);
    assert.equal(hitMatchesAuthorizedQuery(hit, "ada@"), false);
    assert.equal(hitMatchesAuthorizedQuery(hit, "99999"), false);
  });

  it("allows partial matches on authorized PEER/DOWNWARD fields", () => {
    const peer = {
      fullName: "Ada Lovelace",
      jobTitle: "Software Development Engineer",
      department: "R&D",
      employeeCode: "E001",
      workLocation: "HQ",
      email: "ada@example.com",
      employmentType: "Full-time",
    };
    assert.equal(hitMatchesAuthorizedQuery(peer, "R&"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "E0"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "HQ"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "ada@"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "Development"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "Full-time"), true);
    assert.equal(hitMatchesAuthorizedQuery(peer, "example.com"), true);
  });

  it("allows preferredName alias when fullName is visible", () => {
    const hit = { fullName: "Augusta Ada King", jobTitle: "Engineer" };
    assert.equal(
      hitMatchesAuthorizedQuery(hit, "Ada", { preferredName: "Ada" }),
      true
    );
  });

  it("matches phone digits only when phoneNumber is authorized on the hit", () => {
    const restricted = { fullName: "Ada Lovelace", jobTitle: "Engineer" };
    const hr = {
      fullName: "Ada Lovelace",
      jobTitle: "Engineer",
      phoneNumber: "+91 99999 88888",
    };
    assert.equal(hitMatchesAuthorizedQuery(restricted, "99999"), false);
    assert.equal(hitMatchesAuthorizedQuery(hr, "999998"), true);
  });
});
