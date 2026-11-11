import { useMemo, useState } from "react";
import { ChevronRight, Network, Users } from "lucide-react";
import {
  useOrgExplorerTeamQuery,
  useOrgExplorerTeamsQuery,
} from "../../hooks/useOrganizationExplorerQueries";
import AppModal from "../AppModal";
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

function teamMetaLine(item) {
  const bits = [];
  if (item.department) bits.push(item.department);
  if (item.lead?.fullName) bits.push(`Lead: ${item.lead.fullName}`);
  return bits.join(" · ") || "No department";
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

  const selectedSummary = useMemo(
    () => teams.find((t) => String(t.id) === String(selectedId)) || null,
    [teams, selectedId]
  );

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

      <section className="oe-list-panel" aria-label="Teams">
        <div className="oe-list-head" aria-hidden="true">
          <span>Team</span>
          <span>Details</span>
          <span>Members</span>
          <span />
        </div>
        <div className="oe-list-body">
          {teams.length === 0 ? (
            <p className="oe-list-empty">No active teams match your search.</p>
          ) : (
            teams.map((item) => {
              const meta = teamMetaLine(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`oe-list-row${selectedId === item.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span
                    className="oe-list-primary"
                    data-mobile-meta={`${item.memberCount} member${item.memberCount === 1 ? "" : "s"} · ${meta}`}
                  >
                    <span className="oe-list-icon" aria-hidden="true">
                      <Users size={16} />
                    </span>
                    <span className="oe-list-name">{item.name}</span>
                  </span>
                  <span className="oe-list-meta">{meta}</span>
                  <span className="oe-list-count">
                    {item.memberCount} member{item.memberCount === 1 ? "" : "s"}
                  </span>
                  <ChevronRight size={16} className="oe-list-chevron" aria-hidden="true" />
                </button>
              );
            })
          )}
        </div>
      </section>

      <AppModal
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        title={team?.name || selectedSummary?.name || "Team"}
        subtitle="Team lead, members, and information"
        size="lg"
        className="oe-detail-modal"
      >
        {detailQuery.isLoading || (detailQuery.isFetching && !team) ? (
          <div className="org-loading">Loading team…</div>
        ) : detailQuery.isError ? (
          <div className="org-error" role="alert">
            {detailQuery.error?.response?.data?.message || "Failed to load team."}
          </div>
        ) : team ? (
          <>
            <p className="oe-detail-summary">
              <span>
                <strong>{team.memberCount}</strong> member{team.memberCount === 1 ? "" : "s"}
              </span>
              {team.department ? (
                <span>
                  Department: <strong>{team.department}</strong>
                </span>
              ) : null}
            </p>

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
          <p className="oe-list-empty">Team not found.</p>
        )}
      </AppModal>

      <ExplorerVisibleProfileModal
        employeeId={profileId}
        open={Boolean(profileId)}
        onClose={() => setProfileId(null)}
      />
    </div>
  );
}
