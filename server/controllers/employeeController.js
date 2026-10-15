import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, serializeUser } from "../models/User.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword } from "../utils/password.js";

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

const ALLOWED_LIMITS = new Set([10, 50, 100, 200, 300]);
const ALLOWED_SORT_FIELDS = {
  fullName: "fullName",
  employeeCode: "employeeCode",
  status: "status",
  createdAt: "createdAt",
  joiningDate: "job.joiningDate",
};

export async function getEmployees(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;

    const rawPage = parseInt(req.query.page, 10);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = ALLOWED_LIMITS.has(rawLimit) ? rawLimit : 10;

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : "";
    const project = typeof req.query.project === "string" ? req.query.project.trim() : "";
    const jobTitle = typeof req.query.jobTitle === "string" ? req.query.jobTitle.trim() : "";

    const sortByParam = req.query.sortBy;
    const sortField = ALLOWED_SORT_FIELDS[sortByParam] || "createdAt";
    const sortDirection = req.query.sortOrder === "asc" ? 1 : -1;

    const query = {};

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      query.$or = [
        { fullName: regex },
        { email: regex },
        { employeeCode: regex },
      ];
    }

    if (status && (status === EMPLOYEE_STATUSES.ACTIVE || status === EMPLOYEE_STATUSES.INACTIVE)) {
      query.status = status;
    }

    if (project) {
      query["job.project.projectName"] = new RegExp(escapeRegex(project), "i");
    }

    if (jobTitle) {
      query["job.jobTitle"] = new RegExp(escapeRegex(jobTitle), "i");
    }

    const [totalEmployees, employees] = await Promise.all([
      Employee.countDocuments(query),
      Employee.find(query)
        .populate("job.reportingManagerId", "fullName employeeCode")
        .sort({ [sortField]: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Retrieve salary info for HR_ADMIN
    const employeeIds = employees.map((emp) => emp._id);
    const compensations = await EmployeeCompensation.find({
      employeeId: { $in: employeeIds },
    }).lean();

    const compensationMap = new Map();
    const now = new Date();

    for (const comp of compensations) {
      const validRevisions = (comp.revisions || [])
        .filter((rev) => new Date(rev.effectiveFromDate) <= now)
        .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

      if (validRevisions.length > 0 && validRevisions[0].monthlyCostToCompany != null) {
        compensationMap.set(
          String(comp.employeeId),
          parseFloat(validRevisions[0].monthlyCostToCompany.toString())
        );
      }
    }

    const enrichedEmployees = employees.map((emp) => ({
      ...emp,
      currentMonthlySalary: compensationMap.get(String(emp._id)) ?? null,
    }));

    res.json({
      employees: enrichedEmployees,
      pagination: {
        page,
        limit,
        totalEmployees,
        totalPages: Math.ceil(totalEmployees / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeSummary(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;
    const now = new Date();

    const [
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      assignedEmployees,
      activeEmployeeDocs,
      compensations,
    ] = await Promise.all([
      Employee.countDocuments({}),
      Employee.countDocuments({ status: EMPLOYEE_STATUSES.ACTIVE }),
      Employee.countDocuments({ status: EMPLOYEE_STATUSES.INACTIVE }),
      Employee.countDocuments({
        status: EMPLOYEE_STATUSES.ACTIVE,
        "job.project.projectName": { $exists: true, $nin: ["", null] },
      }),
      Employee.find({ status: EMPLOYEE_STATUSES.ACTIVE }).select("_id").lean(),
      EmployeeCompensation.find({}).lean(),
    ]);

    const activeIdSet = new Set(activeEmployeeDocs.map((emp) => String(emp._id)));
    let totalMonthlySalary = 0;

    for (const comp of compensations) {
      if (!activeIdSet.has(String(comp.employeeId))) continue;

      const validRevisions = (comp.revisions || [])
        .filter((rev) => new Date(rev.effectiveFromDate) <= now)
        .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

      if (validRevisions.length > 0 && validRevisions[0].monthlyCostToCompany != null) {
        totalMonthlySalary += parseFloat(validRevisions[0].monthlyCostToCompany.toString());
      }
    }

    res.json({
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      assignedEmployees,
      totalMonthlySalary,
    });
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeById(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;
    const employee = await Employee.findById(req.params.id)
      .populate("job.reportingManagerId", "fullName employeeCode")
      .lean();

    if (!employee) {
      throw new HttpError(404, "Employee not found");
    }

    const compensation = await EmployeeCompensation.findOne({
      employeeId: employee._id,
    }).lean();

    let currentMonthlySalary = null;
    let salaryComponents = null;

    if (compensation) {
      const now = new Date();
      const validRevisions = (compensation.revisions || [])
        .filter((rev) => new Date(rev.effectiveFromDate) <= now)
        .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

      if (validRevisions.length > 0) {
        const latest = validRevisions[0];
        currentMonthlySalary = parseFloat(latest.monthlyCostToCompany.toString());
        salaryComponents = {
          basicSalary: parseFloat((latest.salaryComponents?.basicSalary || 0).toString()),
          houseRentAllowance: parseFloat((latest.salaryComponents?.houseRentAllowance || 0).toString()),
          conveyanceAllowance: parseFloat((latest.salaryComponents?.conveyanceAllowance || 0).toString()),
          specialAllowance: parseFloat((latest.salaryComponents?.specialAllowance || 0).toString()),
          employerProvidentFund: parseFloat((latest.salaryComponents?.employerProvidentFund || 0).toString()),
          otherDeductions: parseFloat((latest.salaryComponents?.otherDeductions || 0).toString()),
        };
      }
    }

    res.json({
      ...employee,
      currentMonthlySalary,
      salaryComponents,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyProfile(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    }).lean();

    res.json({
      user: serializeUser(req.auth.user),
      employee: employee
        ? {
            _id: employee._id,
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            email: employee.email,
            phoneNumber: employee.phoneNumber,
            status: employee.status,
            city: employee.city,
            job: employee.job,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function createEmployee(req, res, next) {
  try {
    const {
      fullName,
      email,
      employeeCode,
      phoneNumber,
      dateOfBirth,
      city,
      status = EMPLOYEE_STATUSES.ACTIVE,
      jobTitle,
      joiningDate,
      projectName,
      projectType = "MANDATE",
      monthlySalary,
      password,
    } = req.body || {};

    if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
      throw new HttpError(400, "Full name is required", {
        field: "fullName",
        errors: { fullName: "Full name is required" },
      });
    }
    if (!employeeCode || typeof employeeCode !== "string" || !employeeCode.trim()) {
      throw new HttpError(400, "Employee code is required", {
        field: "employeeCode",
        errors: { employeeCode: "Employee code is required" },
      });
    }
    if (!email || !isValidEmail(email)) {
      throw new HttpError(400, "A valid email is required", {
        field: "email",
        errors: { email: "A valid email is required" },
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const code = employeeCode.trim();

    if (password && password.length < 8) {
      throw new HttpError(400, "Initial password must be at least 8 characters long.", {
        field: "password",
        errors: { password: "Initial password must be at least 8 characters long." },
      });
    }

    if (monthlySalary !== undefined && monthlySalary !== null && monthlySalary !== "") {
      const numSal = parseFloat(monthlySalary);
      if (isNaN(numSal) || numSal < 0) {
        throw new HttpError(400, "Please enter a valid non-negative salary amount.", {
          field: "monthlySalary",
          errors: { monthlySalary: "Please enter a valid non-negative salary amount." },
        });
      }
    }

    if (joiningDate && isNaN(new Date(joiningDate).getTime())) {
      throw new HttpError(400, "Please enter a valid joining date.", {
        field: "joiningDate",
        errors: { joiningDate: "Please enter a valid joining date." },
      });
    }

    const { Employee, User, EmployeeCompensation, AuthToken } = req.auth.models;

    const existingCode = await Employee.findOne({ employeeCode: code });
    if (existingCode) {
      throw new HttpError(409, "An employee with this employee code already exists.", {
        field: "employeeCode",
        errors: { employeeCode: "An employee with this employee code already exists." },
      });
    }

    const existingEmail = await Employee.findOne({ email: normalizedEmail });
    if (existingEmail) {
      throw new HttpError(409, "An employee with this email address already exists.", {
        field: "email",
        errors: { email: "An employee with this email address already exists." },
      });
    }

    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      const initialPassword = password && password.length >= 8 ? password : "Welcome123!";
      const passwordHash = await hashPassword(initialPassword);
      user = await User.create({
        email: normalizedEmail,
        passwordHash,
        role: USER_ROLES.EMPLOYEE,
        isActive: status === EMPLOYEE_STATUSES.ACTIVE,
        schemaVersion: 1,
      });

      if (AuthToken) {
        await AuthToken.create({
          userId: user._id,
          email: normalizedEmail,
          token: `emp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
          type: "INVITATION",
          role: "EMPLOYEE",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdBy: req.auth.user._id,
          isActive: true,
        });
      }
    }

    const employee = await Employee.create({
      userId: user._id,
      employeeCode: code,
      fullName: fullName.trim(),
      email: normalizedEmail,
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : "",
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      city: city ? String(city).trim() : "",
      status:
        status === EMPLOYEE_STATUSES.INACTIVE
          ? EMPLOYEE_STATUSES.INACTIVE
          : EMPLOYEE_STATUSES.ACTIVE,
      job: {
        jobTitle: jobTitle ? String(jobTitle).trim() : "",
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        project: {
          projectName: projectName ? String(projectName).trim() : "",
          projectType: projectType || "MANDATE",
        },
      },
      schemaVersion: 1,
    });

    const numericSalary = parseFloat(monthlySalary);
    if (!isNaN(numericSalary) && numericSalary > 0) {
      const basic = numericSalary * 0.5;
      const hra = numericSalary * 0.25;
      const conveyance = numericSalary * 0.1;
      const special = numericSalary * 0.15;

      await EmployeeCompensation.create({
        employeeId: employee._id,
        revisions: [
          {
            effectiveFromDate: joiningDate ? new Date(joiningDate) : new Date(),
            monthlyCostToCompany: mongoose.Types.Decimal128.fromString(numericSalary.toFixed(2)),
            salaryComponents: {
              basicSalary: mongoose.Types.Decimal128.fromString(basic.toFixed(2)),
              houseRentAllowance: mongoose.Types.Decimal128.fromString(hra.toFixed(2)),
              conveyanceAllowance: mongoose.Types.Decimal128.fromString(conveyance.toFixed(2)),
              specialAllowance: mongoose.Types.Decimal128.fromString(special.toFixed(2)),
            },
            revisedBy: req.auth.user._id,
            revisedAt: new Date(),
          },
        ],
        schemaVersion: 1,
      });
    }

    res.status(201).json({
      message: "Employee created successfully",
      employee,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req, res, next) {
  try {
    const { Employee, User } = req.auth.models;
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) {
      throw new HttpError(404, "Employee not found");
    }

    const { fullName, phoneNumber, city, status, jobTitle, projectName, projectType } =
      req.body || {};

    if (fullName && typeof fullName === "string" && fullName.trim()) {
      employee.fullName = fullName.trim();
    }
    if (phoneNumber !== undefined) {
      employee.phoneNumber = String(phoneNumber).trim();
    }
    if (city !== undefined) {
      employee.city = String(city).trim();
    }
    if (
      status &&
      (status === EMPLOYEE_STATUSES.ACTIVE || status === EMPLOYEE_STATUSES.INACTIVE)
    ) {
      employee.status = status;
      if (employee.userId) {
        await User.findByIdAndUpdate(employee.userId, {
          isActive: status === EMPLOYEE_STATUSES.ACTIVE,
        });
      }
    }
    if (jobTitle !== undefined) {
      employee.job.jobTitle = String(jobTitle).trim();
    }
    if (projectName !== undefined) {
      employee.job.project.projectName = String(projectName).trim();
    }
    if (projectType !== undefined) {
      employee.job.project.projectType = projectType;
    }

    await employee.save();

    res.json({
      message: "Employee updated successfully",
      employee,
    });
  } catch (error) {
    next(error);
  }
}
