import mongoose from "mongoose";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES, serializeUser } from "../models/User.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword } from "../utils/password.js";
import { signEmployeeInvitationToken } from "../utils/onboardingToken.js";
import { emailService } from "../services/emailService.js";
import { saveDocumentFile, getDocumentAbsolutePath } from "../services/documentStorage.js";
import { TOKEN_TYPES } from "../models/AuthToken.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import {
  calculateEmployeeLeaveBalances,
  calculateLeaveDays,
  hasOverlappingLeave,
  parseDateOnly,
  toDateString,
} from "../services/leaveService.js";

async function recordAuditLog(AuditLog, req, action, targetId, changes) {
  try {
    if (!AuditLog || !req.auth?.user) return;
    await AuditLog.create({
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      action,
      targetType: "Employee",
      targetId,
      changes: changes || {},
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch (err) {
    // Audit logging should not crash the primary operational request
    console.error("Audit log error:", err.message);
  }
}

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

    const defaultAttendance = {
      totalWorkingDays: 22,
      daysPresent: 21,
      leaveBalance: { casual: 8, sick: 6, earned: 12 },
    };

    res.json({
      ...employee,
      preferredName: employee.preferredName || "",
      personalEmail: employee.personalEmail || "",
      personalPhone: employee.personalPhone || "",
      gender: employee.gender || "Not specified",
      emergencyContact: employee.emergencyContact || { name: "", relationship: "", phone: "" },
      residentialAddress: employee.residentialAddress || { street: "", city: "", state: "", postalCode: "", country: "India" },
      workAddress: employee.workAddress || { street: "", city: "", state: "", postalCode: "", country: "India" },
      bankDetails: employee.bankDetails && employee.bankDetails.accountNumber ? employee.bankDetails : {
        accountHolderName: employee.fullName,
        accountNumber: "•••• •••• " + (employee.employeeCode ? employee.employeeCode.slice(-4) : "1024"),
        bankName: "HDFC Bank",
        ifscCode: "HDFC0001024",
        accountType: "Salary Account",
      },
      taxDetails: employee.taxDetails && employee.taxDetails.panNumber ? employee.taxDetails : {
        panNumber: "ABCDE1234F",
        taxRegime: "New Tax Regime (Sec 115BAC)",
      },
      identityDetails: employee.identityDetails && employee.identityDetails.idNumber ? employee.identityDetails : {
        idType: "PAN & Aadhaar (e-KYC)",
        idNumber: "•••• •••• 9812",
        isVerified: true,
      },
      attendance: employee.attendance || defaultAttendance,
      currentMonthlySalary,
      salaryComponents,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyProfile(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    })
      .populate("job.reportingManagerId", "fullName employeeCode")
      .lean();

    if (!employee) {
      return res.json({
        user: serializeUser(req.auth.user),
        employee: null,
      });
    }

    let compensation = null;
    if (EmployeeCompensation) {
      const comp = await EmployeeCompensation.findOne({ employeeId: employee._id }).lean();
      if (comp) {
        const now = new Date();
        const validRevisions = (comp.revisions || [])
          .filter((rev) => new Date(rev.effectiveFromDate) <= now)
          .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

        if (validRevisions.length > 0) {
          const latest = validRevisions[0];
          compensation = {
            monthlyCostToCompany: parseFloat(latest.monthlyCostToCompany.toString()),
            salaryComponents: latest.salaryComponents
              ? {
                  basicSalary: parseFloat((latest.salaryComponents.basicSalary || 0).toString()),
                  houseRentAllowance: parseFloat((latest.salaryComponents.houseRentAllowance || 0).toString()),
                  conveyanceAllowance: parseFloat((latest.salaryComponents.conveyanceAllowance || 0).toString()),
                  specialAllowance: parseFloat((latest.salaryComponents.specialAllowance || 0).toString()),
                }
              : null,
          };
        }
      }
    }

    res.json({
      user: serializeUser(req.auth.user),
      employee: {
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        preferredName: employee.preferredName || "",
        email: employee.email,
        personalEmail: employee.personalEmail || "",
        phoneNumber: employee.phoneNumber || "",
        personalPhone: employee.personalPhone || "",
        dateOfBirth: employee.dateOfBirth || null,
        gender: employee.gender || "Not specified",
        city: employee.city || "",
        status: employee.status,
        job: employee.job,
        residentialAddress: employee.residentialAddress || { street: "", city: "", state: "", postalCode: "", country: "India" },
        emergencyContact: employee.emergencyContact || { name: "", relationship: "", phone: "" },
        bankDetails: employee.bankDetails || {
          accountHolderName: employee.fullName,
          accountNumber: "",
          bankName: "",
          ifscCode: "",
          accountType: "Salary Account",
        },
        taxDetails: employee.taxDetails || {
          panNumber: "",
          taxRegime: "New Tax Regime (Sec 115BAC)",
        },
        identityDetails: employee.identityDetails || {
          idType: "PAN / Aadhaar",
          idNumber: "",
          isVerified: false,
        },
        documents: employee.documents || [],
        attendance: employee.attendance || {
          totalWorkingDays: 22,
          daysPresent: 21,
          leaveBalance: { casual: 8, sick: 6, earned: 12 },
        },
        compensation,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeDashboard(req, res, next) {
  try {
    const { Employee, EmployeeCompensation, LeaveRequest, CompanyHrPolicy } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    })
      .populate("job.reportingManagerId", "fullName employeeCode")
      .lean();

    if (!employee) {
      return res.json({
        success: true,
        user: serializeUser(req.auth.user),
        employee: null,
        attendance: null,
        leave: null,
        holidays: [],
        payslips: [],
        assets: [],
      });
    }

    const todayStr = toDateString(new Date());
    const customFields = employee.customFields || {};
    const attendanceLogs = customFields.attendanceLogs || [];

    // Find today's log if present
    const todayLog = attendanceLogs.find((log) => log.date === todayStr) || null;

    // Fetch active Company HR Policy
    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);

    // Fetch leave requests from LeaveRequest collection
    let dbRequests = [];
    if (LeaveRequest) {
      dbRequests = await LeaveRequest.find({ employeeId: employee._id })
        .sort({ createdAt: -1 })
        .lean();
    }

    // Check if today falls in any APPROVED leave window
    const todayDate = parseDateOnly(todayStr);
    const approvedLeaveToday = dbRequests.find((r) => {
      if (r.status !== "APPROVED") return false;
      const s = parseDateOnly(r.fromDate);
      const e = parseDateOnly(r.toDate);
      return s && e && s <= todayDate && e >= todayDate;
    });

    let todayStatus = "NOT_CHECKED_IN";
    if (todayLog) {
      if (todayLog.checkIn && todayLog.checkOut) {
        todayStatus = "CHECKED_OUT";
      } else if (todayLog.checkIn) {
        todayStatus = "CHECKED_IN";
      } else if (todayLog.status === "ON_LEAVE") {
        todayStatus = "ON_LEAVE";
      }
    } else if (approvedLeaveToday) {
      todayStatus = "ON_LEAVE";
    }

    const totalWorkingDays = employee.attendance?.totalWorkingDays || 22;
    const daysPresent = employee.attendance?.daysPresent || 0;
    const attendanceRate = totalWorkingDays > 0 ? Math.min(100, Math.round((daysPresent / totalWorkingDays) * 100)) : 100;

    // Build recent attendance records (last 7 logs or generated defaults from present days)
    let recentAttendance = [...attendanceLogs]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 7);

    if (recentAttendance.length === 0 && daysPresent > 0) {
      const recs = [];
      const cur = new Date();
      let added = 0;
      for (let i = 1; i <= 14 && added < Math.min(daysPresent, 5); i++) {
        const d = new Date(cur);
        d.setDate(d.getDate() - i);
        const dayOfWeek = d.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const dStr = d.toISOString().split("T")[0];
          recs.push({
            date: dStr,
            checkIn: `${dStr}T09:30:00.000Z`,
            checkOut: `${dStr}T18:30:00.000Z`,
            status: "PRESENT",
            workingHours: "9h 00m",
          });
          added++;
        }
      }
      recentAttendance = recs;
    }

    // Calculate live leave balances based on Company HR Policy and approved history
    const leaveBalancesData = LeaveRequest
      ? await calculateEmployeeLeaveBalances(employee, policy, LeaveRequest)
      : { balance: employee.attendance?.leaveBalance || { casual: 8, sick: 6, earned: 12 }, detailed: [] };

    const formattedRequests = dbRequests.map((r) => ({
      id: String(r._id),
      _id: r._id,
      leaveType: r.leaveTypeCode,
      leaveTypeCode: r.leaveTypeCode,
      startDate: toDateString(r.fromDate),
      endDate: toDateString(r.toDate),
      days: r.daysCount || 1,
      reason: r.reason || "",
      status: r.status,
      decision: r.decision || null,
      requestedAt: r.createdAt,
    }));

    const leaveSummary = {
      total: dbRequests.length,
      pending: dbRequests.filter((r) => r.status === "PENDING").length,
      approved: dbRequests.filter((r) => r.status === "APPROVED").length,
      rejected: dbRequests.filter((r) => r.status === "REJECTED").length,
    };

    // Upcoming company holidays from policy
    const upcomingHolidays = (policy?.holidays || [])
      .map((h) => ({
        name: h.name,
        date: toDateString(h.date),
        day: new Date(h.date).toLocaleDateString("en-US", { weekday: "long" }),
        type: h.type || "Gazetted Holiday",
      }))
      .filter((h) => h.date >= todayStr)
      .slice(0, 5);

    // Personal payslips derived from authorized EmployeeCompensation
    const payslips = [];
    if (EmployeeCompensation) {
      const comp = await EmployeeCompensation.findOne({ employeeId: employee._id }).lean();
      if (comp) {
        const now = new Date();
        const validRevisions = (comp.revisions || [])
          .filter((rev) => new Date(rev.effectiveFromDate) <= now)
          .sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));

        if (validRevisions.length > 0) {
          const latestRev = validRevisions[0];
          const ctc = parseFloat(latestRev.monthlyCostToCompany.toString());
          const basic = latestRev.salaryComponents?.basicSalary
            ? parseFloat(latestRev.salaryComponents.basicSalary.toString())
            : Math.round(ctc * 0.5);
          const hra = latestRev.salaryComponents?.houseRentAllowance
            ? parseFloat(latestRev.salaryComponents.houseRentAllowance.toString())
            : Math.round(ctc * 0.3);
          const special = latestRev.salaryComponents?.specialAllowance
            ? parseFloat(latestRev.salaryComponents.specialAllowance.toString())
            : Math.max(0, ctc - (basic + hra));
          const epf = latestRev.salaryComponents?.employerProvidentFund
            ? parseFloat(latestRev.salaryComponents.employerProvidentFund.toString())
            : Math.round(basic * 0.12);
          const deductions = epf;
          const netPay = ctc - deductions;

          // Generate the 3 most recent monthly payslips
          const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          for (let m = 1; m <= 3; m++) {
            const payDate = new Date(now.getFullYear(), now.getMonth() - m + 1, 0); // last day of month
            const mIndex = payDate.getMonth();
            const y = payDate.getFullYear();
            payslips.push({
              id: `PS-${y}-${String(mIndex + 1).padStart(2, "0")}`,
              month: monthNames[mIndex],
              year: y,
              period: `01 ${monthNames[mIndex]} ${y} - ${payDate.getDate()} ${monthNames[mIndex]} ${y}`,
              grossSalary: ctc,
              basicSalary: basic,
              houseRentAllowance: hra,
              specialAllowance: special,
              deductions,
              netPay,
              disbursedDate: payDate.toISOString().split("T")[0],
              status: "PAID",
            });
          }
        }
      }
    }

    // Assigned company assets (laptops, peripherals, ID badges)
    const assignedAssets = customFields.assignedAssets || [];

    res.json({
      success: true,
      user: serializeUser(req.auth.user),
      employee: {
        _id: employee._id,
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        preferredName: employee.preferredName || employee.fullName,
        email: employee.email,
        jobTitle: employee.job?.jobTitle || "Team Member",
        department: employee.job?.department || "General",
        employmentType: employee.job?.employmentType || "Full-time",
        workLocation: employee.job?.workLocation || "Office",
        status: employee.status,
        joiningDate: employee.job?.joiningDate || null,
        project: employee.job?.project || null,
      },
      attendance: {
        today: {
          date: todayStr,
          status: todayStatus,
          checkInTime: todayLog?.checkIn || null,
          checkOutTime: todayLog?.checkOut || null,
          workingHours: todayLog?.workingHours || (todayStatus === "CHECKED_IN" ? "In Progress" : "--"),
        },
        summary: {
          totalWorkingDays,
          daysPresent,
          attendanceRate,
        },
        recentRecords: recentAttendance,
      },
      leave: {
        balance: leaveBalancesData.balance,
        detailed: leaveBalancesData.detailed || [],
        summary: leaveSummary,
        recentRequests: formattedRequests.slice(0, 10),
      },
      holidays: upcomingHolidays,
      payslips,
      assets: assignedAssets,
    });
  } catch (error) {
    next(error);
  }
}

