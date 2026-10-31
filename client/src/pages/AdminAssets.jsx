import { useEffect, useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import {
  IconClose,
  IconSearch,
  IconCheck,
  IconAlertCircle,
  IconClock,
  IconInfo,
  IconFileText,
} from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import Pagination from "../components/Pagination";
import api from "../services/api";
import { useAdminAssetsQuery } from "../hooks/useAdminQueries";
import { invalidateAssets } from "../lib/queryKeys";

const CATEGORIES = [
  { value: "ALL", label: "All Categories" },
  { value: "LAPTOP", label: "Laptop" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "MONITOR", label: "Monitor" },
  { value: "PHONE_TABLET", label: "Phone / Tablet" },
  { value: "PERIPHERAL", label: "Peripheral" },
  { value: "ACCESS_CARD", label: "Access Card" },
  { value: "FURNITURE", label: "Furniture" },
  { value: "OTHER", label: "Other" },
];

const STATUSES = [
  { value: "ALL", label: "All Statuses" },
  { value: "AVAILABLE", label: "Available" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "UNDER_MAINTENANCE", label: "Under Maintenance" },
  { value: "RETIRED", label: "Retired" },
  { value: "LOST", label: "Lost" },
];

const CONDITIONS = [
  { value: "ALL", label: "All Conditions" },
  { value: "NEW", label: "New" },
  { value: "EXCELLENT", label: "Excellent" },
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "POOR", label: "Poor" },
  { value: "DAMAGED", label: "Damaged" },
];

