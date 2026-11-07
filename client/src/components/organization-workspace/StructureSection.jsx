import { useEffect, useMemo, useState } from "react";
import AppModal from "../AppModal";
import EmployeePicker from "../EmployeePicker";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";

const EMPTY_DEPARTMENT = { name: "", code: "", description: "" };
const EMPTY_TEAM = {
  name: "",
  department: "",
  leadEmployeeId: "",
  memberEmployeeIds: [],
  leadRecord: null,
  memberRecords: [],
};

function teamPersonRecord(person) {
  if (!person?.id) return null;
  return {
    id: String(person.id),
    fullName: person.fullName || "",
    jobTitle: person.jobTitle || "",
    employeeCode: person.employeeCode || "",
    status: "ACTIVE",
  };
}

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

function matches(query, values) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}

export default function StructureSection({ embedded = false }) {
  const { user, company } = useAuth();
  const canManage = hrPortalAllows(user, company, "organization.manage");
  const [pane, setPane] = useState("departments");
  const [departments, setDepartments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamsDisabled, setTeamsDisabled] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [departmentForm, setDepartmentForm] = useState(null);
  const [teamForm, setTeamForm] = useState(null);
  const [inactiveMembers, setInactiveMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    setTeamsDisabled(false);
    const [departmentResult, teamResult] = await Promise.allSettled([
      api.get("/departments", { params: { includeInactive: true } }),
      api.get("/employees/organization-explorer/teams", { params: { includeInactive: true } }),
    ]);

    let nextError = "";
    if (departmentResult.status === "fulfilled") {
      setDepartments(departmentResult.value.data?.departments || []);
    } else {
      setDepartments([]);
      nextError = apiMessage(departmentResult.reason, "Departments could not be loaded.");
    }

    if (teamResult.status === "fulfilled") {
      setTeams(teamResult.value.data?.teams || []);
    } else {
      setTeams([]);
      const code = teamResult.reason?.response?.data?.code;
      if (code === "ORGANIZATION_EXPLORER_VIEW_DISABLED") {
        setTeamsDisabled(true);
      } else if (!nextError) {
        nextError = apiMessage(teamResult.reason, "Teams could not be loaded.");
      }
    }
    setError(nextError);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const visibleDepartments = useMemo(
    () =>
      departments.filter((department) => {
        if (status === "active" && !department.isActive) return false;
        if (status === "inactive" && department.isActive) return false;
        return matches(query, [department.name, department.code, department.description]);
      }),
    [departments, query, status]
  );

  const visibleTeams = useMemo(
    () =>
      teams.filter((team) => {
        if (status === "active" && team.isActive === false) return false;
        if (status === "inactive" && team.isActive !== false) return false;
        return matches(query, [team.name, team.department, team.lead?.fullName]);
      }),
    [teams, query, status]
  );

  const activeDepartments = departments.filter((department) => department.isActive).length;
  const activeTeams = teams.filter((team) => team.isActive !== false).length;

  const saveDepartment = async (event) => {
    event.preventDefault();
    const name = departmentForm.name.trim();
    if (!name) {
      setFormError("Department name is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      name,
      code: departmentForm.code.trim(),
      description: departmentForm.description.trim(),
    };
    try {
      if (departmentForm.id) {
        await api.patch(`/departments/${departmentForm.id}`, payload);
        setNotice("Department saved. Linked employee names and exact team department text stay in sync.");
      } else {
        await api.post("/departments", payload);
        setNotice("Department created.");
      }
      setDepartmentForm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The department could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const saveTeam = async (event) => {
    event.preventDefault();
    const name = teamForm.name.trim();
    if (!name) {
      setFormError("Team name is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const memberEmployeeIds = [...new Set(teamForm.memberEmployeeIds.map(String))];
    const payload = {
      name,
      department: teamForm.department.trim(),
      leadEmployeeId: teamForm.leadEmployeeId || null,
      memberEmployeeIds,
    };
    try {
      if (teamForm.id) {
        await api.put(`/employees/organization-explorer/teams/${teamForm.id}`, payload);
        setNotice("Team saved.");
      } else {
        await api.post("/employees/organization-explorer/teams", payload);
        setNotice("Team created.");
      }
      setTeamForm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The team could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setSaving(true);
    setFormError("");
    try {
      if (confirm.type === "department") {
        await api.post(`/departments/${confirm.id}/deactivate`);
        setNotice("Department deactivated. Existing employee assignments were kept.");
      } else if (confirm.type === "team") {
        await api.patch(`/employees/organization-explorer/teams/${confirm.id}/deactivate`);
        setNotice("Team deactivated. Membership history was kept.");
      } else if (confirm.type === "backfill") {
        const res = await api.post("/departments/backfill-department-links");
        const report = res.data?.report || {};
        setNotice(
          `Finished. Created ${report.departmentsCreated || 0}, reused ${report.departmentsReused || 0}, linked ${report.employeesLinked || 0}.`
        );
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The action could not be completed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={embedded ? "ow-embedded" : "ow-panel"} aria-label="Departments and teams">
      <div className="ow-section-head">
        {!embedded ? (
          <div>
            <h2>Departments and teams</h2>
            <p>Organize people into departments and teams.</p>
          </div>
        ) : null}
        <div className="ow-inline-actions">
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>Refresh</button>
          {canManage && pane === "departments" ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setFormError("");
                setDepartmentForm({ ...EMPTY_DEPARTMENT });
              }}
            >
              New department
            </button>
          ) : null}
          {canManage && pane === "teams" && !teamsDisabled ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setFormError("");
                setInactiveMembers([]);
                setTeamForm({ ...EMPTY_TEAM, memberEmployeeIds: [] });
              }}
            >
              New team
            </button>
          ) : null}
        </div>
      </div>

      <div className="org-stats" aria-label="Structure summary">
        <span>Active departments: <strong>{loading ? "…" : activeDepartments}</strong></span>
        <span>Active teams: <strong>{loading ? "…" : activeTeams}</strong></span>
      </div>

      <div className="ow-segment" role="tablist" aria-label="Departments or teams">
        <button type="button" role="tab" aria-selected={pane === "departments"} className={pane === "departments" ? "is-active" : ""} onClick={() => setPane("departments")}>
          Departments
        </button>
        <button type="button" role="tab" aria-selected={pane === "teams"} className={pane === "teams" ? "is-active" : ""} onClick={() => setPane("teams")}>
          Teams
        </button>
      </div>

      <div className="ow-toolbar">
        <input
          className="org-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={pane === "departments" ? "Search departments" : "Search teams"}
          aria-label={pane === "departments" ? "Search departments" : "Search teams"}
        />
        <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        {canManage && pane === "departments" ? (
          <button type="button" className="btn-secondary" onClick={() => { setFormError(""); setConfirm({ type: "backfill" }); }}>
            Match old department names
          </button>
        ) : null}
      </div>

      {notice ? <p className="ow-feedback" role="status">{notice}</p> : null}
      {error ? <p className="ow-error" role="alert">{error}</p> : null}
      {!canManage ? (
        <p className="ow-muted">You can view departments and teams. Editing needs organization management access.</p>
      ) : null}

      {pane === "departments" ? (
        loading ? <p className="ow-muted">Loading departments…</p> : visibleDepartments.length === 0 ? (
          <div className="ow-empty"><p>{departments.length === 0 ? "No departments yet." : "No departments match this search."}</p></div>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Employees</th>
                  <th>Status</th>
                  {canManage ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleDepartments.map((department) => (
                  <tr key={department.id}>
                    <td><strong>{department.name}</strong></td>
                    <td>{department.code || "—"}</td>
                    <td>{department.description || "—"}</td>
                    <td>{department.employeeCount ?? 0}</td>
                    <td>{department.isActive ? "Active" : "Inactive"}</td>
                    {canManage ? (
                      <td className="ow-row-actions">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => {
                            setFormError("");
                            setDepartmentForm({
                              id: department.id,
                              name: department.name || "",
                              code: department.code || "",
                              description: department.description || "",
                            });
                          }}
                        >
                          Edit
                        </button>
                        {department.isActive ? (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => { setFormError(""); setConfirm({ type: "department", id: department.id, name: department.name }); }}
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : teamsDisabled ? (
        <div className="ow-empty"><p>Teams are not available for this company.</p></div>
      ) : loading ? <p className="ow-muted">Loading teams…</p> : visibleTeams.length === 0 ? (
        <div className="ow-empty"><p>{teams.length === 0 ? "No teams yet." : "No teams match this search."}</p></div>
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Department</th>
                <th>Team lead</th>
                <th>Members</th>
                <th>Status</th>
                {canManage ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleTeams.map((team) => (
                <tr key={team.id}>
                  <td><strong>{team.name}</strong></td>
                  <td>{team.department || "—"}</td>
                  <td>{team.lead?.fullName || team.inactiveLead?.fullName || "—"}</td>
                  <td>{team.memberCount ?? team.members?.length ?? 0}</td>
                  <td>{team.isActive === false ? "Inactive" : "Active"}</td>
                  {canManage ? (
                    <td className="ow-row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          setFormError("");
                          setInactiveMembers(team.inactiveMembers || []);
                          setTeamForm({
                            id: team.id,
                            name: team.name || "",
                            department: team.department || "",
                            leadEmployeeId: team.lead?.id || "",
                            leadRecord: teamPersonRecord(team.lead),
                            memberEmployeeIds: (team.members || []).map((member) => member.id),
                            memberRecords: (team.members || []).map(teamPersonRecord).filter(Boolean),
                          });
                        }}
                      >
                        Edit
                      </button>
                      {team.isActive !== false ? (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => { setFormError(""); setConfirm({ type: "team", id: team.id, name: team.name }); }}
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AppModal
        open={Boolean(departmentForm)}
        onClose={() => { if (!saving) setDepartmentForm(null); }}
        title={departmentForm?.id ? "Edit department" : "New department"}
        subtitle={departmentForm?.id ? "Renaming updates people and teams that use this department." : "Each department name can be used once."}
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDepartmentForm(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="department-form" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save department"}</button>
          </>
        }
      >
        {departmentForm ? (
          <form id="department-form" onSubmit={saveDepartment} className="ow-form">
            {formError ? <p className="ow-error" role="alert">{formError}</p> : null}
            <label>
              Name
              <input value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} required maxLength={200} />
            </label>
            <label>
              Code
              <input value={departmentForm.code} onChange={(event) => setDepartmentForm({ ...departmentForm, code: event.target.value })} maxLength={50} />
            </label>
            <label>
              Description
              <textarea value={departmentForm.description} onChange={(event) => setDepartmentForm({ ...departmentForm, description: event.target.value })} maxLength={1000} rows={3} />
            </label>
          </form>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(teamForm)}
        onClose={() => { if (!saving) setTeamForm(null); }}
        title={teamForm?.id ? "Edit team" : "New team"}
        subtitle="Choose a team lead and members. Only active people in your access can be added."
        locked={saving}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setTeamForm(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="team-form" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save team"}</button>
          </>
        }
      >
        {teamForm ? (
          <form id="team-form" onSubmit={saveTeam} className="ow-form">
            {formError ? <p className="ow-error" role="alert">{formError}</p> : null}
            <label>
              Team name
              <input value={teamForm.name} onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} required maxLength={200} />
            </label>
            <label>
              Department
              <input
                value={teamForm.department}
                list="team-department-names"
                onChange={(event) => setTeamForm({ ...teamForm, department: event.target.value })}
                maxLength={200}
              />
              <datalist id="team-department-names">
                {departments.filter((department) => department.isActive).map((department) => (
                  <option key={department.id} value={department.name} />
                ))}
              </datalist>
            </label>
            <EmployeePicker
              mode="single"
              label="Team lead"
              description="Search by name or employee ID."
              value={teamForm.leadEmployeeId ? [teamForm.leadEmployeeId] : []}
              selectedRecords={teamForm.leadRecord ? [teamForm.leadRecord] : []}
              allowClear
              clearLabel="No team lead"
              disabled={saving}
              onChange={(ids, records) => setTeamForm((current) => ({
                ...current,
                leadEmployeeId: ids[0] || "",
                leadRecord: records[0] || null,
              }))}
            />
            <EmployeePicker
              mode="multiple"
              label="Members"
              description="Search to add people. Selected members stay listed."
              value={teamForm.memberEmployeeIds}
              selectedRecords={teamForm.memberRecords}
              disabled={saving}
              onChange={(ids, records) => setTeamForm((current) => ({
                ...current,
                memberEmployeeIds: ids,
                memberRecords: records,
              }))}
            />
            {inactiveMembers.length > 0 ? (
              <p className="ow-muted">
                Inactive members cannot be added again: {inactiveMembers.map((member) => member.fullName).filter(Boolean).join(", ")}. Saving keeps the active people selected above.
              </p>
            ) : null}
          </form>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(confirm)}
        onClose={() => { if (!saving) setConfirm(null); }}
        title={confirm?.type === "backfill" ? "Match old department names" : `Deactivate ${confirm?.name || "this record"}`}
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)} disabled={saving}>Cancel</button>
            <button type="button" className={confirm?.type === "backfill" ? "btn-primary" : "btn-danger"} onClick={runConfirm} disabled={saving}>
              {saving ? "Working…" : confirm?.type === "backfill" ? "Match names" : "Deactivate"}
            </button>
          </>
        }
      >
        {formError ? <p className="ow-error" role="alert">{formError}</p> : null}
        {confirm?.type === "backfill" ? (
          <p>
            This creates departments from existing employee department names and links people who do not
            already have one. Blank names are skipped, and existing links stay as they are.
          </p>
        ) : confirm?.type === "department" ? (
          <p>This department will be hidden from new assignments. People already in it stay there.</p>
        ) : (
          <p>This team will be hidden from active lists. Its lead and members stay on record.</p>
        )}
      </AppModal>
    </section>
  );
}
