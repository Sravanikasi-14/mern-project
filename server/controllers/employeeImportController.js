import {
  provisionEmployeeAccount,
  validateImportRow,
  PROVISIONING_SOURCES,
} from "../services/employeeProvisioningService.js";
import { HttpError } from "../utils/httpError.js";
import { isImportDepartmentInHrScope } from "../services/hrAccessEnforcementService.js";
import { collectUnrecognizedImportHeaders } from "../utils/employeeImportMapping.js";

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

/** Hard cap on rows accepted in one import payload (preview + commit). */
export const EMPLOYEE_IMPORT_MAX_ROWS = 500;

/**
 * F52 — Default provisions per commit request.
 * On Vercel, keep well under the 60s invocation budget; local/dev may use a larger chunk.
 */
export function resolveEmployeeImportCommitChunk(limitOverride) {
  const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  const fallback = onVercel ? 40 : 100;
  const parsed = Number.parseInt(limitOverride, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, onVercel ? 75 : 200);
}

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
    if (rows.length > EMPLOYEE_IMPORT_MAX_ROWS) {
      throw new HttpError(400, `Import is limited to ${EMPLOYEE_IMPORT_MAX_ROWS} rows per batch.`);
    }

    const seenEmails = new Set();
    const seenCodes = new Set();
    const results = [];
    const unrecognizedColumns = collectUnrecognizedImportHeaders(rows);

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      let { valid, errors, normalized, unrecognizedHeaders } = await validateImportRow(
        req.auth.models,
        row,
        {
          seenEmails,
          seenCodes,
        }
      );
      if (valid && !(await isImportDepartmentInHrScope(req.hrAccess, req.auth.models, normalized?.department))) {
        valid = false;
        errors = {
          ...(errors || {}),
          department: "This department is outside your employee scope.",
        };
      }
      const joining =
        normalized?.joiningDate instanceof Date
          ? Number.isNaN(normalized.joiningDate.getTime())
            ? ""
            : normalized.joiningDate.toISOString().slice(0, 10)
          : normalized?.joiningDate
            ? String(normalized.joiningDate).slice(0, 10)
            : "";
      results.push({
        rowIndex: i,
        valid,
        errors,
        unrecognizedHeaders: unrecognizedHeaders || [],
        data: {
          fullName: normalized?.fullName || "",
          email: normalized?.email || "",
          employeeCode: normalized?.employeeCode || "",
          jobTitle: normalized?.jobTitle || "",
          department: normalized?.department || "",
          employmentType: normalized?.employmentType || "",
          joiningDate: joining,
          monthlySalary: normalized?.monthlySalary ?? "",
          projectName: normalized?.projectName || "",
          workLocation: normalized?.workLocation || "",
          phoneNumber: normalized?.phoneNumber || "",
          reportingManagerId: normalized?.reportingManagerId || null,
          reportingManagerCode: normalized?.reportingManagerCode || "",
        },
      });
    }

    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.length - validCount;

    res.json({
      summary: {
        totalRows: results.length,
        validRows: validCount,
        invalidRows: invalidCount,
        unrecognizedColumns,
      },
      unrecognizedColumns,
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
    if (rows.length > EMPLOYEE_IMPORT_MAX_ROWS) {
      throw new HttpError(400, `Import is limited to ${EMPLOYEE_IMPORT_MAX_ROWS} rows per batch.`);
    }

    // F52 — optional offset/limit chunking. Omitting both preserves legacy "commit all rows".
    const explicitChunk =
      req.body?.offset != null ||
      req.body?.limit != null ||
      req.body?.offset === 0 ||
      req.body?.limit === 0;
    const offset = Math.max(0, Number.parseInt(req.body?.offset, 10) || 0);
    const chunkSize = explicitChunk
      ? resolveEmployeeImportCommitChunk(req.body?.limit)
      : rows.length;
    if (offset >= rows.length) {
      return res.status(200).json({
        message: "No remaining rows to import.",
        summary: {
          totalRows: rows.length,
          validRows: 0,
          invalidRows: 0,
          createdCount: 0,
          failedCount: 0,
          offset,
          nextOffset: offset,
          chunkSize,
          hasMore: false,
        },
        created: [],
        failed: [],
      });
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

    // Validate the full payload so cross-row email/code uniqueness matches preview semantics,
    // then provision only the current offset window.
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
    if (!importValidOnly && invalidRows.length > 0 && offset === 0) {
      return res.status(400).json({
        message: "Import contains invalid rows. Correct them or set importValidOnly=true.",
        code: "IMPORT_HAS_INVALID_ROWS",
        summary: {
          totalRows: validated.length,
          validRows: validated.length - invalidRows.length,
          invalidRows: invalidRows.length,
          createdCount: 0,
          failedCount: invalidRows.length,
          offset: 0,
          nextOffset: 0,
          chunkSize,
          hasMore: false,
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

    const end = Math.min(validated.length, offset + chunkSize);
    const slice = validated.slice(offset, end);
    const created = [];
    const failed = [];

    for (const row of slice) {
      if (!row.valid) {
        failed.push({
          rowIndex: row.rowIndex,
          errors: row.errors,
          data: {
            fullName: row.normalized?.fullName || row.raw?.fullName || row.raw?.name,
            email: row.normalized?.email || row.raw?.email,
            employeeCode: row.normalized?.employeeCode || row.raw?.employeeCode || row.raw?.employee_id,
          },
          // intentionally omit activation tokens
        });
        continue;
      }

      try {
        const result = await provisionEmployeeAccount(companyContext, row.normalized, {
          source: PROVISIONING_SOURCES.BULK_IMPORT,
          generateCodeIfMissing: Boolean(row.normalized?._generateCodeOnCommit),
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

    const nextOffset = end;
    const hasMore = end < validated.length;
    const chunkCreated = created.length;
    // Preserve legacy single-shot semantics: first chunk with zero creates → 400.
    const httpStatus =
      chunkCreated > 0 ? 201 : !hasMore && offset === 0 ? 400 : 200;

    res.status(httpStatus).json({
      message:
        chunkCreated > 0
          ? hasMore
            ? `Imported ${chunkCreated} employee(s) in this chunk. Continue for remaining rows.`
            : `Imported ${chunkCreated} employee(s). Share activation links individually.`
          : hasMore
            ? "Chunk processed with no creates; continue for remaining rows."
            : "No employees were imported.",
      summary: {
        totalRows: validated.length,
        validRows: validated.filter((r) => r.valid).length,
        invalidRows: invalidRows.length,
        createdCount: chunkCreated,
        failedCount: failed.length,
        offset,
        nextOffset,
        chunkSize,
        hasMore,
      },
      created,
      failed,
    });
  } catch (error) {
    next(error);
  }
}
