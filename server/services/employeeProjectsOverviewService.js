import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { mergeEmployeeScopeFilter } from "./hrAccessEnforcementService.js";
import { HttpError } from "../utils/httpError.js";

const COLLATOR = (a, b) =>
  String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

const LEAD_TITLE_RX = "lead|manager|head|director|principal";
const MAX_LEADS = 4;
const BENCH_NAME = "General Operations & Bench";

/**
 * F56 — Server-side AdminHome projects / department / leads overview.
 * Replaces the capped 300-employee client pool aggregation.
 * Aggregation returns counts + slim lead snapshots (no full member arrays).
 */
export async function buildEmployeeProjectsOverview({
  Employee,
  hrAccess,
  status = EMPLOYEE_STATUSES.ACTIVE,
} = {}) {
  if (!Employee) {
    throw new HttpError(500, "Employee model is not available.");
  }

  const statusKey = String(status || EMPLOYEE_STATUSES.ACTIVE).trim().toUpperCase();
  const baseMatch = {};
  if (statusKey === EMPLOYEE_STATUSES.ACTIVE || statusKey === EMPLOYEE_STATUSES.INACTIVE) {
    baseMatch.status = statusKey;
  } else if (statusKey !== "ALL") {
    throw new HttpError(400, "Invalid status.", {
      field: "status",
      code: "INVALID_STATUS",
    });
  }

  const scopedMatch = mergeEmployeeScopeFilter(hrAccess, baseMatch);

  const [facet] = await Employee.aggregate([
    { $match: scopedMatch },
    {
      $addFields: {
        _projRaw: {
          $trim: {
            input: {
              $convert: {
                input: "$job.project.projectName",
                to: "string",
                onError: "",
                onNull: "",
              },
            },
          },
        },
        _deptRaw: {
          $trim: {
            input: {
              $convert: {
                input: "$job.department",
                to: "string",
                onError: "",
                onNull: "",
              },
            },
          },
        },
        _isLead: {
          $regexMatch: {
            input: { $ifNull: ["$job.jobTitle", ""] },
            regex: LEAD_TITLE_RX,
            options: "i",
          },
        },
      },
    },
    {
      $addFields: {
        _projKey: {
          $cond: [{ $eq: ["$_projRaw", ""] }, BENCH_NAME, "$_projRaw"],
        },
        _isBench: { $eq: ["$_projRaw", ""] },
      },
    },
    {
      $facet: {
        projects: [
          {
            $group: {
              _id: "$_projKey",
              memberCount: { $sum: 1 },
              isBench: { $first: "$_isBench" },
              projectType: {
                $first: {
                  $ifNull: [
                    "$job.project.projectType",
                    { $cond: ["$_isBench", "BENCH", "MANDATE"] },
                  ],
                },
              },
              location: {
                $first: {
                  $ifNull: ["$job.workLocation", { $ifNull: ["$city", "Bangalore HQ"] }],
                },
              },
              departments: { $addToSet: "$_deptRaw" },
              leadCandidates: {
                $push: {
                  $cond: [
                    "$_isLead",
                    {
                      _id: "$_id",
                      fullName: "$fullName",
                      employeeCode: "$employeeCode",
                      jobTitle: "$job.jobTitle",
                    },
                    "$$REMOVE",
                  ],
                },
              },
            },
          },
        ],
        departments: [
          {
            $group: {
              _id: {
                $cond: [{ $eq: ["$_deptRaw", ""] }, "Operations", "$_deptRaw"],
              },
              count: { $sum: 1 },
            },
          },
        ],
        leads: [
          { $match: { _isLead: true } },
          { $sort: { fullName: 1 } },
          { $limit: MAX_LEADS },
          {
            $project: {
              _id: 1,
              fullName: 1,
              employeeCode: 1,
              avatar: 1,
              job: {
                jobTitle: "$job.jobTitle",
                department: "$job.department",
                project: "$job.project",
              },
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const projectList = (facet?.projects || [])
    .map((row) => {
      const departments = (row.departments || []).filter((d) => d && String(d).trim());
      const lead = Array.isArray(row.leadCandidates) && row.leadCandidates.length
        ? row.leadCandidates[0]
        : null;
      return {
        name: row._id || BENCH_NAME,
        isBench: Boolean(row.isBench),
        projectType: row.projectType || (row.isBench ? "BENCH" : "MANDATE"),
        location: row.location || "Bangalore HQ",
        memberCount: Number(row.memberCount) || 0,
        lead,
        departments: departments.sort(COLLATOR),
      };
    })
    .sort((a, b) => b.memberCount - a.memberCount || COLLATOR(a.name, b.name));

  const deptList = (facet?.departments || [])
    .map((row) => ({
      name: row._id || "Operations",
      count: Number(row.count) || 0,
    }))
    .sort((a, b) => b.count - a.count || COLLATOR(a.name, b.name));

  const leadsList = facet?.leads || [];
  const employeeCount = facet?.total?.[0]?.n || 0;

  return {
    status: statusKey,
    projectList,
    deptList,
    leadsList,
    meta: {
      employeeCount,
      projectCount: projectList.length,
      activeProjectCount: projectList.filter((p) => !p.isBench).length,
    },
  };
}
