import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { serializeDepartment } from "../models/Department.js";
import { isHrPortalOperator } from "../models/User.js";
import { syncDepartmentRename } from "./departmentLinkService.js";
import { HttpError } from "../utils/httpError.js";

/** Matches department routes: Company Admin and HR Admin. Permission and scope stay on the route. */
function requireHrPortalOperator(actorUser) {
  if (!isHrPortalOperator(actorUser?.role)) {
    throw new HttpError(403, "You do not have access to this resource");
  }
}

function requireObjectId(value, field) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw new HttpError(400, `Invalid ${field}`, { field });
  }
  return new mongoose.Types.ObjectId(value);
}

export async function listDepartments(models, { includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  const rows = await models.Department.find(filter).sort({ name: 1 }).lean();
  const departments = rows.map(serializeDepartment);
  const counts = new Map();
  if (models.Employee && departments.length) {
    const ids = departments
      .filter((department) => mongoose.Types.ObjectId.isValid(department.id))
      .map((department) => new mongoose.Types.ObjectId(department.id));
    const grouped = await models.Employee.aggregate([
      { $match: { "job.departmentId": { $in: ids } } },
      { $group: { _id: "$job.departmentId", count: { $sum: 1 } } },
    ]);
    for (const row of grouped) counts.set(String(row._id), row.count);
  }
  for (const department of departments) {
    department.employeeCount = counts.get(department.id) || 0;
  }
  return departments;
}

export async function getDepartmentById(models, departmentId) {
  if (!mongoose.Types.ObjectId.isValid(departmentId)) {
    throw new HttpError(404, "Department not found");
  }
  const department = await models.Department.findById(departmentId).lean();
  if (!department) {
    throw new HttpError(404, "Department not found");
  }
  return serializeDepartment(department);
}

export async function createDepartment(models, actorUser, payload = {}) {
  requireHrPortalOperator(actorUser);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw new HttpError(400, "Department name is required", { field: "name" });
  }

  const normalizedName = name.toLowerCase();
  const existing = await models.Department.findOne({ normalizedName }).select("_id").lean();
  if (existing) {
    throw new HttpError(409, "A department with this name already exists", {
      field: "name",
      code: "CONFLICT",
    });
  }

  const department = await models.Department.create({
    name,
    description: typeof payload.description === "string" ? payload.description.trim() : "",
    code: typeof payload.code === "string" ? payload.code.trim() : "",
    isActive: true,
    createdBy: actorUser._id,
    updatedBy: actorUser._id,
  });
  return serializeDepartment(department);
}

export async function updateDepartment(models, actorUser, departmentId, payload = {}) {
  requireHrPortalOperator(actorUser);
  const department = await models.Department.findById(departmentId);
  if (!department) {
    throw new HttpError(404, "Department not found");
  }

  const previousName = department.name;

  if (payload.name !== undefined) {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) {
      throw new HttpError(400, "Department name is required", { field: "name" });
    }
    const normalizedName = name.toLowerCase();
    const clash = await models.Department.findOne({
      normalizedName,
      _id: { $ne: department._id },
    })
      .select("_id")
      .lean();
    if (clash) {
      throw new HttpError(409, "A department with this name already exists", {
        field: "name",
        code: "CONFLICT",
      });
    }
    department.name = name;
  }

  if (payload.description !== undefined) {
    department.description =
      typeof payload.description === "string" ? payload.description.trim() : "";
  }
  if (payload.code !== undefined) {
    department.code = typeof payload.code === "string" ? payload.code.trim() : "";
  }

  department.updatedBy = actorUser._id;
  await department.save();
  await syncDepartmentRename(models, department._id, previousName, department.name);
  return serializeDepartment(department);
}

export async function deactivateDepartment(models, actorUser, departmentId) {
  requireHrPortalOperator(actorUser);
  const department = await models.Department.findById(departmentId);
  if (!department) {
    throw new HttpError(404, "Department not found");
  }
  department.isActive = false;
  department.updatedBy = actorUser._id;
  await department.save();
  // Deactivation keeps employee departmentId links and team department text.
  return serializeDepartment(department);
}

/**
 * Department membership source of truth: Employee.job.departmentId.
 * Legacy job.department string is synced from the Department name when linked.
 */
export async function setEmployeeDepartment(models, actorUser, employeeId, departmentId) {
  requireHrPortalOperator(actorUser);
  const empId = requireObjectId(employeeId, "employeeId");
  const employee = await models.Employee.findById(empId);
  if (!employee) {
    throw new HttpError(404, "Employee not found");
  }
  if (employee.status !== EMPLOYEE_STATUSES.ACTIVE) {
    throw new HttpError(400, "Cannot update department for an inactive employee");
  }

  if (departmentId == null || departmentId === "") {
    employee.job = employee.job || {};
    employee.job.departmentId = null;
    // Preserve legacy string; do not clear job.department automatically.
    employee.markModified("job");
    await employee.save();
    return {
      employeeId: String(employee._id),
      departmentId: null,
      departmentName: employee.job?.department || "",
    };
  }

  const deptId = requireObjectId(departmentId, "departmentId");
  const department = await models.Department.findById(deptId).lean();
  if (!department || department.isActive !== true) {
    throw new HttpError(400, "departmentId must reference an active department", {
      field: "departmentId",
    });
  }

  employee.job = employee.job || {};
  employee.job.departmentId = deptId;
  employee.job.department = department.name;
  employee.markModified("job");
  await employee.save();

  return {
    employeeId: String(employee._id),
    departmentId: String(department._id),
    departmentName: department.name,
  };
}
