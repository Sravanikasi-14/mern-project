import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Laptop,
  Monitor,
  MoreVertical,
  Mouse,
  Plus,
  Search,
  Smartphone,
  SlidersHorizontal,
  Keyboard,
  Package,
  CheckCircle2,
} from "lucide-react";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import ProfileAvatar from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const ASSET_PAGE_SIZE = 20;

const CATEGORIES = [
  { value: "LAPTOP", label: "Laptop" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "MONITOR", label: "Monitor" },
  { value: "PHONE_TABLET", label: "Phone / Tablet" },
  { value: "PERIPHERAL", label: "Peripheral" },
  { value: "ACCESS_CARD", label: "Access Card" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "OTHER", label: "Other" },
];

const CONDITIONS = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"];

const STATUS_TABS = [
  { value: "ALL", label: "All Assets" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "AVAILABLE", label: "Available" },
];

const emptyForm = {
  assetTag: "",
  name: "",
  category: "LAPTOP",
  serialNumber: "",
  manufacturer: "",
  modelNumber: "",
  location: "",
  condition: "GOOD",
  notes: "",
};

function categoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value || "Asset";
}

function CategoryIcon({ category }) {
  const props = { size: 22, strokeWidth: 1.85, "aria-hidden": true };
  switch (category) {
    case "MONITOR":
      return <Monitor {...props} />;
    case "PHONE_TABLET":
      return <Smartphone {...props} />;
    case "PERIPHERAL":
      return <Mouse {...props} />;
    case "KEYBOARD":
      return <Keyboard {...props} />;
    case "DESKTOP":
      return <Monitor {...props} />;
    case "LAPTOP":
      return <Laptop {...props} />;
    default:
      return <Package {...props} />;
  }
}

