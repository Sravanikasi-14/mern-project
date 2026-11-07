import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";

export function normalizeDepartmentKey(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function departmentKey(department) {
  return normalizeDepartmentKey(department?.normalizedName || department?.name || "");
}

/**
 * Choose a department for a name.
 * Active matches win. More than one active match is ambiguous.
 * Only inactive matches are a rejected assignment, not a guess.
 */
export function selectDepartmentMatch(departments, rawName) {
  const key = normalizeDepartmentKey(rawName);
  if (!key) return { status: "blank" };

  const active = [];
  const inactive = [];
  for (const department of departments || []) {
    if (departmentKey(department) !== key) continue;
    if (department.isActive === false) inactive.push(department);
    else active.push(department);
  }

  if (active.length > 1) return { status: "ambiguous", matches: active };
  if (active.length === 1) return { status: "active", department: active[0] };
  if (inactive.length > 0) return { status: "inactive", matches: inactive };
  return { status: "unresolved" };
}

function ambiguousError() {
  return new HttpError(409, "More than one active department matches this name.", {
    code: "AMBIGUOUS_DEPARTMENT",
    field: "department",
    errors: { department: "More than one active department matches this name." },
  });
}

function inactiveError() {
  return new HttpError(400, "That department is inactive and cannot be assigned.", {
    code: "DEPARTMENT_INACTIVE",
    field: "department",
    errors: { department: "That department is inactive and cannot be assigned." },
  });
}

async function loadDepartments(Department, session) {
  const query = Department.find({}).select("name normalizedName isActive");
  if (session) query.session(session);
  return query.lean();
}

/**
 * Resolve a department name or id for create/edit.
 * Blank input does not clear an existing link.
 * An unresolved name is stored only when the employee has no department link yet.
 */
export async function resolveDepartmentAssignment(Department, {
  department,
  departmentId,
  departmentProvided = false,
  departmentIdProvided = false,
  existingDepartmentId = null,
  existingDepartmentName = "",
  clearDepartment = false,
  session = null,
} = {}) {
  const current = {
    changed: false,
    departmentId: existingDepartmentId || null,
    departmentName: typeof existingDepartmentName === "string" ? existingDepartmentName : "",
  };

  if (!departmentProvided && !departmentIdProvided && !clearDepartment) return current;

  // An empty department field is not a clear. Only the explicit action removes a link.
  if (clearDepartment && !(departmentIdProvided && departmentId)) {
    const hadAssignment = Boolean(existingDepartmentId) || String(existingDepartmentName || "").trim().length > 0;
    return { changed: hadAssignment, departmentId: null, departmentName: "" };
  }
  if (!Department) {
    if (departmentIdProvided && departmentId) {
      throw new HttpError(400, "Department was not found.", { code: "DEPARTMENT_NOT_FOUND", field: "departmentId" });
    }
    const trimmed = typeof department === "string" ? department.trim() : "";
    if (!trimmed) return current;
    if (existingDepartmentId) {
      throw new HttpError(400, "No active department matches this name. The existing department assignment was not changed.", {
        code: "DEPARTMENT_UNRESOLVED",
        field: "department",
      });
    }
    return { changed: true, departmentId: null, departmentName: trimmed };
  }

  if (departmentIdProvided && departmentId) {
    if (!mongoose.Types.ObjectId.isValid(String(departmentId))) {
      throw new HttpError(400, "Department was not found.", {
        code: "DEPARTMENT_NOT_FOUND",
        field: "departmentId",
      });
    }
    const query = Department.findById(departmentId).select("name isActive");
    if (session) query.session(session);
    const record = await query.lean();
    if (!record) {
      throw new HttpError(400, "Department was not found.", {
        code: "DEPARTMENT_NOT_FOUND",
        field: "departmentId",
      });
    }
    if (record.isActive === false) throw inactiveError();
    return { changed: true, departmentId: record._id, departmentName: record.name };
  }

  const trimmed = typeof department === "string" ? department.trim() : "";
  if (!trimmed) return current;

  const match = selectDepartmentMatch(await loadDepartments(Department, session), trimmed);
  if (match.status === "ambiguous") throw ambiguousError();
  if (match.status === "inactive") throw inactiveError();
  if (match.status === "active") {
    return {
      changed: true,
      departmentId: match.department._id,
      departmentName: match.department.name,
    };
  }

  if (existingDepartmentId) {
    throw new HttpError(400, "No active department matches this name. The existing department assignment was not changed.", {
      code: "DEPARTMENT_UNRESOLVED",
      field: "department",
      errors: { department: "No active department matches this name." },
    });
  }

  return { changed: true, departmentId: null, departmentName: trimmed };
}

/**
 * After a department rename, sync linked employee display names and team text
 * that exactly equals the previous name. Team matching is case-sensitive.
 */
export async function syncDepartmentRename(models, departmentId, previousName, nextName) {
  if (!departmentId || previousName === nextName) {
    return { employeesUpdated: 0, teamsUpdated: 0 };
  }

  const employeeResult = await models.Employee.updateMany(
    { "job.departmentId": departmentId },
    { $set: { "job.department": nextName } }
  );

  let teamsUpdated = 0;
  if (models.Team && typeof previousName === "string" && previousName.length > 0) {
    const teamResult = await models.Team.updateMany(
      { department: previousName },
      { $set: { department: nextName } }
    );
    teamsUpdated = teamResult.modifiedCount || 0;
  }

  return {
    employeesUpdated: employeeResult.modifiedCount || 0,
    teamsUpdated,
  };
}

/**
 * Idempotent department-only backfill from legacy employee department strings.
 * Does not modify projects, users, permissions, or enforcement.
 */
export async function backfillDepartmentLinks(models, { actorUserId = null } = {}) {
  const { Employee, Department } = models;
  const report = {
    departmentsCreated: 0,
    departmentsReused: 0,
    employeesLinked: 0,
    employeesSkippedAlreadyLinked: 0,
    employeesSkippedBlank: 0,
    employeesSkippedAmbiguous: 0,
  };

  const existing = await Department.find({}).select("name normalizedName isActive");
  const byKey = new Map();
  for (const department of existing) {
    const key = departmentKey(department);
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(department);
    byKey.set(key, list);
  }

  const employees = await Employee.find({}).select("_id job.department job.departmentId");
  for (const employee of employees) {
    if (employee.job?.departmentId) {
      report.employeesSkippedAlreadyLinked += 1;
      continue;
    }

    const legacy = typeof employee.job?.department === "string" ? employee.job.department.trim() : "";
    if (!legacy) {
      report.employeesSkippedBlank += 1;
      continue;
    }

    const key = normalizeDepartmentKey(legacy);
    const matches = byKey.get(key) || [];
    if (matches.length > 1) {
      report.employeesSkippedAmbiguous += 1;
      continue;
    }

    let department = matches[0] || null;
    if (!department) {
      department = await Department.create({
        name: legacy,
        description: "",
        isActive: true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
      byKey.set(key, [department]);
      report.departmentsCreated += 1;
    } else {
      report.departmentsReused += 1;
    }

    const updated = await Employee.updateOne(
      {
        _id: employee._id,
        $or: [{ "job.departmentId": null }, { "job.departmentId": { $exists: false } }],
      },
      { $set: { "job.departmentId": department._id, "job.department": department.name } }
    );
    if (updated.modifiedCount) report.employeesLinked += 1;
  }

  return report;
}