export async function employeeCheckIn(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const customFields = employee.customFields || {};
    const attendanceLogs = customFields.attendanceLogs || [];

    const existingLog = attendanceLogs.find((log) => log.date === todayStr);
    if (existingLog && existingLog.checkIn) {
      throw new HttpError(400, "You have already checked in for today.");
    }

    const nowIso = new Date().toISOString();
    const newLog = {
      date: todayStr,
      checkIn: nowIso,
      checkOut: null,
      status: "PRESENT",
      workingHours: "In Progress",
    };

    if (existingLog) {
      existingLog.checkIn = nowIso;
      existingLog.status = "PRESENT";
    } else {
      attendanceLogs.push(newLog);
    }

    employee.customFields = {
      ...customFields,
      attendanceLogs,
    };
    employee.markModified("customFields");

    // Increment daysPresent if not already counted
    if (!employee.attendance) {
      employee.attendance = { totalWorkingDays: 22, daysPresent: 1, leaveBalance: { casual: 8, sick: 6, earned: 12 } };
    } else {
      employee.attendance.daysPresent = (employee.attendance.daysPresent || 0) + 1;
    }
    await employee.save();

    res.json({
      success: true,
      message: "Check-in recorded successfully.",
      today: {
        date: todayStr,
        status: "CHECKED_IN",
        checkInTime: nowIso,
        checkOutTime: null,
        workingHours: "In Progress",
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function employeeCheckOut(req, res, next) {
  try {
    const { Employee } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const customFields = employee.customFields || {};
    const attendanceLogs = customFields.attendanceLogs || [];

    const logIndex = attendanceLogs.findIndex((log) => log.date === todayStr);
    if (logIndex === -1 || !attendanceLogs[logIndex].checkIn) {
      throw new HttpError(400, "You must check in before checking out.");
    }

    if (attendanceLogs[logIndex].checkOut) {
      throw new HttpError(400, "You have already checked out for today.");
    }

    const nowIso = new Date().toISOString();
    const checkInTime = new Date(attendanceLogs[logIndex].checkIn);
    const checkOutTime = new Date(nowIso);
    const diffMs = Math.max(0, checkOutTime - checkInTime);
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const workingHours = `${hours}h ${mins}m`;

    attendanceLogs[logIndex].checkOut = nowIso;
    attendanceLogs[logIndex].workingHours = workingHours;

    employee.customFields = {
      ...customFields,
      attendanceLogs,
    };
    employee.markModified("customFields");
    await employee.save();

    res.json({
      success: true,
      message: "Check-out recorded successfully.",
      today: {
        date: todayStr,
        status: "CHECKED_OUT",
        checkInTime: attendanceLogs[logIndex].checkIn,
        checkOutTime: nowIso,
        workingHours,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function applyLeave(req, res, next) {
  try {
    const { Employee, LeaveRequest, CompanyHrPolicy, AuditLog } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    const { leaveType, startDate, endDate, reason } = req.body || {};

    if (!leaveType) {
      throw new HttpError(400, "Leave type is required.");
    }

    const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
    const activeLeaveType = (policy.leaveTypes || []).find(
      (lt) => lt.code.toUpperCase() === String(leaveType).toUpperCase() && lt.isActive
    );

    if (!activeLeaveType) {
      throw new HttpError(400, `Invalid or inactive leave type: '${leaveType}'. Must be CASUAL, SICK, or EARNED.`);
    }

    if (!startDate || !endDate) {
      throw new HttpError(400, "Start date and end date are required.");
    }

    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    if (!start || !end) {
      throw new HttpError(400, "Invalid date format.");
    }

    if (start > end) {
      throw new HttpError(400, "Start date cannot be after end date.");
    }

    // Check for overlapping PENDING or APPROVED leave requests
    if (LeaveRequest) {
      const overlapping = await hasOverlappingLeave(LeaveRequest, employee._id, start, end);
      if (overlapping) {
        throw new HttpError(
          400,
          `You already have a ${overlapping.status.toLowerCase()} leave request (${toDateString(overlapping.fromDate)} to ${toDateString(overlapping.toDate)}) overlapping with this date range.`
        );
      }
    }

    // Calculate working leave days based on company policy (weekends & holidays excluded)
    const { workingDays } = calculateLeaveDays(start, end, policy);
    const daysCount = workingDays;

    // Calculate balance from policy and approved leave history
    const balances = LeaveRequest
      ? await calculateEmployeeLeaveBalances(employee, policy, LeaveRequest)
      : { balance: { casual: 8, sick: 6, earned: 12 } };

    const typeKey = activeLeaveType.code.toLowerCase();
    const availableBalance = balances.balance[typeKey] ?? 0;

    if (availableBalance < daysCount) {
      throw new HttpError(
        400,
        `Insufficient ${activeLeaveType.code} leave balance. Available: ${availableBalance} day(s), Requested: ${daysCount} day(s).`
      );
    }

    // Create the approved LeaveRequest record in leave_requests collection
    let newLeave;
    if (LeaveRequest) {
      newLeave = await LeaveRequest.create({
        employeeId: employee._id,
        leaveTypeCode: activeLeaveType.code,
        fromDate: start,
        toDate: end,
        daysCount,
        reason: reason ? String(reason).trim() : "",
        status: "PENDING",
        decision: { decidedBy: null, decidedAt: null, remarks: "" },
      });
    } else {
      newLeave = {
        _id: new mongoose.Types.ObjectId(),
        leaveTypeCode: activeLeaveType.code,
        fromDate: start,
        toDate: end,
        daysCount,
        reason: reason ? String(reason).trim() : "",
        status: "PENDING",
        createdAt: new Date(),
      };
    }

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.LEAVE_REQUESTED, newLeave._id, {
        employeeId: employee._id,
        leaveTypeCode: newLeave.leaveTypeCode,
        fromDate: start,
        toDate: end,
        daysCount,
      });
    }

    // Do NOT deduct balance for pending requests!
    res.status(201).json({
      success: true,
      message: "Leave application submitted successfully.",
      leaveRequest: {
        id: String(newLeave._id),
        _id: newLeave._id,
        leaveType: newLeave.leaveTypeCode,
        leaveTypeCode: newLeave.leaveTypeCode,
        startDate: toDateString(newLeave.fromDate),
        endDate: toDateString(newLeave.toDate),
        days: newLeave.daysCount,
        daysCount: newLeave.daysCount,
        reason: newLeave.reason,
        status: newLeave.status,
        requestedAt: newLeave.createdAt,
      },
      remainingBalance: balances.balance,
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadPayslip(req, res, next) {
  try {
    const { Employee, EmployeeCompensation } = req.auth.models;
    const { payslipId } = req.params;

    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee record not found.");
    }

    let ctc = 0;
    let basic = 0;
    let hra = 0;
    let special = 0;
    let deductions = 0;
    let netPay = 0;

    if (EmployeeCompensation) {
      const comp = await EmployeeCompensation.findOne({ employeeId: employee._id }).lean();
      if (comp && comp.revisions && comp.revisions.length > 0) {
        const latest = comp.revisions[comp.revisions.length - 1];
        ctc = parseFloat(latest.monthlyCostToCompany.toString());
        basic = latest.salaryComponents?.basicSalary ? parseFloat(latest.salaryComponents.basicSalary.toString()) : Math.round(ctc * 0.5);
        hra = latest.salaryComponents?.houseRentAllowance ? parseFloat(latest.salaryComponents.houseRentAllowance.toString()) : Math.round(ctc * 0.3);
        special = latest.salaryComponents?.specialAllowance ? parseFloat(latest.salaryComponents.specialAllowance.toString()) : Math.max(0, ctc - (basic + hra));
        deductions = latest.salaryComponents?.employerProvidentFund ? parseFloat(latest.salaryComponents.employerProvidentFund.toString()) : Math.round(basic * 0.12);
        netPay = ctc - deductions;
      }
    }

    const companyName = req.auth.company?.companyName || "Enterprise Organization";
    const payslipText = `===============================================================
                     SALARY PAYSLIP
===============================================================
Company:       ${companyName}
Employee Name: ${employee.fullName}
Employee ID:   ${employee.employeeCode}
Department:    ${employee.job?.department || "General"}
Job Title:     ${employee.job?.jobTitle || "Specialist"}
Payslip Ref:   ${payslipId}
Payment Mode:  Bank Transfer
Bank Account:  ${employee.bankDetails?.accountNumber ? "XXXX-" + String(employee.bankDetails.accountNumber).slice(-4) : "Registered Account"}
Status:        PAID
---------------------------------------------------------------
EARNINGS                              AMOUNT (INR)
---------------------------------------------------------------
Basic Salary:                         INR ${basic.toLocaleString("en-IN")}
House Rent Allowance (HRA):           INR ${hra.toLocaleString("en-IN")}
Special Allowance:                    INR ${special.toLocaleString("en-IN")}
---------------------------------------------------------------
GROSS EARNINGS:                       INR ${ctc.toLocaleString("en-IN")}
---------------------------------------------------------------
DEDUCTIONS                            AMOUNT (INR)
---------------------------------------------------------------
Provident Fund (EPF):                 INR ${deductions.toLocaleString("en-IN")}
Professional Tax:                     INR 0
---------------------------------------------------------------
TOTAL DEDUCTIONS:                     INR ${deductions.toLocaleString("en-IN")}
---------------------------------------------------------------
NET TAKE-HOME SALARY:                 INR ${netPay.toLocaleString("en-IN")}
===============================================================
This is a system-generated document and does not require a signature.
===============================================================`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Payslip_${employee.employeeCode}_${payslipId}.txt"`);
    return res.send(payslipText);
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
      department,
      employmentType,
      jobGrade,
      workLocation,
      joiningDate,
      reportingManagerId,
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

    const { Employee, User, EmployeeCompensation, AuthToken, AuditLog } = req.auth.models;

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
      const initialPassword = password && password.length >= 8 ? password : "TempPass" + Math.random().toString(36).substring(2, 8) + "!";
      const passwordHash = await hashPassword(initialPassword);
      user = await User.create({
        email: normalizedEmail,
        passwordHash,
        role: USER_ROLES.EMPLOYEE,
        isActive: status === EMPLOYEE_STATUSES.ACTIVE,
        schemaVersion: 1,
      });
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
        department: department ? String(department).trim() : "",
        employmentType: employmentType ? String(employmentType).trim() : "Full-time",
        jobGrade: jobGrade ? String(jobGrade).trim() : "",
        workLocation: workLocation ? String(workLocation).trim() : "",
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        reportingManagerId: reportingManagerId || null,
        project: {
          projectName: projectName ? String(projectName).trim() : "",
          projectType: projectType || "MANDATE",
        },
      },
      schemaVersion: 1,
    });

    // Generate onboarding invitation token
    const inviteToken = signEmployeeInvitationToken({
      companyId: req.auth.company._id,
      employeeId: employee._id,
      email: normalizedEmail,
    });

    if (AuthToken) {
      await AuthToken.create({
        userId: user._id,
        email: normalizedEmail,
        token: inviteToken,
        type: TOKEN_TYPES.ONBOARDING,
        role: "EMPLOYEE",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: req.auth.user._id,
        isActive: true,
      });
    }

    const clientUrl = process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const inviteLink = `${clientUrl}/onboard?token=${inviteToken}`;

    const emailResult = await emailService.sendEmployeeInvitation({
      companyName: req.auth.company?.companyName || req.auth.company?.name || "Your Company",
      employeeName: employee.fullName,
      email: normalizedEmail,
      inviteLink,
    });

    employee.invitation = {
      status: emailResult.success ? "PENDING" : "DELIVERY_FAILED",
      token: inviteToken,
      sentAt: new Date(),
    };
    await employee.save();

    const numericSalary = parseFloat(monthlySalary);
    if (!isNaN(numericSalary) && numericSalary > 0 && EmployeeCompensation) {
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

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.EMPLOYEE_CREATED, employee._id, {
        fullName: employee.fullName,
        employeeCode: employee.employeeCode,
        email: employee.email,
        monthlySalary: !isNaN(numericSalary) ? numericSalary : null,
      });
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.INVITATION_SENT, employee._id, {
        email: normalizedEmail,
        deliveryStatus: employee.invitation.status,
        error: emailResult.error || null,
      });
    }

    res.status(201).json({
      message: "Employee created successfully",
      employee,
      invitation: {
        status: employee.invitation.status,
        inviteLink,
        emailSent: emailResult.success,
        error: emailResult.error || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateEmployee(req, res, next) {
  try {
    const { Employee, User, EmployeeCompensation, AuditLog } = req.auth.models;
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) {
      throw new HttpError(404, "Employee not found");
    }

    const {
      fullName,
      preferredName,
      personalEmail,
      personalPhone,
      phoneNumber,
      dateOfBirth,
      gender,
      city,
      residentialAddress,
      workAddress,
      emergencyContact,
      jobTitle,
      department,
      jobGrade,
      employmentType,
      workLocation,
      status,
      joiningDate,
      terminationDate,
      projectName,
      projectType,
      bankDetails,
      taxDetails,
      identityDetails,
      attendance,
      monthlySalary,
    } = req.body || {};

    const changes = {};

    // Personal details
    if (fullName && typeof fullName === "string" && fullName.trim()) {
      changes.fullName = { old: employee.fullName, new: fullName.trim() };
      employee.fullName = fullName.trim();
    }
    if (preferredName !== undefined) {
      employee.preferredName = String(preferredName).trim();
    }
    if (personalEmail !== undefined) {
      employee.personalEmail = String(personalEmail).trim();
    }
    if (personalPhone !== undefined) {
      employee.personalPhone = String(personalPhone).trim();
    }
    if (phoneNumber !== undefined) {
      changes.phoneNumber = { old: employee.phoneNumber, new: String(phoneNumber).trim() };
      employee.phoneNumber = String(phoneNumber).trim();
    }
    if (dateOfBirth !== undefined) {
      employee.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    }
    if (gender !== undefined) {
      employee.gender = String(gender).trim();
    }
    if (city !== undefined) {
      changes.city = { old: employee.city, new: String(city).trim() };
      employee.city = String(city).trim();
    }
    if (residentialAddress && typeof residentialAddress === "object") {
      employee.residentialAddress = { ...employee.residentialAddress, ...residentialAddress };
    }
    if (workAddress && typeof workAddress === "object") {
      employee.workAddress = { ...employee.workAddress, ...workAddress };
    }
    if (emergencyContact && typeof emergencyContact === "object") {
      employee.emergencyContact = { ...employee.emergencyContact, ...emergencyContact };
    }

    // Job / Employment details
    if (jobTitle !== undefined) {
      changes.jobTitle = { old: employee.job.jobTitle, new: String(jobTitle).trim() };
      employee.job.jobTitle = String(jobTitle).trim();
    }
    if (department !== undefined) {
      employee.job.department = String(department).trim();
    }
    if (jobGrade !== undefined) {
      employee.job.jobGrade = String(jobGrade).trim();
    }
    if (employmentType !== undefined) {
      employee.job.employmentType = String(employmentType).trim();
    }
    if (workLocation !== undefined) {
      employee.job.workLocation = String(workLocation).trim();
    }
    if (joiningDate && !isNaN(new Date(joiningDate).getTime())) {
      employee.job.joiningDate = new Date(joiningDate);
    }
    if (terminationDate !== undefined) {
      employee.job.terminationDate = terminationDate ? new Date(terminationDate) : null;
    }
    if (projectName !== undefined) {
      employee.job.project.projectName = String(projectName).trim();
    }
    if (projectType !== undefined) {
      employee.job.project.projectType = projectType;
    }

    // Status changes
    let statusChanged = false;
    if (
      status &&
      (status === EMPLOYEE_STATUSES.ACTIVE || status === EMPLOYEE_STATUSES.INACTIVE) &&
      status !== employee.status
    ) {
      statusChanged = true;
      changes.status = { old: employee.status, new: status };
      employee.status = status;
      if (employee.userId && User) {
        await User.findByIdAndUpdate(employee.userId, {
          isActive: status === EMPLOYEE_STATUSES.ACTIVE,
        });
      }
    }

    // Bank Details (Sensitive)
    let bankChanged = false;
    if (bankDetails && typeof bankDetails === "object") {
      bankChanged = true;
      changes.bankDetails = { updated: true };
      employee.bankDetails = {
        ...employee.bankDetails,
        ...bankDetails,
      };
    }

    // Tax Details
    if (taxDetails && typeof taxDetails === "object") {
      employee.taxDetails = {
        ...employee.taxDetails,
        ...taxDetails,
      };
    }

    // Identity Details (Sensitive)
    let identityChanged = false;
    if (identityDetails && typeof identityDetails === "object") {
      identityChanged = true;
      changes.identityDetails = { updated: true };
      employee.identityDetails = {
        ...employee.identityDetails,
        ...identityDetails,
      };
    }

    // Attendance
    if (attendance && typeof attendance === "object") {
      employee.attendance = {
        ...employee.attendance,
        ...attendance,
      };
    }

    await employee.save();

    // Audit logs for sensitive events
    if (statusChanged && AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.STATUS_CHANGED, employee._id, changes.status);
    }
    if (bankChanged && AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.BANK_DETAILS_UPDATED, employee._id, { updatedFields: Object.keys(bankDetails) });
    }
    if (identityChanged && AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.IDENTITY_VERIFIED, employee._id, { updatedFields: Object.keys(identityDetails) });
    }

    // Compensation updates
    if (monthlySalary !== undefined && monthlySalary !== null && monthlySalary !== "") {
      const numSal = parseFloat(monthlySalary);
      if (!isNaN(numSal) && numSal >= 0 && EmployeeCompensation) {
        const basic = numSal * 0.5;
        const hra = numSal * 0.25;
        const conveyance = numSal * 0.1;
        const special = numSal * 0.15;

        let compRecord = await EmployeeCompensation.findOne({ employeeId: employee._id });
        const newRevision = {
          effectiveFromDate: new Date(),
          monthlyCostToCompany: mongoose.Types.Decimal128.fromString(numSal.toFixed(2)),
          salaryComponents: {
            basicSalary: mongoose.Types.Decimal128.fromString(basic.toFixed(2)),
            houseRentAllowance: mongoose.Types.Decimal128.fromString(hra.toFixed(2)),
            conveyanceAllowance: mongoose.Types.Decimal128.fromString(conveyance.toFixed(2)),
            specialAllowance: mongoose.Types.Decimal128.fromString(special.toFixed(2)),
          },
          revisedBy: req.auth.user._id,
          revisedAt: new Date(),
        };

        if (compRecord) {
          compRecord.revisions.push(newRevision);
          await compRecord.save();
        } else {
          await EmployeeCompensation.create({
            employeeId: employee._id,
            revisions: [newRevision],
            schemaVersion: 1,
          });
        }

        if (AuditLog) {
          await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.COMPENSATION_REVISED, employee._id, {
            monthlyCostToCompany: numSal,
          });
        }
      }
    }

    // General update audit log
    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.EMPLOYEE_UPDATED, employee._id, changes);
    }

    res.json({
      message: "Employee updated successfully",
      employee,
    });
  } catch (error) {
    next(error);
  }
}

export async function resendInvitation(req, res, next) {
  try {
    const { Employee, AuthToken, AuditLog } = req.auth.models;
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) {
      throw new HttpError(404, "Employee not found");
    }

    if (employee.invitation?.status === "ACCEPTED") {
      throw new HttpError(400, "Employee has already accepted their onboarding invitation and established credentials.");
    }

    const inviteToken = signEmployeeInvitationToken({
      companyId: req.auth.company._id,
      employeeId: employee._id,
      email: employee.email,
    });

    if (AuthToken) {
      // Invalidate any older pending invitation tokens for this user
      await AuthToken.updateMany(
        { email: employee.email, role: "EMPLOYEE", isActive: true },
        { isActive: false }
      );

      await AuthToken.create({
        userId: employee.userId,
        email: employee.email,
        token: inviteToken,
        type: TOKEN_TYPES.ONBOARDING,
        role: "EMPLOYEE",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: req.auth.user._id,
        isActive: true,
      });
    }

    const clientUrl = process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const inviteLink = `${clientUrl}/onboard?token=${inviteToken}`;

    const emailResult = await emailService.sendEmployeeInvitation({
      companyName: req.auth.company?.companyName || req.auth.company?.name || "Your Organization",
      employeeName: employee.fullName,
      email: employee.email,
      inviteLink,
    });

    employee.invitation = {
      status: emailResult.success ? "PENDING" : "DELIVERY_FAILED",
      token: inviteToken,
      sentAt: new Date(),
    };
    await employee.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.INVITATION_RESENT, employee._id, {
        email: employee.email,
        deliveryStatus: employee.invitation.status,
        error: emailResult.error || null,
      });
    }

    res.json({
      message: emailResult.success ? "Invitation resent successfully" : "Invitation created, but email delivery failed",
      invitation: {
        status: employee.invitation.status,
        inviteLink,
        emailSent: emailResult.success,
        error: emailResult.error || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMyProfile(req, res, next) {
  try {
    const { Employee, AuditLog } = req.auth.models;
    const employee = await Employee.findOne({
      $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
    });

    if (!employee) {
      throw new HttpError(404, "Employee record not found for your account.");
    }

    const forbiddenFields = [
      "employeeCode",
      "status",
      "job",
      "jobTitle",
      "department",
      "jobGrade",
      "employmentType",
      "workLocation",
      "joiningDate",
      "terminationDate",
      "reportingManagerId",
      "projectName",
      "projectType",
      "monthlySalary",
      "salaryComponents",
      "salary",
      "userId",
      "email",
      "invitation",
      "attendance",
    ];

    for (const field of forbiddenFields) {
      if (req.body[field] !== undefined) {
        throw new HttpError(403, `Employees are not permitted to modify HR-controlled field: '${field}'`);
      }
    }

    const {
      preferredName,
      personalEmail,
      personalPhone,
      phoneNumber,
      dateOfBirth,
      gender,
      city,
      residentialAddress,
      emergencyContact,
      bankDetails,
      taxDetails,
    } = req.body || {};

    const changes = {};

    if (preferredName !== undefined) {
      changes.preferredName = { old: employee.preferredName, new: String(preferredName).trim() };
      employee.preferredName = String(preferredName).trim();
    }
    if (personalEmail !== undefined) {
      changes.personalEmail = { old: employee.personalEmail, new: String(personalEmail).trim().toLowerCase() };
      employee.personalEmail = String(personalEmail).trim().toLowerCase();
    }
    if (personalPhone !== undefined) {
      employee.personalPhone = String(personalPhone).trim();
    }
    if (phoneNumber !== undefined) {
      changes.phoneNumber = { old: employee.phoneNumber, new: String(phoneNumber).trim() };
      employee.phoneNumber = String(phoneNumber).trim();
    }
    if (dateOfBirth !== undefined) {
      employee.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
    }
    if (gender !== undefined) {
      employee.gender = String(gender).trim();
    }
    if (city !== undefined) {
      changes.city = { old: employee.city, new: String(city).trim() };
      employee.city = String(city).trim();
    }
    if (residentialAddress && typeof residentialAddress === "object") {
      employee.residentialAddress = { ...employee.residentialAddress, ...residentialAddress };
    }
    if (emergencyContact && typeof emergencyContact === "object") {
      employee.emergencyContact = { ...employee.emergencyContact, ...emergencyContact };
    }
    if (bankDetails && typeof bankDetails === "object") {
      changes.bankDetails = { updated: true };
      employee.bankDetails = { ...employee.bankDetails, ...bankDetails };
    }
    if (taxDetails && typeof taxDetails === "object") {
      changes.taxDetails = { updated: true };
      employee.taxDetails = { ...employee.taxDetails, ...taxDetails };
    }

    await employee.save();

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.EMPLOYEE_SELF_UPDATED, employee._id, changes);
    }

    res.json({
      message: "Profile updated successfully",
      employee,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadEmployeeDocument(req, res, next) {
  try {
    const { Employee, AuditLog } = req.auth.models;
    const isSelf = req.params.id === undefined || req.path.includes("/me/");
    let employee;

    if (isSelf) {
      employee = await Employee.findOne({
        $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
      });
    } else {
      employee = await Employee.findById(req.params.id);
      if (employee && req.auth.user.role === USER_ROLES.EMPLOYEE) {
        if (!employee.userId || employee.userId.toString() !== req.auth.user._id.toString()) {
          throw new HttpError(403, "You are not authorized to upload documents for another employee.");
        }
      }
    }

    if (!employee) {
      throw new HttpError(404, "Employee record not found");
    }

    const {
      fileName,
      fileData,
      mimeType,
      fileSize,
      documentType = "OTHER",
      title,
    } = req.body || {};

    if (!fileName || !fileData) {
      throw new HttpError(400, "File name and file data are required.");
    }

    // Save document file securely via documentStorage
    const saved = await saveDocumentFile({
      databaseName: req.auth.company.databaseName,
      employeeId: employee._id,
      fileName,
      fileData,
      mimeType,
    });

    const isHR = req.auth.user.role === USER_ROLES.HR_ADMIN;

    const newDoc = {
      documentType: documentType.toUpperCase(),
      title: title ? String(title).trim() : fileName,
      fileName: saved.fileName,
      fileSize: saved.fileSize,
      mimeType: saved.mimeType,
      storageKey: saved.storageKey,
      uploadedBy: req.auth.user._id,
      uploadedByRole: req.auth.user.role,
      uploadedAt: new Date(),
      verified: isHR,
    };

    employee.documents.push(newDoc);
    await employee.save();

    const createdDoc = employee.documents[employee.documents.length - 1];

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.DOCUMENT_UPLOADED, employee._id, {
        documentId: createdDoc._id,
        documentType: newDoc.documentType,
        fileName: newDoc.fileName,
        fileSize: newDoc.fileSize,
        uploadedByRole: newDoc.uploadedByRole,
      });
    }

    res.status(201).json({
      message: "Document uploaded successfully",
      document: createdDoc,
      documents: employee.documents,
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadDocument(req, res, next) {
  try {
    const { Employee, AuditLog } = req.auth.models;
    const { id, docId } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) {
      throw new HttpError(404, "Employee not found");
    }

    // Authorization check
    if (req.auth.user.role === USER_ROLES.EMPLOYEE) {
      if (!employee.userId || employee.userId.toString() !== req.auth.user._id.toString()) {
        throw new HttpError(403, "Access denied. You cannot access documents belonging to another employee.");
      }
    }

    const doc = employee.documents.id(docId);
    if (!doc) {
      throw new HttpError(404, "Document not found");
    }

    const filePath = getDocumentAbsolutePath({
      databaseName: req.auth.company.databaseName,
      employeeId: employee._id,
      storageKey: doc.storageKey,
    });

    if (!filePath) {
      throw new HttpError(404, "Document file not found on storage server.");
    }

    if (AuditLog) {
      await recordAuditLog(AuditLog, req, AUDIT_ACTIONS.DOCUMENT_DOWNLOADED, employee._id, {
        documentId: doc._id,
        fileName: doc.fileName,
        downloadedByRole: req.auth.user.role,
      });
    }

    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
    return res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
}
