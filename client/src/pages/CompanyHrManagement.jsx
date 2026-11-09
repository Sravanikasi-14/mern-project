import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  UserPlus,
  RefreshCw,
} from "lucide-react";
import AppHeader from "../components/AppHeader";
import AppModal from "../components/AppModal";
import CompanyHrAccessModal from "../components/CompanyHrAccessModal";
import PortalEmploymentProfileForm from "../components/PortalEmploymentProfileForm";
import ModuleToolbar from "../components/ModuleToolbar";
import Pagination from "../components/Pagination";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  useCompanyHrAdminsQuery,
  useCompanyHrAccessEnforcementQuery,
} from "../hooks/useCompanyAdminQueries";
import { invalidateCompanyHrAdmins, qk } from "../lib/queryKeys";
import api from "../services/api";
import {
  hrAdminActionAvailability,
  resolveHrManagementListState,
  validateHrInviteForm,
} from "../utils/companyHrManagementView";
import "./PeopleManagement.css";

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

const EMPTY_INVITE = { fullName: "", email: "" };

export default function CompanyHrManagement() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [invitationFilter, setInvitationFilter] = useState("ALL");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [inviteErrors, setInviteErrors] = useState({});
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [detailAdmin, setDetailAdmin] = useState(null);
  const [profileAdmin, setProfileAdmin] = useState(null);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [accessAdmin, setAccessAdmin] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const listQuery = useCompanyHrAdminsQuery({
    page,
    limit: pageSize,
    search,
    status: statusFilter,
    invitationStatus: invitationFilter,
  });
  const enforcementQuery = useCompanyHrAccessEnforcementQuery();
  const [enforcementBusy, setEnforcementBusy] = useState(false);

  const viewState = resolveHrManagementListState({
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    data: listQuery.data,
    error: listQuery.error,
  });

  const items = listQuery.data?.items || [];
  const summary = listQuery.data?.summary || {
    total: 0,
    active: 0,
    inactive: 0,
    pendingInvitations: 0,
  };
  const pagination = listQuery.data?.pagination || {
    page: 1,
    limit: pageSize,
    total: 0,
    totalPages: 1,
  };

  const filterCount = useMemo(() => {
    let n = 0;
    if (statusFilter !== "ALL") n += 1;
    if (invitationFilter !== "ALL") n += 1;
    return n;
  }, [statusFilter, invitationFilter]);

  const clearFilters = () => {
    setStatusFilter("ALL");
    setInvitationFilter("ALL");
    setPage(1);
  };

  const refreshLists = () => {
    invalidateCompanyHrAdmins(queryClient);
    queryClient.invalidateQueries({ queryKey: qk.companyHrAccessEnforcement() });
  };

  const bootstrapLegacyAccess = async () => {
    setEnforcementBusy(true);
    setErrorMsg("");
    try {
      const res = await api.post("/company-admin/hr-access/bootstrap-legacy", {});
      await refreshLists();
      await enforcementQuery.refetch();
      const bootstrapped = (res.data?.results || []).filter((r) => r.status === "bootstrapped").length;
      showSuccess(
        bootstrapped > 0
          ? `Legacy access applied to ${bootstrapped} HR Admin(s). Enforcement is still off until you enable it.`
          : "All HR Admins already have access configured."
      );
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || "Bootstrap failed.");
    } finally {
      setEnforcementBusy(false);
    }
  };

  const setEnforcementMode = async (mode) => {
    setEnforcementBusy(true);
    setErrorMsg("");
    try {
      await api.put("/company-admin/hr-access/enforcement", {
        mode,
        reason: mode === "ENFORCED" ? "Enabled from HR Management" : "Disabled from HR Management",
      });
      await enforcementQuery.refetch();
      showSuccess(
        mode === "ENFORCED"
          ? "HR Admin access enforcement is now active for this company."
          : "HR Admin access enforcement is off. Legacy unrestricted HR access applies."
      );
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || "Could not update enforcement.");
    } finally {
      setEnforcementBusy(false);
    }
  };

  const showSuccess = (msg) => {
    setErrorMsg("");
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 4000);
  };

  const openInvite = () => {
    setInviteForm(EMPTY_INVITE);
    setInviteErrors({});
    setInviteResult(null);
    setCopiedLink(false);
    setInviteOpen(true);
  };

  const closeInvite = () => {
    if (inviteSubmitting) return;
    setInviteOpen(false);
    setInviteResult(null);
  };

  const submitInvite = async (event) => {
    event.preventDefault();
    const validated = validateHrInviteForm(inviteForm);
    setInviteErrors(validated.errors);
    if (!validated.valid) return;

    setInviteSubmitting(true);
    setErrorMsg("");
    try {
      const res = await api.post("/company-admin/hr-admins/invite", validated.values);
      setInviteResult(res.data);
      await refreshLists();
      showSuccess(
        res.data.emailSent
          ? "Invitation sent successfully."
          : "HR Admin created. Invitation email could not be delivered — copy the link below."
      );
    } catch (err) {
      const fieldErrors = err.response?.data?.errors;
      if (fieldErrors) setInviteErrors(fieldErrors);
      setErrorMsg(err.response?.data?.message || err.message || "Invitation failed.");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    setActionBusy(true);
    setErrorMsg("");
    try {
      const { type, hrAdmin } = confirmAction;
      const id = hrAdmin.id;
      if (type === "resend") {
        const res = await api.post(`/company-admin/hr-admins/${id}/resend`);
        showSuccess(res.data.emailSent ? "Invitation resent." : "Invitation regenerated. Email delivery failed.");
        if (!res.data.emailSent && res.data.inviteLink) {
          setInviteResult(res.data);
          setInviteOpen(true);
        }
      } else if (type === "revoke") {
        await api.post(`/company-admin/hr-admins/${id}/revoke`);
        showSuccess("Invitation revoked.");
      } else if (type === "deactivate") {
        await api.post(`/company-admin/hr-admins/${id}/deactivate`);
        showSuccess("HR Admin deactivated.");
      } else if (type === "activate") {
        await api.post(`/company-admin/hr-admins/${id}/activate`);
        showSuccess("HR Admin activated.");
      }
      setConfirmAction(null);
      setDetailAdmin(null);
      await refreshLists();
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || "Action failed.");
    } finally {
      setActionBusy(false);
      setMenuOpenId(null);
    }
  };

  const confirmCopy = {
    resend: {
      title: "Resend invitation?",
      body: "A new invitation link will be issued and the previous link will stop working.",
      confirmLabel: "Resend",
    },
    revoke: {
      title: "Revoke invitation?",
      body: "The invitee will no longer be able to activate this account with the current link.",
      confirmLabel: "Revoke",
    },
    deactivate: {
      title: "Deactivate HR Admin?",
      body: "They will lose access to HRMS immediately. Historical records are kept.",
      confirmLabel: "Deactivate",
    },
    activate: {
      title: "Activate HR Admin?",
      body: "This restores login access for a previously deactivated HR Admin account.",
      confirmLabel: "Activate",
    },
  };

  return (
    <div className="pm-container" style={{ padding: "24px 28px 48px" }}>
      <AppHeader
        title="HR Management"
        subtitle="Invite and manage HR Admin accounts for your company"
        hideLogout
        actions={<SoftRefresh active={listQuery.isFetching && !listQuery.isLoading} />}
        nav={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => listQuery.refetch()}
              disabled={listQuery.isFetching}
            >
              <RefreshCw size={16} strokeWidth={2} />
              Refresh
            </button>
            <button type="button" className="btn-primary" onClick={openInvite}>
              <UserPlus size={16} strokeWidth={2} />
              Invite HR Admin
            </button>
          </div>
        }
      />

      {enforcementQuery.data ? (
        <div
          className="pm-inline-notice"
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(15, 23, 42, 0.04)",
            border: "1px solid rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 220, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Access enforcement: {enforcementQuery.data.enforcement?.mode || "OFF"}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>
              {enforcementQuery.data.totals?.activeUnconfigured > 0
                ? `${enforcementQuery.data.totals.activeUnconfigured} active HR Admin(s) still need access configuration before enforcement can be enabled.`
                : enforcementQuery.data.enforcement?.mode === "ENFORCED"
                  ? "Module permissions and employee scope are enforced on HR Admin APIs."
                  : "Configure each HR Admin, optionally bootstrap legacy full access, then enable enforcement when ready."}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={enforcementBusy}
              onClick={bootstrapLegacyAccess}
            >
              Bootstrap legacy access
            </button>
            {enforcementQuery.data.enforcement?.mode === "ENFORCED" ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={enforcementBusy}
                onClick={() => setEnforcementMode("OFF")}
              >
                Turn enforcement off
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={enforcementBusy || !enforcementQuery.data.enforcement?.canEnable}
                onClick={() => setEnforcementMode("ENFORCED")}
                title={
                  enforcementQuery.data.enforcement?.canEnable
                    ? "Enable enforcement"
                    : enforcementQuery.data.enforcement?.blockingReason || "Configure all active HR Admins first"
                }
              >
                Enable enforcement
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="dept-chip-row" role="tablist" aria-label="HR Admin summary">
        <button
          type="button"
          className={`dept-chip ${statusFilter === "ALL" && invitationFilter === "ALL" ? "is-selected" : ""}`}
          onClick={() => {
            clearFilters();
          }}
        >
          All <strong>{summary.total}</strong>
        </button>
        <button
          type="button"
          className={`dept-chip ${statusFilter === "ACTIVE" ? "is-selected" : ""}`}
          onClick={() => {
            setStatusFilter("ACTIVE");
            setInvitationFilter("ALL");
            setPage(1);
          }}
        >
          Active <strong>{summary.active}</strong>
        </button>
        <button
          type="button"
          className={`dept-chip ${invitationFilter === "PENDING" ? "is-selected" : ""}`}
          onClick={() => {
            setInvitationFilter("PENDING");
            setStatusFilter("ALL");
            setPage(1);
          }}
        >
          Pending invites <strong>{summary.pendingInvitations}</strong>
        </button>
        <button
          type="button"
          className={`dept-chip ${statusFilter === "INACTIVE" ? "is-selected" : ""}`}
          onClick={() => {
            setStatusFilter("INACTIVE");
            setInvitationFilter("ALL");
            setPage(1);
          }}
        >
          Inactive <strong>{summary.inactive}</strong>
        </button>
      </div>

      <ModuleToolbar
        searchValue={search}
        onSearchChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        searchPlaceholder="Search by name or email"
        searchAriaLabel="Search HR Admins"
        filterCount={filterCount}
        onFiltersClear={clearFilters}
        filters={
          <>
            <label>
              Account status
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="filter-select"
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label>
              Invitation
              <select
                value={invitationFilter}
                onChange={(e) => {
                  setInvitationFilter(e.target.value);
                  setPage(1);
                }}
                className="filter-select"
              >
                <option value="ALL">All invitations</option>
                <option value="PENDING">Pending</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="EXPIRED">Expired</option>
                <option value="REVOKED">Revoked</option>
              </select>
            </label>
          </>
        }
      />

      {successMsg ? <div className="success-alert">{successMsg}</div> : null}
      {errorMsg ? <div className="error" role="alert">{errorMsg}</div> : null}

      <div className="pm-results-meta">
        {pagination.total} HR Admin{pagination.total === 1 ? "" : "s"}
      </div>

      {viewState.state === "error" ? (
        <div className="pm-empty-box" role="alert">
          <p>{viewState.message}</p>
          <button type="button" className="btn-secondary" onClick={() => listQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="data-table-container table-wrapper-relative">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Account</th>
                <th>Invitation</th>
                <th>Access</th>
                <th>Invited</th>
                <th>Last login</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {viewState.state === "loading" ? (
                <TableSkeletonRows rows={8} cols={8} />
              ) : viewState.state === "empty" ? (
                <tr>
                  <td colSpan={8}>
                    <div className="pm-empty-box">
                      <p>No HR Admin accounts yet.</p>
                      <button type="button" className="btn-primary" onClick={openInvite}>
                        Invite HR Admin
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((hr) => {
                  const actions = hrAdminActionAvailability(hr);
                  return (
                    <tr key={hr.id}>
                      <td>
                        <strong>{hr.fullName || "—"}</strong>
                        <div style={{ color: "var(--muted, #5c6b62)", fontSize: 12 }}>
                          {hr.employeeProfile?.employeeCode || "No employee profile"}
                        </div>
                      </td>
                      <td>{hr.email}</td>
                      <td>
                        <StatusBadge status={hr.accountStatus} />
                      </td>
                      <td>
                        {hr.invitationStatus ? (
                          <StatusBadge status={hr.invitationStatus} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {hr.accessConfigured ? (
                          <StatusBadge
                            status="ACTIVE"
                            label={hr.accessSummary?.scopeLabel || "Configured"}
                          />
                        ) : (
                          <StatusBadge status="PENDING" label="Not configured" />
                        )}
                      </td>
                      <td>{formatDate(hr.invitedAt)}</td>
                      <td>{formatWhen(hr.lastLoginAt)}</td>
                      <td>
                        <div className="row-actions" style={{ position: "relative", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setProfileAdmin(hr);
                              setProfileError("");
                              setMenuOpenId(null);
                            }}
                          >
                            Employment profile
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            aria-label={`Actions for ${hr.fullName || hr.email}`}
                            onClick={() =>
                              setMenuOpenId((id) => (id === hr.id ? null : hr.id))
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {menuOpenId === hr.id ? (
                            <div
                              className="pm-row-menu"
                              style={{
                                position: "absolute",
                                right: 0,
                                top: "100%",
                                zIndex: 40,
                                minWidth: 180,
                                background: "var(--panel, #fff)",
                                border: "1px solid var(--hair, #e6ede8)",
                                borderRadius: 12,
                                boxShadow: "var(--shadow)",
                                padding: 6,
                              }}
                            >
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                onClick={() => {
                                  setDetailAdmin(hr);
                                  setMenuOpenId(null);
                                }}
                              >
                                View details
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                onClick={() => {
                                  setProfileAdmin(hr);
                                  setProfileError("");
                                  setMenuOpenId(null);
                                }}
                              >
                                Employment profile
                              </button>
                              {hr.employeeProfile?.id ? (
                                <Link
                                  to={`/admin/employees/${hr.employeeProfile.id}`}
                                  className="btn-secondary"
                                  style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                  onClick={() => setMenuOpenId(null)}
                                >
                                  View employee profile
                                </Link>
                              ) : null}
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                onClick={() => {
                                  setAccessAdmin(hr);
                                  setMenuOpenId(null);
                                }}
                              >
                                Configure access
                              </button>
                              {actions.canResend ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                  onClick={() => {
                                    setConfirmAction({ type: "resend", hrAdmin: hr });
                                    setMenuOpenId(null);
                                  }}
                                >
                                  Resend invite
                                </button>
                              ) : null}
                              {actions.canRevoke ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                  onClick={() => {
                                    setConfirmAction({ type: "revoke", hrAdmin: hr });
                                    setMenuOpenId(null);
                                  }}
                                >
                                  Revoke invite
                                </button>
                              ) : null}
                              {actions.canDeactivate ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ width: "100%", justifyContent: "flex-start", marginBottom: 4 }}
                                  onClick={() => {
                                    setConfirmAction({ type: "deactivate", hrAdmin: hr });
                                    setMenuOpenId(null);
                                  }}
                                >
                                  Deactivate
                                </button>
                              ) : null}
                              {actions.canActivate ? (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  style={{ width: "100%", justifyContent: "flex-start" }}
                                  onClick={() => {
                                    setConfirmAction({ type: "activate", hrAdmin: hr });
                                    setMenuOpenId(null);
                                  }}
                                >
                                  Activate
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewState.state === "success" ? (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          totalItems={pagination.total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          itemLabel="HR Admins"
        />
      ) : null}

      <AppModal
        open={inviteOpen}
        onClose={closeInvite}
        title={inviteResult ? "Invitation ready" : "Invite HR Admin"}
        subtitle={
          inviteResult
            ? "Share the activation link if email delivery failed"
            : "Send a secure invitation to set up an HR Admin account"
        }
        size="md"
        locked={inviteSubmitting}
        footer={
          inviteResult ? (
            <button type="button" className="btn-primary" onClick={closeInvite}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={closeInvite} disabled={inviteSubmitting}>
                Cancel
              </button>
              <button
                type="submit"
                form="ca-hr-invite-form"
                className="btn-primary"
                disabled={inviteSubmitting}
              >
                {inviteSubmitting ? "Sending…" : "Send invitation"}
              </button>
            </>
          )
        }
      >
        {inviteResult ? (
          <div className="auth-form">
            <p style={{ marginTop: 0 }}>
              Invited <strong>{inviteResult.hrAdmin?.fullName}</strong> ({inviteResult.hrAdmin?.email}).
            </p>
            {inviteResult.inviteLink ? (
              <div className="form-group">
                <label>Activation link</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="form-input"
                    readOnly
                    value={inviteResult.inviteLink}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteResult.inviteLink);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2500);
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    {copiedLink ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}
            <StatusBadge
              status={inviteResult.emailSent ? "SENT" : "DELIVERY_FAILED"}
              label={inviteResult.emailSent ? "Email sent" : "Email not sent"}
            />
          </div>
        ) : (
          <form id="ca-hr-invite-form" className="auth-form" onSubmit={submitInvite}>
            <div className="form-group">
              <label htmlFor="ca-hr-name">Full name</label>
              <input
                id="ca-hr-name"
                className={`form-input${inviteErrors.fullName ? " has-error" : ""}`}
                value={inviteForm.fullName}
                onChange={(e) =>
                  setInviteForm((prev) => ({ ...prev, fullName: e.target.value }))
                }
                autoComplete="name"
              />
              {inviteErrors.fullName ? (
                <p className="field-error">{inviteErrors.fullName}</p>
              ) : null}
            </div>
            <div className="form-group">
              <label htmlFor="ca-hr-email">Work email</label>
              <input
                id="ca-hr-email"
                type="email"
                className={`form-input${inviteErrors.email ? " has-error" : ""}`}
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((prev) => ({ ...prev, email: e.target.value }))
                }
                autoComplete="email"
              />
              {inviteErrors.email ? (
                <p className="field-error">{inviteErrors.email}</p>
              ) : null}
            </div>
          </form>
        )}
      </AppModal>

      <AppModal
        open={Boolean(detailAdmin)}
        onClose={() => setDetailAdmin(null)}
        title="HR Admin details"
        size="md"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setDetailAdmin(null)}>
            Close
          </button>
        }
      >
        {detailAdmin ? (
          <dl className="auth-form" style={{ margin: 0 }}>
            <div className="form-group">
              <label>Name</label>
              <p style={{ margin: 0 }}>{detailAdmin.fullName || "—"}</p>
            </div>
            <div className="form-group">
              <label>Email</label>
              <p style={{ margin: 0 }}>{detailAdmin.email}</p>
            </div>
            <div className="form-group">
              <label>Account status</label>
              <StatusBadge status={detailAdmin.accountStatus} />
            </div>
            <div className="form-group">
              <label>Invitation status</label>
              {detailAdmin.invitationStatus ? (
                <StatusBadge status={detailAdmin.invitationStatus} />
              ) : (
                <p style={{ margin: 0 }}>—</p>
              )}
            </div>
            <div className="form-group">
              <label>Invited</label>
              <p style={{ margin: 0 }}>{formatWhen(detailAdmin.invitedAt)}</p>
            </div>
            <div className="form-group">
              <label>Last login</label>
              <p style={{ margin: 0 }}>{formatWhen(detailAdmin.lastLoginAt)}</p>
            </div>
            <div className="form-group">
              <label>Employee profile</label>
              {detailAdmin.employeeProfile ? (
                <p style={{ margin: 0 }}>
                  {detailAdmin.employeeProfile.employeeCode}
                  {detailAdmin.employeeProfile.jobTitle
                    ? ` · ${detailAdmin.employeeProfile.jobTitle}`
                    : ""}
                  {detailAdmin.employeeProfile.department
                    ? ` · ${detailAdmin.employeeProfile.department}`
                    : ""}
                  {" · "}
                  <Link to={`/admin/employees/${detailAdmin.employeeProfile.id}`}>
                    View employee profile
                  </Link>
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  No employee profile yet. It is created when the invitation is accepted, or when
                  you save employment details.
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Access configuration</label>
              {detailAdmin.accessConfigured ? (
                <StatusBadge
                  status="ACTIVE"
                  label={detailAdmin.accessSummary?.scopeLabel || "Configured"}
                />
              ) : (
                <StatusBadge status="PENDING" label="Not configured" />
              )}
            </div>
          </dl>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(profileAdmin)}
        onClose={() => {
          if (profileSubmitting) return;
          setProfileAdmin(null);
          setProfileError("");
        }}
        title="Employment profile"
        subtitle={profileAdmin ? profileAdmin.fullName || profileAdmin.email : ""}
        size="md"
        locked={profileSubmitting}
      >
        {profileAdmin ? (
          <PortalEmploymentProfileForm
            loginEmail={profileAdmin.email}
            roleLabel="HR Admin"
            fallbackName={profileAdmin.fullName}
            initialProfile={profileAdmin.employeeProfile}
            excludeEmployeeId={profileAdmin.employeeProfile?.id || null}
            submitting={profileSubmitting}
            error={profileError}
            onSubmit={async (payload) => {
              setProfileSubmitting(true);
              setProfileError("");
              try {
                await api.put(
                  `/company-admin/hr-admins/${profileAdmin.id}/employee-profile`,
                  payload
                );
                setProfileAdmin(null);
                showSuccess("Employment profile saved. The HR Admin login was not changed.");
                refreshLists();
              } catch (err) {
                setProfileError(
                  err.response?.data?.message || "The employment profile could not be saved."
                );
              } finally {
                setProfileSubmitting(false);
              }
            }}
          />
        ) : null}
      </AppModal>

      <CompanyHrAccessModal
        open={Boolean(accessAdmin)}
        hrAdmin={accessAdmin}
        onClose={() => setAccessAdmin(null)}
        onSaved={() => {
          showSuccess("HR Admin access configuration saved.");
          refreshLists();
        }}
      />

      <AppModal
        open={Boolean(confirmAction)}
        onClose={() => (!actionBusy ? setConfirmAction(null) : null)}
        title={confirmAction ? confirmCopy[confirmAction.type]?.title : ""}
        size="sm"
        locked={actionBusy}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={actionBusy}
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={actionBusy}
              onClick={runConfirmedAction}
            >
              {actionBusy
                ? "Working…"
                : confirmAction
                  ? confirmCopy[confirmAction.type]?.confirmLabel
                  : "Confirm"}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, color: "var(--muted)" }}>
          {confirmAction ? confirmCopy[confirmAction.type]?.body : null}
          {confirmAction?.hrAdmin?.email ? (
            <>
              {" "}
              <strong>{confirmAction.hrAdmin.fullName || confirmAction.hrAdmin.email}</strong>
            </>
          ) : null}
        </p>
      </AppModal>
    </div>
  );
}
