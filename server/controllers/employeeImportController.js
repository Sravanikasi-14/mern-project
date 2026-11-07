import {
  provisionEmployeeAccount,
  validateImportRow,
  PROVISIONING_SOURCES,
} from "../services/employeeProvisioningService.js";
import { HttpError } from "../utils/httpError.js";
import { isImportDepartmentInHrScope } from "../services/hrAccessEnforcementService.js";

export const EMPLOYEE_IMPORT_TEMPLATE_HEADERS = [
  "fullName",
  "email",
  "employeeCode",
  "jobTitle",
  "department",
  "employmentType",
  "joiningDate",
  "monthlySalary",
  "projectName",
  "workLocation",
  "phoneNumber",
  "reportingManagerCode",
];

/**
 * Downloadable CSV template for bulk employee import.
 */
export async function downloadImportTemplate(req, res, next) {
  try {
    const sample = [
      EMPLOYEE_IMPORT_TEMPLATE_HEADERS.join(","),
      [
        "Maya Rao",
        "maya.rao@example.com",
        "EMP-101",
        "Software Engineer",
        "Engineering",
        "Full-time",
        "2026-04-01",
        "75000",
        "Platform",
        "Bengaluru",
        "+91 9000000001",
        "",
      ].join(","),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="employee-import-template.csv"');
    res.status(200).send(sample);
  } catch (error) {
    next(error);
  }
}

/**
 * Preview + validate import rows without creating accounts.
 * Body: { rows: Array<record> }
 */
export async function previewEmployeeImport(req, res, next) {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      throw new HttpError(400, "Import rows are required.");
    }
    if (rows.length > 500) {
      throw new HttpError(400, "Import is limited to 500 rows per batch.");
    }

    const seenEmails = new Set();
    const seenCodes = new Set();
    const results = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      let { valid, errors, normalized } = await validateImportRow(req.auth.models, row, {
        seenEmails,
        seenCodes,
      });
      if (valid && !(await isImportDepartmentInHrScope(req.hrAccess, req.auth.models, normalized?.department))) {
        valid = false;
        errors = {
          ...(errors || {}),
          department: "This department is outside your employee scope.",
        };
      }
      results.push({
        rowIndex: i,
        valid,
        errors,
        data: normalized
          ? {
              fullName: normalized.fullName,
              email: normalized.email,
              employeeCode: normalized.employeeCode,
              jobTitle: normalized.jobTitle,
              department: normalized.department,
              employmentType: normalized.employmentType,
              joiningDate: normalized.joiningDate,
              monthlySalary: normalized.monthlySalary,
              projectName: normalized.projectName,
              workLocation: normalized.workLocation,
              phoneNumber: normalized.phoneNumber,
              reportingManagerId: normalized.reportingManagerId,
            }
          : row,
      });
    }

    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.length - validCount;

    res.json({
      summary: {
        totalRows: results.length,
        validRows: validCount,
        invalidRows: invalidCount,
      },
      rows: results,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Commit bulk import. Provisions each valid row via shared service.
 * Invalid rows are reported; they are never silently skipped.
 * Body: { rows: Array<record>, importValidOnly?: boolean }
 *
 * Activation links are returned only in the authorised response —
 * never written to audit logs or downloadable error reports.
 */
export async function commitEmployeeImport(req, res, next) {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    const importValidOnly = req.body?.importValidOnly !== false;

    if (!rows || rows.length === 0) {
      throw new HttpError(400, "Import rows are required.");
    }
    if (rows.length > 500) {
      throw new HttpError(400, "Import is limited to 500 rows per batch.");
    }

    const clientBaseUrl =
      process.env.CLIENT_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;

    const companyContext = {
      models: req.auth.models,
      company: req.auth.company,
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      clientBaseUrl,
      ipAddress: req.ip || "",
    };

    const seenEmails = new Set();
    const seenCodes = new Set();
    const validated = [];

    for (let i = 0; i < rows.length; i += 1) {
      let { valid, errors, normalized } = await validateImportRow(req.auth.models, rows[i] || {}, {
        seenEmails,
        seenCodes,
      });
      if (valid && !(await isImportDepartmentInHrScope(req.hrAccess, req.auth.models, normalized?.department))) {
        valid = false;
        errors = {
          ...(errors || {}),
          department: "This department is outside your employee scope.",
        };
      }
      validated.push({ rowIndex: i, valid, errors, normalized, raw: rows[i] });
    }

    const invalidRows = validated.filter((r) => !r.valid);
    if (!importValidOnly && invalidRows.length > 0) {
      return res.status(400).json({
        message: "Import contains invalid rows. Correct them or set importValidOnly=true.",
        code: "IMPORT_HAS_INVALID_ROWS",
        summary: {
          totalRows: validated.length,
          validRows: validated.length - invalidRows.length,
          invalidRows: invalidRows.length,
          createdCount: 0,
          failedCount: invalidRows.length,
        },
        created: [],
        failed: invalidRows.map((r) => ({
          rowIndex: r.rowIndex,
          errors: r.errors,
          data: {
            fullName: r.raw?.fullName,
            email: r.raw?.email,
            employeeCode: r.raw?.employeeCode,
          },
        })),
      });
    }

    const created = [];
    const failed = [];

    for (const row of validated) {
      if (!row.valid) {
        failed.push({
          rowIndex: row.rowIndex,
          errors: row.errors,
          data: {
            fullName: row.raw?.fullName,
            email: row.raw?.email,
            employeeCode: row.raw?.employeeCode,
          },
          // intentionally omit activation tokens
        });
        continue;
      }

      try {
        const result = await provisionEmployeeAccount(companyContext, row.normalized, {
          source: PROVISIONING_SOURCES.BULK_IMPORT,
        });
        created.push({
          rowIndex: row.rowIndex,
          employeeId: result.employee._id,
          employeeCode: result.employee.employeeCode,
          email: result.employee.email,
          fullName: result.employee.fullName,
          accountStatus: result.accountStatus,
          activationLink: result.activation.activationLink,
          expiresAt: result.activation.expiresAt,
        });
      } catch (err) {
        failed.push({
          rowIndex: row.rowIndex,
          errors: err.errors || { _row: err.message || "Provisioning failed" },
          data: {
            fullName: row.normalized.fullName,
            email: row.normalized.email,
            employeeCode: row.normalized.employeeCode,
          },
          code: err.code || null,
        });
      }
    }

    res.status(created.length > 0 ? 201 : 400).json({
      message:
        created.length > 0
          ? `Imported ${created.length} employee(s). Share activation links individually.`
          : "No employees were imported.",
      summary: {
        totalRows: validated.length,
        validRows: validated.filter((r) => r.valid).length,
        invalidRows: invalidRows.length,
        createdCount: created.length,
        failedCount: failed.length,
      },
      created,
      failed,
    });
  } catch (error) {
    next(error);
  }
}
