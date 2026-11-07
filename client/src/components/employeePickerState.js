export function employeeRecordFromApi(employee) {
  if (!employee) return null;
  const id = employee._id || employee.id;
  if (!id) return null;
  return {
    id: String(id),
    fullName: employee.fullName || "",
    jobTitle: employee.job?.jobTitle || employee.jobTitle || "",
    employeeCode: employee.employeeCode || "",
    status: employee.status || "ACTIVE",
  };
}

/** Keep chosen employees when a new search page does not include them. */
export function retainSelectedEmployees(selectedRecords, pageRows) {
  const pageById = new Map((pageRows || []).map((row) => [String(row.id), row]));
  return (selectedRecords || []).filter(Boolean).map((row) => pageById.get(String(row.id)) || row);
}
