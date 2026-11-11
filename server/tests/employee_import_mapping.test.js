process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalImportField,
  collectUnrecognizedImportHeaders,
  mapImportRowDetailed,
  mapImportRowToCanonical,
  normalizeMappedCell,
} from "../utils/employeeImportMapping.js";

describe("employee import header mapping", () => {
  it("maps official template headers and workforce-export aliases", () => {
    assert.equal(canonicalImportField("fullName"), "fullName");
    assert.equal(canonicalImportField("employee_id"), "employeeCode");
    assert.equal(canonicalImportField("Employee ID"), "employeeCode");
    assert.equal(canonicalImportField("name"), "fullName");
    assert.equal(canonicalImportField("title"), "jobTitle");
    assert.equal(canonicalImportField("hire_date"), "joiningDate");
    assert.equal(canonicalImportField("salary"), "monthlySalary");
    assert.equal(canonicalImportField("location"), "workLocation");
    assert.equal(canonicalImportField("manager_id"), "reportingManagerCode");
  });

  it("maps sample CSV-shaped rows without inventing email", () => {
    const mapped = mapImportRowToCanonical({
      employee_id: "E-180",
      name: "Asha Nair",
      department: "Engineering",
      title: "Software Engineer",
      hire_date: "2024-03-01",
      salary: "85000",
      location: "Hyderabad",
      manager_id: "E-001",
    });

    assert.equal(mapped.employeeCode, "E-180");
    assert.equal(mapped.fullName, "Asha Nair");
    assert.equal(mapped.department, "Engineering");
    assert.equal(mapped.jobTitle, "Software Engineer");
    assert.equal(mapped.joiningDate, "2024-03-01");
    assert.equal(mapped.monthlySalary, "85000");
    assert.equal(mapped.workLocation, "Hyderabad");
    assert.equal(mapped.reportingManagerCode, "E-001");
    assert.equal(mapped.email, undefined);
  });

  it("prefers non-blank values when both alias and canonical keys appear", () => {
    const mapped = mapImportRowToCanonical({
      name: "",
      fullName: "Priya Shah",
      employee_id: "P-9",
      email: "priya@example.com",
    });
    assert.equal(mapped.fullName, "Priya Shah");
    assert.equal(mapped.employeeCode, "P-9");
    assert.equal(mapped.email, "priya@example.com");
  });

  it("reports unrecognized headers instead of silently dropping them", () => {
    const { mapped, unrecognizedHeaders } = mapImportRowDetailed({
      name: "Sam",
      email: "sam@example.com",
      cost_center: "CC-9",
      badge_color: "blue",
    });
    assert.equal(mapped.fullName, "Sam");
    assert.deepEqual(unrecognizedHeaders.sort(), ["badge_color", "cost_center"].sort());
    assert.deepEqual(
      collectUnrecognizedImportHeaders([{ name: "A", cost_center: "1", badge_color: "x" }]).sort(),
      ["badge_color", "cost_center"].sort()
    );
  });

  it("normalizes salary currency formatting", () => {
    assert.equal(normalizeMappedCell("monthlySalary", "₹1,25,000"), "125000");
  });
});
