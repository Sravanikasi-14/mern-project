import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import platformApi from "../../services/platformApi";
import {
  PaAlert,
  PaEmptyState,
  PaErrorState,
  PaLoadingState,
  PaPageHeader,
  PaStatusBadge,
  formatPaDate,
} from "../../components/platform/paUi";

export default function PlatformCompanies() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    timezone: "Asia/Kolkata",
    currencyCode: "INR",
    primaryContact: { fullName: "", email: "", phoneNumber: "" },
    subscription: { plan: "TRIAL", maxEmployeeSeats: 10 },
    status: "TRIAL",
  });
  const [formError, setFormError] = useState("");

  const queryKey = useMemo(
    () => ["platform", "companies", { search, status, page }],
    [search, status, page]
  );

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await platformApi.get("/platform/companies", {
          params: { search: search || undefined, status: status || undefined, page, limit: 20 },
        })
      ).data,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => (await platformApi.post("/platform/companies", payload)).data,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["platform", "companies"] });
      qc.invalidateQueries({ queryKey: ["platform", "overview"] });
      setShowCreate(false);
      navigate(`/platform/companies/${result.company.id}`);
    },
    onError: (err) => {
      setFormError(err?.response?.data?.message || "Unable to create company.");
    },
  });

  const onCreate = (e) => {
    e.preventDefault();
    setFormError("");
    createMutation.mutate(form);
  };

  const companies = data?.companies || [];

  return (
    <div>
      <PaPageHeader
        title="Companies"
        description="Register tenants, review approved metadata, and manage activation without accessing HR data."
        actions={
          <button type="button" className="pa-btn pa-btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} strokeWidth={2} /> Register company
          </button>
        }
      />

      <div className="pa-toolbar">
        <input
          className="pa-input"
          placeholder="Search name, code, contact email"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          aria-label="Search companies"
        />
        <select
          className="pa-select"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="TRIAL">Trial</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {showCreate ? (
        <div className="pa-panel">
          <div className="pa-panel-head">
            <h2>Register company</h2>
            <p className="pa-panel-desc">Creates central metadata and provisions the tenant database.</p>
          </div>
          {formError ? <PaAlert tone="error">{formError}</PaAlert> : null}
          <form onSubmit={onCreate}>
            <div className="pa-form-grid">
              <div className="pa-field">
                <label htmlFor="pa-co-name">Company name</label>
                <input
                  id="pa-co-name"
                  required
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-slug">Company code (slug)</label>
                <input
                  id="pa-co-slug"
                  required
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-tz">Timezone</label>
                <input
                  id="pa-co-tz"
                  value={form.timezone}
                  onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-cur">Currency</label>
                <input
                  id="pa-co-cur"
                  value={form.currencyCode}
                  onChange={(e) => setForm((f) => ({ ...f, currencyCode: e.target.value }))}
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-contact">Primary contact name</label>
                <input
                  id="pa-co-contact"
                  value={form.primaryContact.fullName}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      primaryContact: { ...f.primaryContact, fullName: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-email">Primary contact email</label>
                <input
                  id="pa-co-email"
                  type="email"
                  value={form.primaryContact.email}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      primaryContact: { ...f.primaryContact, email: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-plan">Plan</label>
                <input
                  id="pa-co-plan"
                  value={form.subscription.plan}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      subscription: { ...f.subscription, plan: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field">
                <label htmlFor="pa-co-seats">Max employee seats</label>
                <input
                  id="pa-co-seats"
                  type="number"
                  min={1}
                  value={form.subscription.maxEmployeeSeats}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      subscription: {
                        ...f.subscription,
                        maxEmployeeSeats: Number(e.target.value),
                      },
                    }))
                  }
                />
              </div>
            </div>
            <div className="pa-toolbar">
              <button className="pa-btn pa-btn-primary" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create & provision"}
              </button>
              <button
                className="pa-btn pa-btn-secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="pa-panel">
        <div className="pa-panel-head">
          <h2>Company registry</h2>
          <p className="pa-panel-desc">
            {data?.pagination?.total != null
              ? `${data.pagination.total} compan${data.pagination.total === 1 ? "y" : "ies"} in central database`
              : "Central company metadata"}
          </p>
        </div>
        {isLoading ? <PaLoadingState title="Loading companies" /> : null}
        {error ? (
          <PaErrorState message={error?.response?.data?.message || "Failed to load companies."} />
        ) : null}
        {!isLoading && !error ? (
          <>
            {companies.length === 0 ? (
              <PaEmptyState
                title="No companies match this filter"
                message="Try clearing search or status filters, or register a new company."
              />
            ) : (
              <div className="pa-table-wrap">
                <table className="pa-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Plan</th>
                      <th>Provisioning</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link className="pa-link" to={`/platform/companies/${c.id}`}>
                            {c.companyName}
                          </Link>
                          <div className="pa-entity-meta">{c.slug}</div>
                        </td>
                        <td>
                          <PaStatusBadge status={c.status} />
                        </td>
                        <td>{c.subscription?.plan || "—"}</td>
                        <td>
                          <PaStatusBadge status={c.provisioning?.lastStatus || "UNKNOWN"} />
                        </td>
                        <td>{formatPaDate(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pa-toolbar is-between" style={{ marginTop: 14, marginBottom: 0 }}>
              <button
                type="button"
                className="pa-btn pa-btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="pa-muted">
                Page {data?.pagination?.page || page} of {data?.pagination?.totalPages || 1}
              </span>
              <button
                type="button"
                className="pa-btn pa-btn-secondary"
                disabled={page >= (data?.pagination?.totalPages || 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