export default function AdminAssets() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [conditionFilter, setConditionFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter, statusFilter, conditionFilter]);

  const assetsQuery = useAdminAssetsQuery({
    page,
    limit: pageSize,
    status: statusFilter !== "ALL" ? statusFilter : "",
    search: debouncedSearch,
    category: categoryFilter !== "ALL" ? categoryFilter : "",
    condition: conditionFilter !== "ALL" ? conditionFilter : "",
  });

  const assets = assetsQuery.data?.assets || [];
  const summary = assetsQuery.data?.summary || {
    total: 0,
    available: 0,
    assigned: 0,
    underMaintenance: 0,
    retired: 0,
    lost: 0,
    requiringAttention: 0,
  };
  const loading = assetsQuery.isLoading && assets.length === 0;
  const pagination = assetsQuery.data?.pagination || {
    page,
    limit: pageSize,
    total: 0,
    totalPages: 1,
  };

  useEffect(() => {
    if (assetsQuery.error) {
      setError(
        assetsQuery.error.response?.data?.message ||
          "Failed to load company asset inventory."
      );
    } else if (assetsQuery.isSuccess) {
      setError("");
    }
  }, [assetsQuery.error, assetsQuery.isSuccess]);

  const totalAssets = pagination.total || 0;
  const totalPages = pagination.totalPages || 1;
  const paginatedAssets = assets;

  // Employees for assignment dropdown
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeFetchError, setEmployeeFetchError] = useState("");

  // Modal states
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [submittingAsset, setSubmittingAsset] = useState(false);

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningAsset, setAssigningAsset] = useState(null);
  const [submittingAssign, setSubmittingAssign] = useState(false);
  const [assignForm, setAssignForm] = useState({
    employeeId: "",
    assignedDate: new Date().toISOString().split("T")[0],
    conditionAtAssignment: "GOOD",
    notes: "",
  });

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningAsset, setReturningAsset] = useState(null);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnForm, setReturnForm] = useState({
    returnDate: new Date().toISOString().split("T")[0],
    conditionAtReturn: "GOOD",
    returnNotes: "",
    nextStatus: "AVAILABLE",
  });

  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsAsset, setDetailsAsset] = useState(null);

  const [assetForm, setAssetForm] = useState({
    assetTag: "",
    name: "",
    category: "LAPTOP",
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    purchaseDate: "",
    purchaseCost: "",
    warrantyExpiry: "",
    condition: "GOOD",
    status: "AVAILABLE",
    location: "",
    department: "",
    notes: "",
  });

  const fetchEmployees = async () => {
    try {
      setLoadingEmployees(true);
      setEmployeeFetchError("");
      const res = await api.get("/employees", {
        params: { status: "ACTIVE", limit: 200 },
      });
      const list =
        res.data?.employees ||
        res.data?.data ||
        (Array.isArray(res.data) ? res.data : []);
      // Filter only active employees
      setEmployees(list.filter((e) => e.status === "ACTIVE"));
    } catch (err) {
      setEmployeeFetchError(
        err.response?.data?.message || "Failed to load active employees."
      );
    } finally {
      setLoadingEmployees(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setDebouncedSearch(search.trim());
  };

  // Add / Edit asset modal open
  const handleOpenAddModal = () => {
    setEditingAsset(null);
    setAssetForm({
      assetTag: "",
      name: "",
      category: "LAPTOP",
      manufacturer: "",
      modelNumber: "",
      serialNumber: "",
      purchaseDate: "",
      purchaseCost: "",
      warrantyExpiry: "",
      condition: "GOOD",
      status: "AVAILABLE",
      location: "",
      department: "",
      notes: "",
    });
    setActionError("");
    setShowAddEditModal(true);
  };

  const handleOpenEditModal = (asset) => {
    setEditingAsset(asset);
    setAssetForm({
      assetTag: asset.assetTag || "",
      name: asset.name || "",
      category: asset.category || "LAPTOP",
      manufacturer: asset.manufacturer || "",
      modelNumber: asset.modelNumber || "",
      serialNumber: asset.serialNumber || "",
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split("T")[0] : "",
      purchaseCost: asset.purchaseCost !== null ? asset.purchaseCost : "",
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.split("T")[0] : "",
      condition: asset.condition || "GOOD",
      status: asset.status || "AVAILABLE",
      location: asset.location || "",
      department: asset.department || "",
      notes: asset.notes || "",
    });
    setActionError("");
    setShowAddEditModal(true);
  };

  const handleSaveAsset = async (e) => {
    e.preventDefault();
    try {
      setSubmittingAsset(true);
      setActionError("");

      if (editingAsset) {
        const res = await api.put(`/assets/${editingAsset._id}`, assetForm);
        setActionSuccess(res.data?.message || "Asset updated successfully.");
      } else {
        const res = await api.post("/assets", assetForm);
        setActionSuccess(res.data?.message || "Asset created successfully.");
      }

      setShowAddEditModal(false);
      await invalidateAssets(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to save asset.");
    } finally {
      setSubmittingAsset(false);
    }
  };

  // Assign modal handlers
  const handleOpenAssignModal = (asset) => {
    setAssigningAsset(asset);
    setAssignForm({
      employeeId: "",
      assignedDate: new Date().toISOString().split("T")[0],
      conditionAtAssignment: asset.condition || "GOOD",
      notes: "",
    });
    setActionError("");
    if (employees.length === 0 && !loadingEmployees) {
      fetchEmployees();
    }
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (!assignForm.employeeId) {
      setActionError("Please select an active employee.");
      return;
    }
    try {
      setSubmittingAssign(true);
      setActionError("");
      const res = await api.post(`/assets/${assigningAsset._id}/assign`, assignForm);
      setActionSuccess(res.data?.message || "Asset assigned successfully.");
      setShowAssignModal(false);
      await invalidateAssets(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to assign asset.");
    } finally {
      setSubmittingAssign(false);
    }
  };

  // Return modal handlers
  const handleOpenReturnModal = (asset) => {
    setReturningAsset(asset);
    setReturnForm({
      returnDate: new Date().toISOString().split("T")[0],
      conditionAtReturn: asset.condition || "GOOD",
      returnNotes: "",
      nextStatus: asset.condition === "DAMAGED" || asset.condition === "POOR" ? "UNDER_MAINTENANCE" : "AVAILABLE",
    });
    setActionError("");
    setShowReturnModal(true);
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmittingReturn(true);
      setActionError("");
      const res = await api.post(`/assets/${returningAsset._id}/return`, returnForm);
      setActionSuccess(res.data?.message || "Asset return recorded successfully.");
      setShowReturnModal(false);
      await invalidateAssets(queryClient);
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to record asset return.");
    } finally {
      setSubmittingReturn(false);
    }
  };

  // View details modal
  const handleOpenDetailsModal = async (asset) => {
    try {
      const res = await api.get(`/assets/${asset._id}`);
      setDetailsAsset(res.data?.asset || asset);
      setShowDetailsModal(true);
    } catch {
      setDetailsAsset(asset);
      setShowDetailsModal(true);
    }
  };

  // Status badge styling helper
  const renderStatusBadge = (status) => {
    const map = {
      AVAILABLE: { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0", label: "Available" },
      ASSIGNED: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", label: "Assigned" },
      UNDER_MAINTENANCE: { bg: "#fffbeb", color: "#b45309", border: "#fde68a", label: "Maintenance" },
      RETIRED: { bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7", label: "Retired" },
      LOST: { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca", label: "Lost" },
    };
    const s = map[status] || { bg: "#f4f4f5", color: "#71717a", border: "#e4e4e7", label: status };
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 8px",
          borderRadius: 12,
          fontSize: 11.5,
          fontWeight: 600,
          background: s.bg,
          color: s.color,
          border: `1px solid ${s.border}`,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
        {s.label}
      </span>
    );
  };

  return (
    <div className="container-wide">
      <AppHeader
        title="Assets"
        actions={<SoftRefresh active={Boolean(assetsQuery.isFetching && assets.length > 0)} />}
      />

      {/* Action Alerts */}
      {actionSuccess && (
        <div className="success-alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionSuccess}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionSuccess("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="error" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span>{actionError}</span>
          <button type="button" className="btn-sm btn-secondary" onClick={() => setActionError("")} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* Compact Inline Asset Statistics Strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: "var(--card)",
          border: "1px solid var(--hair)",
          borderRadius: 8,
          padding: "8px 16px",
          marginBottom: 12,
          fontSize: 13,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--text-muted)" }}>
          Total Inventory: <strong style={{ color: "var(--text)" }}>{summary.total}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted)" }}>
          Available: <strong style={{ color: "var(--g-700)" }}>{summary.available}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted)" }}>
          Assigned: <strong style={{ color: "var(--g-800)" }}>{summary.assigned}</strong>
        </span>
        <span style={{ color: "#d4d4d8" }}>•</span>
        <span style={{ color: "var(--text-muted)" }}>
          Needs Attention: <strong style={{ color: summary.requiringAttention > 0 ? "#b91c1c" : "var(--text)" }}>{summary.requiringAttention}</strong>
        </span>
      </div>

      {/* Main Asset Workspace */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--hair)",
          borderRadius: "12px",
          padding: "16px 18px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {/* Consolidated Compact Toolbar: Search, Filters, Add Button */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 16,
            paddingBottom: 14,
            borderBottom: "1px solid var(--hair, #e6ede8)",
          }}
        >
          {/* Search form */}
          <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8, flex: "1 1 240px", maxWidth: 360 }}>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type="text"
                placeholder="Search by tag, name, serial, or employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "7px 12px 7px 32px",
                  borderRadius: 6,
                  border: "1px solid #d4d4d8",
                  fontSize: 12.5,
                }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#a1a1aa" }}>
                <IconSearch size={14} />
              </span>
            </div>
            <button type="submit" className="btn-secondary" style={{ padding: "7px 12px", fontSize: 12.5 }}>
              Search
            </button>
          </form>

          {/* Filters & Action Button */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 12.5 }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 12.5 }}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #d4d4d8", fontSize: 12.5 }}
            >
              {CONDITIONS.map((cd) => (
                <option key={cd.value} value={cd.value}>
                  {cd.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn-primary"
              onClick={handleOpenAddModal}
              style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600 }}
            >
              + Add Asset
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div className="spinner" style={{ margin: "0 auto 14px" }} />
            <p style={{ color: "#71717a", fontSize: 14 }}>Loading asset inventory...</p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="table-error-banner">
            <span>{error}</span>
            <button type="button" className="btn-sm-retry" onClick={() => assetsQuery.refetch()}>
              Retry
            </button>
          </div>
        )}

        {/* Asset Table */}
        <div className="table-wrapper-relative" style={{ overflowX: "auto" }}>
          {assetsQuery.isFetching && assets.length > 0 && <div className="table-progress-bar" />}
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                <th style={{ padding: "12px 14px" }}>Asset ID & Name</th>
                <th style={{ padding: "12px 14px" }}>Category</th>
                <th style={{ padding: "12px 14px" }}>Model & Serial</th>
                <th style={{ padding: "12px 14px" }}>Condition</th>
                <th style={{ padding: "12px 14px" }}>Status</th>
                <th style={{ padding: "12px 14px" }}>Currently Assigned To</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody className={assetsQuery.isFetching && assets.length > 0 ? "table-refreshing-dim" : ""}>
              {loading && assets.length === 0 ? (
                <TableSkeletonRows colCount={7} rowCount={6} />
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", color: "#71717a", fontSize: 14 }}>
                    <IconFileText size={36} style={{ color: "#d4d4d8", margin: "0 auto 12px" }} />
                    <div style={{ fontWeight: 600, color: "#18181b", marginBottom: 6 }}>
                      No assets found
                    </div>
                    <p style={{ margin: "0 0 12px" }}>
                      {search || categoryFilter !== "ALL" || statusFilter !== "ALL"
                        ? "Try adjusting your search query or filter criteria."
                        : "Get started by adding your organization's physical hardware and devices."}
                    </p>
                    {(search || categoryFilter !== "ALL" || statusFilter !== "ALL") && (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: 13 }}
                        onClick={() => {
                          setSearch("");
                          setDebouncedSearch("");
                          setCategoryFilter("ALL");
                          setStatusFilter("ALL");
                          setConditionFilter("ALL");
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : paginatedAssets.map((asset) => {
                  const isAssigned = asset.status === "ASSIGNED" && Boolean(asset.currentAssignment?.employeeId);
                  const isAvailable = asset.status === "AVAILABLE";

                  return (
                    <tr
                      key={asset._id}
                      style={{
                        borderBottom: "1px solid #f4f4f5",
                        transition: "background 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "14px" }}>
                        <div style={{ fontWeight: 700, color: "#09090b", fontSize: 14 }}>
                          {asset.name}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 11.5, color: "#0284c7", fontWeight: 600, marginTop: 2 }}>
                          {asset.assetTag}
                        </div>
                      </td>

                      <td style={{ padding: "14px", color: "#52525b" }}>
                        <span style={{ background: "#f4f4f5", padding: "3px 8px", borderRadius: 4, fontSize: 11.5, fontWeight: 500 }}>
                          {asset.category}
                        </span>
                      </td>

                      <td style={{ padding: "14px", color: "#52525b" }}>
                        <div>{asset.manufacturer ? `${asset.manufacturer} ${asset.modelNumber || ""}` : asset.modelNumber || "—"}</div>
                        {asset.serialNumber && (
                          <div style={{ fontSize: 11.5, color: "#71717a", fontFamily: "monospace", marginTop: 2 }}>
                            S/N: {asset.serialNumber}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: "14px" }}>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            color:
                              asset.condition === "NEW" || asset.condition === "EXCELLENT"
                                ? "#166534"
                                : asset.condition === "DAMAGED" || asset.condition === "POOR"
                                ? "#b91c1c"
                                : "#09090b",
                          }}
                        >
                          {asset.condition}
                        </span>
                      </td>

                      <td style={{ padding: "14px" }}>
                        {renderStatusBadge(asset.status)}
                      </td>

                      <td style={{ padding: "14px" }}>
                        {isAssigned ? (
                          <div>
                            <div style={{ fontWeight: 600, color: "#09090b" }}>
                              {asset.currentAssignment.employeeName}
                            </div>
                            <div style={{ fontSize: 11.5, color: "#71717a" }}>
                              {asset.currentAssignment.employeeCode} • {new Date(asset.currentAssignment.assignedDate).toLocaleDateString()}
                            </div>
                            {asset.currentAssignment.acknowledgementStatus === "ACKNOWLEDGED" ? (
                              <span style={{ fontSize: 10.5, color: "#166534", fontWeight: 600 }}>✓ Confirmed</span>
                            ) : (
                              <span style={{ fontSize: 10.5, color: "#b45309", fontWeight: 600 }}>⏳ Awaiting Confirmation</span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#a1a1aa", fontSize: 12 }}>— In Storage</span>
                        )}
                      </td>

                      <td style={{ padding: "14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {isAvailable && (
                            <button
                              type="button"
                              className="btn-sm btn-primary"
                              onClick={() => handleOpenAssignModal(asset)}
                              style={{ fontSize: 12, padding: "5px 10px" }}
                            >
                              Assign
                            </button>
                          )}

                          {isAssigned && (
                            <button
                              type="button"
                              className="btn-sm btn-secondary"
                              onClick={() => handleOpenReturnModal(asset)}
                              style={{ fontSize: 12, padding: "5px 10px", borderColor: "#fecaca", color: "#b91c1c" }}
                            >
                              Return
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn-sm btn-secondary"
                            onClick={() => handleOpenDetailsModal(asset)}
                            style={{ fontSize: 12, padding: "5px 10px" }}
                          >
                            Details
                          </button>

                          <button
                            type="button"
                            className="btn-sm btn-secondary"
                            onClick={() => handleOpenEditModal(asset)}
                            style={{ fontSize: 12, padding: "5px 10px" }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalAssets}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            itemLabel="company assets"
          />
      </div>

      {/* ADD / EDIT ASSET MODAL */}
      {showAddEditModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingAsset && setShowAddEditModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 620,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                {editingAsset ? `Edit Asset — ${editingAsset.assetTag}` : "Add New Company Asset"}
              </h3>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowAddEditModal(false)}
                disabled={submittingAsset}
              >
                <IconClose size={14} />
              </button>
            </div>

            {actionError && <div className="error" style={{ marginBottom: 14 }}>{actionError}</div>}

            <form onSubmit={handleSaveAsset} style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Asset ID *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AST-001"
                    value={assetForm.assetTag}
                    onChange={(e) => setAssetForm({ ...assetForm, assetTag: e.target.value.toUpperCase() })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, textTransform: "uppercase" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Asset Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MacBook Pro 16 M3 Max"
                    value={assetForm.name}
                    onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Category</label>
                  <select
                    value={assetForm.category}
                    onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    {CATEGORIES.filter((c) => c.value !== "ALL").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Condition</label>
                  <select
                    value={assetForm.condition}
                    onChange={(e) => setAssetForm({ ...assetForm, condition: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    {CONDITIONS.filter((c) => c.value !== "ALL").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Status</label>
                  <select
                    value={assetForm.status}
                    onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })}
                    disabled={editingAsset?.status === "ASSIGNED"}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    {STATUSES.filter((s) => s.value !== "ALL").map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Manufacturer</label>
                  <input
                    type="text"
                    placeholder="e.g. Apple"
                    value={assetForm.manufacturer}
                    onChange={(e) => setAssetForm({ ...assetForm, manufacturer: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Model Number</label>
                  <input
                    type="text"
                    placeholder="e.g. A2991"
                    value={assetForm.modelNumber}
                    onChange={(e) => setAssetForm({ ...assetForm, modelNumber: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Serial Number</label>
                  <input
                    type="text"
                    placeholder="e.g. C02G40XYZ"
                    value={assetForm.serialNumber}
                    onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Purchase Date</label>
                  <input
                    type="date"
                    value={assetForm.purchaseDate}
                    onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Purchase Cost (₹)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 150000"
                    value={assetForm.purchaseCost}
                    onChange={(e) => setAssetForm({ ...assetForm, purchaseCost: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Warranty Expiry</label>
                  <input
                    type="date"
                    value={assetForm.warrantyExpiry}
                    onChange={(e) => setAssetForm({ ...assetForm, warrantyExpiry: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Storage Location</label>
                  <input
                    type="text"
                    placeholder="e.g. HQ - IT Room, Shelf 2"
                    value={assetForm.location}
                    onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Department</label>
                  <input
                    type="text"
                    placeholder="e.g. Engineering"
                    value={assetForm.department}
                    onChange={(e) => setAssetForm({ ...assetForm, department: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>Notes / Instructions</label>
                <textarea
                  rows="2"
                  placeholder="Additional specs or maintenance details..."
                  value={assetForm.notes}
                  onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddEditModal(false)}
                  disabled={submittingAsset}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submittingAsset}>
                  {submittingAsset ? "Saving..." : editingAsset ? "Save Changes" : "Create Asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSIGN ASSET MODAL */}
      {showAssignModal && assigningAsset && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingAssign && setShowAssignModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 500,
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Assign Asset
                </h3>
                <div style={{ fontSize: 12.5, color: "#71717a" }}>
                  {assigningAsset.name} • <strong>{assigningAsset.assetTag}</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowAssignModal(false)}
                disabled={submittingAssign}
              >
                <IconClose size={14} />
              </button>
            </div>

            {actionError && <div className="error" style={{ marginBottom: 14 }}>{actionError}</div>}

            <form onSubmit={handleAssignSubmit} style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Select Employee *
                </label>
                {loadingEmployees ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", fontSize: 13, color: "#71717a" }}>
                    <div className="spinner" style={{ width: 14, height: 14 }} />
                    <span>Loading active employees...</span>
                  </div>
                ) : employeeFetchError ? (
                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12.5 }}>
                    <div style={{ marginBottom: 6 }}>{employeeFetchError}</div>
                    <button
                      type="button"
                      className="btn-sm btn-secondary"
                      onClick={fetchEmployees}
                      style={{ fontSize: 12, padding: "3px 8px" }}
                    >
                      Retry Loading Employees
                    </button>
                  </div>
                ) : employees.length === 0 ? (
                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", color: "#64748b", fontSize: 13 }}>
                    No active employees available to assign.
                  </div>
                ) : (
                  <select
                    required
                    value={assignForm.employeeId}
                    onChange={(e) => setAssignForm({ ...assignForm, employeeId: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    <option value="">-- Choose Active Employee --</option>
                    {employees.map((emp) => (
                      <option key={emp._id} value={emp._id}>
                        {emp.fullName || `${emp.firstName || ""} ${emp.lastName || ""}`.trim()} ({emp.employeeCode || "N/A"}) — {emp.job?.department || emp.department || "General"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Date Given *
                  </label>
                  <input
                    type="date"
                    required
                    value={assignForm.assignedDate}
                    onChange={(e) => setAssignForm({ ...assignForm, assignedDate: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Condition When Given
                  </label>
                  <select
                    value={assignForm.conditionAtAssignment}
                    onChange={(e) => setAssignForm({ ...assignForm, conditionAtAssignment: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    {CONDITIONS.filter((c) => c.value !== "ALL").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Notes
                </label>
                <textarea
                  rows="2"
                  placeholder="e.g. Handed over with charger, laptop bag, and security token"
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAssignModal(false)}
                  disabled={submittingAssign}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submittingAssign || loadingEmployees || employees.length === 0 || !!employeeFetchError}
                >
                  {submittingAssign ? "Assigning..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECORD RETURN MODAL */}
      {showReturnModal && returningAsset && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingReturn && setShowReturnModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 500,
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Record Asset Return
                </h3>
                <div style={{ fontSize: 12.5, color: "#71717a" }}>
                  Returning from: <strong>{returningAsset.currentAssignment?.employeeName}</strong> ({returningAsset.assetTag})
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowReturnModal(false)}
                disabled={submittingReturn}
              >
                <IconClose size={14} />
              </button>
            </div>

            {actionError && <div className="error" style={{ marginBottom: 14 }}>{actionError}</div>}

            <form onSubmit={handleReturnSubmit} style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Return Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={returnForm.returnDate}
                    onChange={(e) => setReturnForm({ ...returnForm, returnDate: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                    Condition at Return
                  </label>
                  <select
                    value={returnForm.conditionAtReturn}
                    onChange={(e) => {
                      const newCond = e.target.value;
                      const nextSt = newCond === "DAMAGED" || newCond === "POOR" ? "UNDER_MAINTENANCE" : "AVAILABLE";
                      setReturnForm({ ...returnForm, conditionAtReturn: newCond, nextStatus: nextSt });
                    }}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                  >
                    {CONDITIONS.filter((c) => c.value !== "ALL").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Status Following Return
                </label>
                <select
                  value={returnForm.nextStatus}
                  onChange={(e) => setReturnForm({ ...returnForm, nextStatus: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13 }}
                >
                  <option value="AVAILABLE">AVAILABLE (Ready for reissue)</option>
                  <option value="UNDER_MAINTENANCE">UNDER MAINTENANCE (Requires servicing)</option>
                  <option value="RETIRED">RETIRED (End of life / disposal)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                  Return Notes & Inspection Remarks
                </label>
                <textarea
                  rows="2"
                  placeholder="e.g. Returned intact, minor surface scuffs on lid, formatted"
                  value={returnForm.returnNotes}
                  onChange={(e) => setReturnForm({ ...returnForm, returnNotes: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d4d4d8", fontSize: 13, fontFamily: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowReturnModal(false)}
                  disabled={submittingReturn}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={submittingReturn}>
                  {submittingReturn ? "Recording..." : "Record Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSET DETAILS & HISTORY MODAL */}
      {showDetailsModal && detailsAsset && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowDetailsModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: "24px 28px",
              width: "100%",
              maxWidth: 700,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, borderBottom: "1px solid #e4e4e7", paddingBottom: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                    {detailsAsset.name}
                  </h3>
                  {renderStatusBadge(detailsAsset.status)}
                </div>
                <div style={{ fontSize: 12.5, color: "#71717a", marginTop: 4 }}>
                  Tag: <strong style={{ color: "#0284c7" }}>{detailsAsset.assetTag}</strong> • Category: {detailsAsset.category}
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowDetailsModal(false)}
              >
                <IconClose size={14} />
              </button>
            </div>

            {/* Specifications Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                padding: "14px 16px",
                background: "#f8fafc",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                marginBottom: 20,
                fontSize: 12.5,
              }}
            >
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Manufacturer / Model
                </span>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.manufacturer ? `${detailsAsset.manufacturer} ${detailsAsset.modelNumber || ""}` : detailsAsset.modelNumber || "N/A"}
                </div>
              </div>
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Serial Number
                </span>
                <div style={{ fontFamily: "monospace", fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.serialNumber || "N/A"}
                </div>
              </div>
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Condition
                </span>
                <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.condition}
                </div>
              </div>
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Purchase Cost
                </span>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.purchaseCost ? `₹${Number(detailsAsset.purchaseCost).toLocaleString("en-IN")}` : "Not recorded"}
                </div>
              </div>
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Warranty Expiry
                </span>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.warrantyExpiry ? new Date(detailsAsset.warrantyExpiry).toLocaleDateString() : "No warranty info"}
                </div>
              </div>
              <div>
                <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
                  Location / Dept
                </span>
                <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {detailsAsset.location || detailsAsset.department || "General Storage"}
                </div>
              </div>
            </div>

            {/* Current Custody / Assignment */}
            <div style={{ marginBottom: 22 }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#09090b" }}>
                Current Custody
              </h4>
              {detailsAsset.currentAssignment?.employeeId ? (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderRadius: 10,
                    padding: "14px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#166534", fontSize: 14 }}>
                      {detailsAsset.currentAssignment.employeeName} ({detailsAsset.currentAssignment.employeeCode})
                    </div>
                    <div style={{ fontSize: 12, color: "#15803d", marginTop: 2 }}>
                      Assigned on {new Date(detailsAsset.currentAssignment.assignedDate).toLocaleDateString()} • Condition When Given: {detailsAsset.currentAssignment.conditionAtAssignment}
                    </div>
                    {detailsAsset.currentAssignment.notes && (
                      <div style={{ fontSize: 12, color: "#3f6212", marginTop: 4 }}>
                        Notes: {detailsAsset.currentAssignment.notes}
                      </div>
                    )}
                  </div>
                  <div>
                    {detailsAsset.currentAssignment.acknowledgementStatus === "ACKNOWLEDGED" ? (
                      <span style={{ background: "#dcfce7", color: "#166534", padding: "4px 10px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                        ✓ Confirmed by Employee ({detailsAsset.currentAssignment.acknowledgedAt ? new Date(detailsAsset.currentAssignment.acknowledgedAt).toLocaleDateString() : "Confirmed"})
                      </span>
                    ) : (
                      <span style={{ background: "#fef3c7", color: "#b45309", padding: "4px 10px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                        ⏳ Awaiting Employee Confirmation
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ padding: "14px", background: "#f9fafb", border: "1px solid #e4e4e7", borderRadius: 10, fontSize: 13, color: "#71717a" }}>
                  Currently in inventory and not assigned to any staff member.
                </div>
              )}
            </div>

            {/* Assignment History Log */}
            <div>
              <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#09090b" }}>
                Historical Custody Log
              </h4>
              {Array.isArray(detailsAsset.assignmentHistory) && detailsAsset.assignmentHistory.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {detailsAsset.assignmentHistory.map((hist, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "12px 14px",
                        background: "#fafafa",
                        border: "1px solid #e4e4e7",
                        borderRadius: 8,
                        fontSize: 12.5,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#09090b" }}>
                        <span>
                          {hist.employeeName} ({hist.employeeCode || "N/A"})
                        </span>
                        <span style={{ color: "#71717a" }}>
                          {hist.assignedDate ? new Date(hist.assignedDate).toLocaleDateString() : "—"} to{" "}
                          {hist.returnDate ? new Date(hist.returnDate).toLocaleDateString() : "Present"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#52525b", marginTop: 4 }}>
                        Condition: Received as {hist.conditionAtAssignment || "Good"} • Returned as {hist.conditionAtReturn || "Good"}
                        {hist.returnNotes ? ` • Return Remarks: "${hist.returnNotes}"` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "#71717a", padding: "8px 0" }}>
                  No historical assignments recorded yet for this asset.
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowDetailsModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
