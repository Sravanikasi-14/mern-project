import { useMemo, useState } from "react";
import { Network, Users } from "lucide-react";
import {
  useOrgExplorerTeamQuery,
  useOrgExplorerTeamsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import ExplorerEmployeeCard from "./ExplorerEmployeeCard";
import ExplorerGroupSearch from "./ExplorerGroupSearch";
import ExplorerVisibleProfileModal from "./ExplorerVisibleProfileModal";

function matchesTeamSearch(team, q) {
  if (!q) return true;
  const head = `${team.name || ""} ${team.department || ""} ${team.lead?.fullName || ""}`.toLowerCase();
  if (head.includes(q)) return true;
  return (team.members || []).some((emp) => {
    const hay = `${emp.fullName || ""} ${emp.employeeCode || ""} ${emp.jobTitle || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

export default function TeamsView({ mode = "employee" }) {
  const isHr = mode === "hr";
  const overviewQuery = useOrgExplorerTeamsQuery({ includeInactive: false });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [profileId, setProfileId] = useState(null);

  const query = search.trim().toLowerCase();
  const teams = useMemo(() => {
    const list = overviewQuery.data?.teams || [];
    if (!query) return list;
    return list.filter((t) => matchesTeamSearch(t, query));
  }, [overviewQuery.data, query]);

  const detailQuery = useOrgExplorerTeamQuery(selectedId || "", {
    enabled: Boolean(selectedId),
  });
  const team =
    detailQuery.data?.team && String(detailQuery.data.team.id) === String(selectedId)
      ? detailQuery.data.team
      : null;

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return (
      <div className="org-loading">
        <Network size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
        <div>Loading teams…</div>
      </div>
    );
  }

  if (overviewQuery.isError && !overviewQuery.data) {
    return (
      <div className="org-error" role="alert">
        {overviewQuery.error?.response?.data?.message || "Failed to load teams."}{" "}
        <button type="button" className="btn-secondary btn-sm" onClick={() => overviewQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="oe-group-view">
      <div className="oe-group-toolbar">
        <ExplorerGroupSearch
          value={search}
          onChange={setSearch}
          placeholder="Search teams or people…"
          ariaLabel="Search teams"
        />
        <span className="oe-count">
          {teams.length} team{teams.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className={`oe-split${selectedId ? " has-detail" : ""}`}>
        <section className="oe-group-list" aria-label="Teams">
          {teams.length === 0 ? (
            <div className="org-chart-empty">No active teams match your search.</div>
          ) : (
            teams.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`oe-group-card${selectedId === item.id ? " is-selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="oe-group-icon" aria-hidden="true">
                  <Users size={18} />
                </span>
                <span className="oe-group-body">
                  <strong>{item.name}</strong>
                  <span>
                    {item.memberCount} member{item.memberCount === 1 ? "" : "s"}
                    {item.department ? ` · ${item.department}` : ""}
                    {item.lead?.fullName ? ` · Lead: ${item.lead.fullName}` : ""}
                  </span>
                </span>
              </button>
            ))
          )}
        </section>

        <section className="oe-group-detail" aria-label="Team members">
          {!selectedId ? (
            <div className="org-chart-empty">Select a team to view its lead and members.</div>
          ) : detailQuery.isLoading || (detailQuery.isFetching && !team) ? (
            <div className="org-loading">Loading team…</div>
          ) : detailQuery.isError ? (
            <div className="org-error" role="alert">
              {detailQuery.error?.response?.data?.message || "Failed to load team."}
            </div>
          ) : team ? (
            <>
              <div className="oe-detail-head">
                <div>
                  <h2>{team.name}</h2>
                  <p>
                    {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
                    {team.department ? ` · ${team.department}` : ""}
                  </p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedId(null)}>
                  Close
                </button>
              </div>

              {team.lead ? (
                <div className="oe-team-section">
                  <h3>Team lead</h3>
                  <div className="oe-person-grid">
                    <ExplorerEmployeeCard
                      employee={team.lead}
                      selected={profileId === team.lead.id}
                      onSelect={setProfileId}
                    />
                  </div>
                </div>
              ) : (
                <p className="org-side-empty">No active team lead assigned.</p>
              )}

              <div className="oe-team-section">
                <h3>Members</h3>
                {(team.members || []).length === 0 ? (
                  <p className="org-side-empty">No active members.</p>
                ) : (
                  <div className="oe-person-grid">
                    {team.members.map((emp) => (
                      <ExplorerEmployeeCard
                        key={emp.id}
                        employee={emp}
                        selected={profileId === emp.id}
                        onSelect={setProfileId}
                      />
                    ))}
                  </div>
                )}
              </div>

              {isHr && ((team.inactiveMembers || []).length > 0 || team.inactiveLead) ? (
                <div className="oe-team-section oe-team-inactive">
                  <h3>Inactive (historical)</h3>
                  {team.inactiveLead ? (
                    <div className="oe-person-grid" style={{ marginBottom: 10 }}>
                      <ExplorerEmployeeCard
                        employee={team.inactiveLead}
                        selected={profileId === team.inactiveLead.id}
                        onSelect={setProfileId}
                      />
                    </div>
                  ) : null}
                  {(team.inactiveMembers || []).length > 0 ? (
                    <div className="oe-person-grid">
                      {team.inactiveMembers.map((emp) => (
                        <ExplorerEmployeeCard
                          key={emp.id}
                          employee={emp}
                          selected={profileId === emp.id}
                          onSelect={setProfileId}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="org-chart-empty">Team not found.</div>
          )}
        </section>
      </div>

      <ExplorerVisibleProfileModal
        employeeId={profileId}
        open={Boolean(profileId)}
        onClose={() => setProfileId(null)}
      />
    </div>
  );
}