function statusLabel(status) {
  if (status === "UNDER_MAINTENANCE") return "Maintenance";
  if (!status) return "—";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function assigneeLabel(asset) {
  const a = asset?.currentAssignment;
  if (a?.employeeName) {
    return a.employeeCode ? `${a.employeeName} (${a.employeeCode})` : a.employeeName;
  }
  return asset?.location || "Unassigned";
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function HrAssetsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    available: 0,
    assigned: 0,
    underMaintenance: 0,
    retired: 0,
    lost: 0,
  });
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [tab, setTab] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState(null); // detail | assign | return | edit | add | filter
  const [detailLoading, setDetailLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [assigneeId, setAssigneeId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [returnCondition, setReturnCondition] = useState("GOOD");
  const [returnNotes, setReturnNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const params = { page, limit: ASSET_PAGE_SIZE };
      if (tab !== "ALL") params.status = tab;
      if (categoryFilter !== "ALL") params.category = categoryFilter;
      if (search.trim()) params.search = search.trim();

      const [assetsRes, peopleRes] = await Promise.all([
        api.get("/assets", { params }),
        api.get("/employees", { params: { page: 1, limit: 200, status: "ACTIVE" } }).catch(() => null),
      ]);

      const list = assetsRes.data?.assets || assetsRes.data?.data || [];
      setItems(list);
      const pagination = assetsRes.data?.pagination || {};
      setTotalItems(pagination.total ?? pagination.totalMatched ?? list.length);
      setTotalPages(pagination.totalPages ?? 1);
      if (assetsRes.data?.summary) setSummary(assetsRes.data.summary);
      setPeople(peopleRes?.data?.employees || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load assets.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [tab, categoryFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, search ? 280 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categoryFilter, search, page]);

  const trackedPct = useMemo(() => {
    const total = summary.total || 0;
    if (!total) return 0;
    const tracked = summary.available + summary.assigned + summary.underMaintenance;
    return Math.round((tracked / total) * 1000) / 10;
  }, [summary]);

  const barParts = useMemo(() => {
    const total = Math.max(summary.total, 1);
    return {
      assigned: (summary.assigned / total) * 100,
      available: (summary.available / total) * 100,
      maintenance: (summary.underMaintenance / total) * 100,
    };
  }, [summary]);

  const openDetails = async (asset) => {
    setSelected(asset);
    setPanel("detail");
    setDetailLoading(true);
    try {
      const res = await api.get(`/assets/${asset._id}`);
      setSelected(res.data?.asset || asset);
    } catch {
      setSelected(asset);
    } finally {
      setDetailLoading(false);
    }
  };

  const validateCreate = () => {
    const errors = {};
    if (!form.assetTag.trim()) errors.assetTag = "Asset tag is required.";
    if (!form.name.trim()) errors.name = "Asset name is required.";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const createAsset = async (event) => {
    event.preventDefault();
    if (!validateCreate() || busy) return;
    try {
      setBusy(true);
      setError("");
      await api.post("/assets", {
        assetTag: form.assetTag.trim(),
        name: form.name.trim(),
        category: form.category,
        serialNumber: form.serialNumber.trim(),
        manufacturer: form.manufacturer.trim(),
        modelNumber: form.modelNumber.trim(),
        location: form.location.trim(),
        condition: form.condition,
        notes: form.notes.trim(),
        status: "AVAILABLE",
      });
      toast.push("Asset added.");
      setPanel(null);
      setForm(emptyForm);
      setFormErrors({});
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not add this asset.");
    } finally {
      setBusy(false);
    }
  };

  const updateAsset = async (event) => {
    event.preventDefault();
    if (!selected?._id || busy) return;
    try {
      setBusy(true);
      setError("");
      const res = await api.put(`/assets/${selected._id}`, {
        name: form.name.trim(),
        category: form.category,
        serialNumber: form.serialNumber.trim(),
        manufacturer: form.manufacturer.trim(),
        modelNumber: form.modelNumber.trim(),
        location: form.location.trim(),
        condition: form.condition,
        notes: form.notes.trim(),
      });
      toast.push("Asset updated.");
      setSelected(res.data?.asset || selected);
      setPanel("detail");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update this asset.");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    if (!selected) return;
    setForm({
      assetTag: selected.assetTag || "",
      name: selected.name || "",
      category: selected.category || "LAPTOP",
      serialNumber: selected.serialNumber || "",
      manufacturer: selected.manufacturer || "",
      modelNumber: selected.modelNumber || "",
      location: selected.location || "",
      condition: selected.condition || "GOOD",
      notes: selected.notes || "",
    });
    setPanel("edit");
  };

  const assign = async (event) => {
    event.preventDefault();
    if (!selected?._id || !assigneeId || busy) return;
    try {
      setBusy(true);
      setError("");
      const res = await api.post(`/assets/${selected._id}/assign`, {
        employeeId: assigneeId,
        notes: assignNotes.trim(),
      });
      toast.push(res.data?.message || "Asset assigned.");
      setAssigneeId("");
      setAssignNotes("");
      setSelected(res.data?.asset || selected);
      setPanel("detail");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not assign this asset.");
    } finally {
      setBusy(false);
    }
  };

  const returnAsset = async () => {
    if (!selected?._id || busy) return;
    try {
      setBusy(true);
      setError("");
      const res = await api.post(`/assets/${selected._id}/return`, {
        conditionAtReturn: returnCondition,
        returnNotes: returnNotes.trim(),
      });
      toast.push(res.data?.message || "Asset returned.");
      setReturnNotes("");
      setSelected(res.data?.asset || selected);
      setPanel("detail");
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not return this asset.");
    } finally {
      setBusy(false);
    }
  };

  const isAssigned = selected?.status === "ASSIGNED" && selected?.currentAssignment?.employeeId;
  const canAssign = selected && !isAssigned && selected.status === "AVAILABLE";

  const tabCounts = {
    ALL: summary.total,
    ASSIGNED: summary.assigned,
    AVAILABLE: summary.available,
  };

  if (loading && items.length === 0 && !error) {
    return (
      <div className="st-ast">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Company Assets</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  if (error && items.length === 0 && !loading) {
    return (
      <div className="st-ast">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Company Assets</h1>
        </header>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="st-ast">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Company Assets</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <ProfileAvatar name={user?.name || user?.fullName || user?.email || "HR"} size={36} className="hr-portal-avatar" />
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="st-ast-health">
        <div className="st-ast-health-top">
          <span>Asset Inventory Health</span>
          <em>{trackedPct}% Tracked</em>
        </div>
        <div className="st-ast-health-total">
          <strong>{summary.total.toLocaleString()}</strong>
          <span>total devices</span>
          <i>
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            Synced live
          </i>
        </div>
        <div className="st-ast-bar" aria-hidden="true">
          <i className="is-assigned" style={{ width: `${barParts.assigned}%` }} />
          <i className="is-available" style={{ width: `${barParts.available}%` }} />
          <i className="is-maint" style={{ width: `${barParts.maintenance}%` }} />
        </div>
        <div className="st-ast-legend">
          <span>
            <i className="is-assigned" />
            {summary.assigned} Assigned
          </span>
          <span>
            <i className="is-available" />
            {summary.available} Available
          </span>
          <span>
            <i className="is-maint" />
            {summary.underMaintenance} Maintenance
          </span>
        </div>
      </section>

      <div className="st-ast-tabs" role="tablist" aria-label="Asset status">
        {STATUS_TABS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={tab === opt.value}
            className={tab === opt.value ? "is-active" : ""}
            onClick={() => setTab(opt.value)}
          >
            {opt.label}
            <em>{tabCounts[opt.value] ?? 0}</em>
          </button>
        ))}
      </div>

      <div className="st-ast-search-row">
        <div className="st-att-search">
          <Search size={18} strokeWidth={1.85} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by model, tag, or assignee..."
            aria-label="Search assets"
          />
        </div>
        <button
          type="button"
          className={`st-ast-filter-btn${categoryFilter !== "ALL" ? " is-active" : ""}`}
          aria-label="Filter options"
          onClick={() => setPanel("filter")}
        >
          <SlidersHorizontal size={18} strokeWidth={1.85} />
        </button>
      </div>

      <div className="st-pay-list-head">
        <h2>Active Inventory Records</h2>
        <span>
          Showing {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <EmptyState
          message="No assets in this view."
          actionLabel="Add asset"
          onAction={() => {
            setForm(emptyForm);
            setFormErrors({});
            setPanel("add");
          }}
        />
      ) : (
        <div className="st-ast-list">
          {items.map((asset) => {
            const assigned = asset.status === "ASSIGNED";
            return (
              <button
                key={asset._id}
                type="button"
                className="st-ast-card"
                onClick={() => openDetails(asset)}
              >
                <span className="st-ast-ico">
                  <CategoryIcon category={asset.category} />
                </span>
                <span className="st-ast-copy">
                  <strong>
                    {asset.name}
                    {asset.assetTag ? <em>#{asset.assetTag}</em> : null}
                  </strong>
                  <span>
                    {categoryLabel(asset.category)}
                    <i aria-hidden="true">•</i>
                    {assigneeLabel(asset)}
                  </span>
                </span>
                <span className="st-ast-side">
                  <span className={`st-ast-pill is-${(asset.status || "").toLowerCase()}`}>
                    <i />
                    {statusLabel(asset.status)}
                  </span>
                  <span className="st-ast-meta">
                    {assigned
                      ? `Since ${formatDate(asset.currentAssignment?.assignedDate)}`
                      : asset.status === "AVAILABLE"
                        ? "Ready to issue"
                        : statusLabel(asset.status)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={ASSET_PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="assets"
      />

      <div className="st-ast-dock">
        <div className="st-ast-dock-copy">
          <strong>Quick Dispatch</strong>
          <span>Assign or register a device</span>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setForm(emptyForm);
            setFormErrors({});
            setPanel("add");
          }}
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          Add Asset
        </button>
      </div>

      <Modal
        open={Boolean(panel)}
        onClose={() => setPanel(null)}
        size={panel === "filter" ? "sm" : "md"}
        title={
          panel === "add"
            ? "Add asset"
            : panel === "edit"
              ? "Update asset"
              : panel === "assign"
                ? "Assign asset"
                : panel === "return"
                  ? "Record return"
                  : panel === "filter"
                    ? "Filters"
                    : selected?.name || "Asset"
        }
        footer={
          panel === "detail" ? (
            <>
              <button type="button" className="btn-secondary" onClick={openEdit}>
                Edit
              </button>
              {canAssign ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setAssigneeId("");
                    setAssignNotes("");
                    setPanel("assign");
                  }}
                >
                  Assign
                </button>
              ) : null}
              {isAssigned ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setReturnCondition(selected.condition || "GOOD");
                    setReturnNotes("");
                    setPanel("return");
                  }}
                >
                  Return
                </button>
              ) : null}
            </>
          ) : panel === "add" ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPanel(null)}>
                Cancel
              </button>
              <button type="submit" form="add-asset" className="btn-primary" disabled={busy}>
                {busy ? "Saving..." : "Add asset"}
              </button>
            </>
          ) : panel === "edit" ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPanel("detail")}>
                Back
              </button>
              <button type="submit" form="edit-asset" className="btn-primary" disabled={busy}>
                {busy ? "Saving..." : "Save changes"}
              </button>
            </>
          ) : panel === "assign" ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPanel("detail")}>
                Back
              </button>
              <button type="submit" form="assign-asset" className="btn-primary" disabled={busy || !assigneeId}>
                {busy ? "Saving..." : "Confirm assign"}
              </button>
            </>
          ) : panel === "return" ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPanel("detail")}>
                Back
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={returnAsset}>
                {busy ? "Saving..." : "Confirm return"}
              </button>
            </>
          ) : panel === "filter" ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setCategoryFilter("ALL");
                  setPanel(null);
                }}
              >
                Reset
              </button>
              <button type="button" className="btn-primary" onClick={() => setPanel(null)}>
                Apply
              </button>
            </>
          ) : null
        }
      >
        {panel === "detail" ? (
          detailLoading ? (
            <Skeleton />
          ) : selected ? (
            <div className="st-ast-detail">
              <span className={`st-ast-pill is-${(selected.status || "").toLowerCase()}`}>
                <i />
                {statusLabel(selected.status)}
              </span>
              <div className="st-detail-card" style={{ marginTop: 12 }}>
                <div className="st-detail-row">
                  <span>Asset tag</span>
                  <strong>{selected.assetTag || "—"}</strong>
                </div>
                <div className="st-detail-row">
                  <span>Category</span>
                  <strong>{categoryLabel(selected.category)}</strong>
                </div>
                <div className="st-detail-row">
                  <span>Serial</span>
                  <strong>{selected.serialNumber || "—"}</strong>
                </div>
                <div className="st-detail-row">
                  <span>Condition</span>
                  <strong>{selected.condition || "—"}</strong>
                </div>
                <div className="st-detail-row">
                  <span>Location</span>
                  <strong>{selected.location || "—"}</strong>
                </div>
                <div className="st-detail-row">
                  <span>Assigned to</span>
                  <strong>{assigneeLabel(selected)}</strong>
                </div>
              </div>
              {Array.isArray(selected.assignmentHistory) && selected.assignmentHistory.length > 0 ? (
                <div className="st-ast-history">
                  <h3>Assignment history</h3>
                  <ul>
                    {[...selected.assignmentHistory]
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((h, idx) => (
                        <li key={`${h.employeeId}-${h.assignedDate}-${idx}`}>
                          <strong>{h.employeeName || "Employee"}</strong>
                          <span>
                            {formatDate(h.assignedDate)} → {formatDate(h.returnDate)}
                            {h.conditionAtReturn ? ` · ${h.conditionAtReturn}` : ""}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null
        ) : null}

        {panel === "add" ? (
          <form id="add-asset" className="form-grid" onSubmit={createAsset}>
            <label>
              Asset tag *
              <input
                value={form.assetTag}
                onChange={(e) => setForm((p) => ({ ...p, assetTag: e.target.value }))}
                placeholder="AST-1001"
              />
              {formErrors.assetTag ? <em className="field-error">{formErrors.assetTag}</em> : null}
            </label>
            <label>
              Name *
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="MacBook Pro"
              />
              {formErrors.name ? <em className="field-error">{formErrors.name}</em> : null}
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Serial number
              <input
                value={form.serialNumber}
                onChange={(e) => setForm((p) => ({ ...p, serialNumber: e.target.value }))}
              />
            </label>
            <label>
              Manufacturer
              <input
                value={form.manufacturer}
                onChange={(e) => setForm((p) => ({ ...p, manufacturer: e.target.value }))}
              />
            </label>
            <label>
              Model
              <input
                value={form.modelNumber}
                onChange={(e) => setForm((p) => ({ ...p, modelNumber: e.target.value }))}
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
                placeholder="Floor 2 Storage"
              />
            </label>
            <label>
              Condition
              <select value={form.condition} onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </form>
        ) : null}

        {panel === "edit" ? (
          <form id="edit-asset" className="form-grid" onSubmit={updateAsset}>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Serial number
              <input
                value={form.serialNumber}
                onChange={(e) => setForm((p) => ({ ...p, serialNumber: e.target.value }))}
              />
            </label>
            <label>
              Location
              <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
            </label>
            <label>
              Condition
              <select value={form.condition} onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
            </label>
          </form>
        ) : null}

        {panel === "assign" ? (
          <form id="assign-asset" className="form-grid" onSubmit={assign}>
            <p className="caption">
              Assigning <strong>{selected?.name}</strong>
              {selected?.assetTag ? ` (${selected.assetTag})` : ""} to an active employee.
            </p>
            <label>
              Employee *
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} required>
                <option value="">Select employee</option>
                {people.map((person) => (
                  <option key={person._id} value={person._id}>
                    {person.fullName}
                    {person.employeeCode ? ` · ${person.employeeCode}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea rows={2} value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} />
            </label>
          </form>
        ) : null}

        {panel === "return" ? (
          <div className="form-grid">
            <p className="caption">
              Returning from <strong>{selected?.currentAssignment?.employeeName || "assignee"}</strong>.
            </p>
            <label>
              Condition at return
              <select value={returnCondition} onChange={(e) => setReturnCondition(e.target.value)}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Return notes
              <textarea rows={2} value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />
            </label>
          </div>
        ) : null}

        {panel === "filter" ? (
          <div className="form-grid">
            <label>
              Category
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="ALL">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
