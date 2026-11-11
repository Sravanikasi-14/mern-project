/**
 * Normalize bulk-import row keys to the canonical employee provision fields.
 * Supports the official template headers and common external aliases
 * (e.g. employee_id/name/title/hire_date from workforce exports).
 *
 * Business rule: employee_id / Employee ID aliases map to employeeCode only
 * (the tenant's employee code). They never invent email or other required fields.
 */

const HEADER_ALIASES = Object.freeze({
  fullname: "fullName",
  "full name": "fullName",
  name: "fullName",
  employeename: "fullName",
  "employee name": "fullName",

  email: "email",
  "email address": "email",
  "work email": "email",
  emailid: "email",
  "email id": "email",

  employeecode: "employeeCode",
  "employee code": "employeeCode",
  employee_id: "employeeCode",
  employeeid: "employeeCode",
  "employee id": "employeeCode",
  empcode: "employeeCode",
  "emp code": "employeeCode",
  emp_id: "employeeCode",
  code: "employeeCode",

  jobtitle: "jobTitle",
  "job title": "jobTitle",
  title: "jobTitle",
  designation: "jobTitle",
  position: "jobTitle",

  department: "department",
  dept: "department",
  "dept name": "department",

  employmenttype: "employmentType",
  "employment type": "employmentType",
  emp_type: "employmentType",
  type: "employmentType",

  joiningdate: "joiningDate",
  "joining date": "joiningDate",
  hire_date: "joiningDate",
  hiredate: "joiningDate",
  "hire date": "joiningDate",
  dateofjoining: "joiningDate",
  "date of joining": "joiningDate",
  doj: "joiningDate",
  startdate: "joiningDate",
  "start date": "joiningDate",

  monthlysalary: "monthlySalary",
  "monthly salary": "monthlySalary",
  salary: "monthlySalary",
  ctc: "monthlySalary",
  "monthly ctc": "monthlySalary",
  pay: "monthlySalary",

  projectname: "projectName",
  "project name": "projectName",
  project: "projectName",

  worklocation: "workLocation",
  "work location": "workLocation",
  location: "workLocation",
  office: "workLocation",
  city: "workLocation",

  phonenumber: "phoneNumber",
  "phone number": "phoneNumber",
  phone: "phoneNumber",
  mobile: "phoneNumber",
  "mobile number": "phoneNumber",

  reportingmanagercode: "reportingManagerCode",
  "reporting manager code": "reportingManagerCode",
  manager_id: "reportingManagerCode",
  managerid: "reportingManagerCode",
  "manager id": "reportingManagerCode",
  manager: "reportingManagerCode",
  "manager code": "reportingManagerCode",
  reportingmanager: "reportingManagerCode",
  "reporting manager": "reportingManagerCode",
});

const CANONICAL_COMPACT = Object.freeze({
  fullname: "fullName",
  email: "email",
  employeecode: "employeeCode",
  jobtitle: "jobTitle",
  department: "department",
  employmenttype: "employmentType",
  joiningdate: "joiningDate",
  monthlysalary: "monthlySalary",
  projectname: "projectName",
  worklocation: "workLocation",
  phonenumber: "phoneNumber",
  reportingmanagercode: "reportingManagerCode",
  reportingmanagerid: "reportingManagerId",
});

export function normalizeHeaderKey(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function canonicalImportField(header) {
  const key = normalizeHeaderKey(header);
  if (!key) return null;
  if (HEADER_ALIASES[key]) return HEADER_ALIASES[key];
  const compact = key.replace(/\s+/g, "");
  return CANONICAL_COMPACT[compact] || null;
}

/**
 * Excel serial day number → YYYY-MM-DD (SheetJS / Excel 1900 date system).
 */
function excelSerialToCivilDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return "";
  // Excel epoch quirk: serial 1 = 1899-12-31 in the 1900 system used by SheetJS.
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toCivilDateString(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Treat large day-counts as Excel serials; small numbers are unlikely salaries here
    // because this helper is only called for joiningDate.
    return excelSerialToCivilDate(value);
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  // Numeric string Excel serial
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const asNum = Number(raw);
    if (asNum > 20000 && asNum < 80000) return excelSerialToCivilDate(asNum);
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw;
}

function normalizeSalaryCell(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const cleaned = String(value)
    .replace(/[₹$€£,\s]/g, "")
    .replace(/INR/gi, "")
    .trim();
  return cleaned;
}

/**
 * Field-aware cell normalization after header mapping.
 */
export function normalizeMappedCell(field, rawValue) {
  if (rawValue == null) return "";
  if (field === "joiningDate") return toCivilDateString(rawValue);
  if (field === "monthlySalary") return normalizeSalaryCell(rawValue);
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) return String(rawValue);
  if (rawValue instanceof Date) return toCivilDateString(rawValue);
  return String(rawValue).trim();
}

/**
 * Map a raw spreadsheet/CSV row onto canonical import fields.
 * First matching alias wins; blank values do not overwrite a prior non-blank value.
 */
export function mapImportRowToCanonical(row = {}) {
  return mapImportRowDetailed(row).mapped;
}

export function mapImportRowDetailed(row = {}) {
  const mapped = {};
  const unrecognizedHeaders = [];
  const recognizedHeaders = [];

  for (const [rawKey, rawValue] of Object.entries(row || {})) {
    if (rawKey == null || String(rawKey).trim() === "") continue;
    const field = canonicalImportField(rawKey);
    if (!field) {
      unrecognizedHeaders.push(String(rawKey));
      continue;
    }
    recognizedHeaders.push(String(rawKey));
    const value = normalizeMappedCell(field, rawValue);
    if (value === "" && mapped[field]) continue;
    if (value !== "" || mapped[field] === undefined) {
      mapped[field] = value;
    }
  }

  return { mapped, unrecognizedHeaders, recognizedHeaders };
}

export function mapImportRowsToCanonical(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => mapImportRowToCanonical(row));
}

/**
 * Collect unrecognized headers across a batch (stable unique order).
 */
export function collectUnrecognizedImportHeaders(rows = []) {
  const seen = new Set();
  const ordered = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const key of Object.keys(row || {})) {
      if (!key || seen.has(key)) continue;
      if (!canonicalImportField(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}
