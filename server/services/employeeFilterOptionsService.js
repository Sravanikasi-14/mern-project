import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { mergeEmployeeScopeFilter } from "./hrAccessEnforcementService.js";
import { HttpError } from "../utils/httpError.js";

const COLLATOR = (a, b) =>
  String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

/**
 * Normalize a raw aggregation bucket `_id` into a non-empty trimmed label, or null.
 */
export function normalizeFilterOptionLabel(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function sortLabels(labels) {
  return [...labels].sort(COLLATOR);
}

function sortDepartments(rows) {
  return [...rows].sort((a, b) => COLLATOR(a.name, b.name));
}

/**
 * Build a $facet branch that groups trimmed non-empty string values for a path.
 * Each employee document contributes at most once per facet (one $group key).
 */
function distinctFacet(fieldPath) {
  return [
    {
      $project: {
        _label: {
          $trim: {
            input: {
              $convert: {
                input: `$${fieldPath}`,
                to: "string",
                onError: "",
                onNull: "",
              },
            },
          },
        },
      },
    },
    { $match: { _label: { $ne: "" } } },
    { $group: { _id: "$_label", count: { $sum: 1 } } },
  ];
}

function labelsFromBuckets(buckets) {
  const labels = [];
  for (const row of buckets || []) {
    const name = normalizeFilterOptionLabel(row?._id);
    if (name) labels.push(name);
  }
  return sortLabels(labels);
}

function departmentsFromBuckets(buckets) {
  const out = [];
  for (const row of buckets || []) {
    const name = normalizeFilterOptionLabel(row?._id);
    if (!name) continue;
    const count = Number(row?.count) || 0;
    out.push({ name, count });
  }
  return sortDepartments(out);
}

/**
 * F56 — Distinct People filter options from Employee, scoped by HR access.
 * Aggregation projects only derived labels — never personal PII or compensation.
 *
 * @param {object} options
 * @param {import("mongoose").Model} options.Employee
 * @param {object} [options.hrAccess]
 * @param {string} [options.status] ALL | ACTIVE | INACTIVE (default ALL)
 */
export async function buildEmployeeFilterOptions({ Employee, hrAccess, status = "ALL" }) {
  if (!Employee) {
    throw new HttpError(500, "Employee model is not available.");
  }

  const statusKey = String(status || "ALL").trim().toUpperCase() || "ALL";
  const baseMatch = {};
  if (statusKey === EMPLOYEE_STATUSES.ACTIVE || statusKey === EMPLOYEE_STATUSES.INACTIVE) {
    baseMatch.status = statusKey;
  } else if (statusKey !== "ALL") {
    throw new HttpError(400, "Invalid status.", {
      field: "status",
      errors: { status: "status must be ALL, ACTIVE, or INACTIVE." },
      code: "INVALID_STATUS",
    });
  }

  const scopedMatch = mergeEmployeeScopeFilter(hrAccess, baseMatch);

  const [facetRow] = await Employee.aggregate([
    { $match: scopedMatch },
    {
      $facet: {
        departments: distinctFacet("job.department"),
        jobTitles: distinctFacet("job.jobTitle"),
        projects: distinctFacet("job.project.projectName"),
        employmentTypes: distinctFacet("job.employmentType"),
        workLocations: distinctFacet("job.workLocation"),
      },
    },
  ]);

  return {
    status: statusKey,
    departments: departmentsFromBuckets(facetRow?.departments),
    jobTitles: labelsFromBuckets(facetRow?.jobTitles),
    projects: labelsFromBuckets(facetRow?.projects),
    employmentTypes: labelsFromBuckets(facetRow?.employmentTypes),
    workLocations: labelsFromBuckets(facetRow?.workLocations),
  };
}
