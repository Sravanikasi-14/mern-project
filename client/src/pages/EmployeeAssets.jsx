import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconCheck,
  IconClock,
  IconInfo,
  IconFileText,
} from "../components/Icons";
import api from "../services/api";

export default function EmployeeAssets() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actionError, setActionError] = useState("");
  const [acknowledgingId, setAcknowledgingId] = useState(null);

  const [assets, setAssets] = useState([]);
  const [history, setHistory] = useState([]);

  const fetchAssets = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError("");

      let items = [];
      let pastItems = [];

      try {
        const res = await api.get("/assets/my-assets");
        items = res.data?.assets || [];
        pastItems = res.data?.history || [];
      } catch (err) {
        // Fallback to employee dashboard endpoint if dedicated endpoint encounters issue
        const dashRes = await api.get("/employees/me/dashboard");
        items = dashRes.data?.assets || [];
      }

      setAssets(items);
      setHistory(pastItems);
    } catch (err) {
      if (!silent) {
        setError(err.response?.data?.message || "Failed to load assigned assets.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const handleAcknowledge = async (assetId, assetName) => {
    try {
      setAcknowledgingId(assetId);
      setActionError("");
      setActionSuccess("");

      const res = await api.post(`/assets/my-assets/${assetId}/acknowledge`);
      setActionSuccess(res.data?.message || `Receipt of ${assetName} acknowledged successfully.`);

      // Instant local state update
      setAssets((prev) =>
        prev.map((a) => {
          if (a._id === assetId || a.id === assetId) {
            return {
              ...a,
              currentAssignment: a.currentAssignment
                ? {
                    ...a.currentAssignment,
                    acknowledgementStatus: "ACKNOWLEDGED",
                    acknowledgedAt: new Date().toISOString(),
                  }
                : undefined,
              acknowledgementStatus: "ACKNOWLEDGED",
            };
          }
          return a;
        })
      );
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to acknowledge asset receipt.");
    } finally {
      setAcknowledgingId(null);
    }
  };

  return (
    <div className="container-wide" style={{ paddingBottom: 60 }}>
      <AppHeader title="My Assets" />

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

      {/* Loading Skeleton */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 18, marginTop: 24 }}>
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                padding: "20px",
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 12,
              }}
            >
              <div className="skeleton-shimmer" style={{ width: "60%", height: 18, borderRadius: 4, marginBottom: 10 }} />
              <div className="skeleton-shimmer" style={{ width: "35%", height: 12, borderRadius: 4, marginBottom: 18 }} />
              <div className="skeleton-shimmer" style={{ width: "85%", height: 14, borderRadius: 4, marginBottom: 8 }} />
              <div className="skeleton-shimmer" style={{ width: "50%", height: 14, borderRadius: 4, marginBottom: 16 }} />
              <div className="skeleton-shimmer" style={{ width: "100%", height: 36, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="error" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 16px", fontWeight: 600 }}>{error}</p>
          <button type="button" className="btn-sm btn-secondary" onClick={() => fetchAssets()}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary Status Banner */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "20px 24px",
              marginBottom: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Current Custody
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#09090b", marginTop: 4 }}>
                {assets.length} {assets.length === 1 ? "Asset" : "Assets"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  background: "#f4f4f5",
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  color: "#52525b",
                  fontWeight: 600,
                }}
              >
                IT Support: it-ops@company.internal
              </div>
            </div>
          </div>

          {/* Active Assets Grid */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: 14,
              padding: "22px 24px",
              marginBottom: 28,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                  Assigned Assets
                </h3>
              </div>
            </div>

            {assets.length === 0 ? (
              <div style={{ padding: "48px 16px", textAlign: "center", color: "#71717a", fontSize: 13.5 }}>
                <IconFileText size={36} style={{ color: "#d4d4d8", margin: "0 auto 12px" }} />
                <div style={{ fontWeight: 600, color: "#18181b", marginBottom: 6 }}>
                  No assets assigned
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 18 }}>
                {assets.map((asset, idx) => {
                  const ackStatus =
                    asset.currentAssignment?.acknowledgementStatus ||
                    asset.acknowledgementStatus ||
                    "PENDING";
                  const isAcknowledged = ackStatus === "ACKNOWLEDGED";
                  const assignedDateStr =
                    asset.currentAssignment?.assignedDate
                      ? new Date(asset.currentAssignment.assignedDate).toLocaleDateString()
                      : asset.assignedDate || null;
                  const condition =
                    asset.currentAssignment?.conditionAtAssignment ||
                    asset.condition ||
                    "Good";

                  return (
                    <div
                      key={asset._id || asset.id || idx}
                      style={{
                        padding: "18px 20px",
                        background: "#f9fafb",
                        border: "1px solid #e4e4e7",
                        borderRadius: 12,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        {/* Header: Name and Status */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 16, color: "#09090b" }}>
                              {asset.name}
                            </span>
                            <div style={{ fontSize: 12, color: "#0284c7", fontFamily: "monospace", fontWeight: 600, marginTop: 2 }}>
                              Asset ID: {asset.assetTag || "N/A"}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: 10,
                              background: "#dcfce7",
                              color: "#166534",
                            }}
                          >
                            ACTIVE
                          </span>
                        </div>

                        {/* Specs */}
                        <div style={{ display: "grid", gap: 6, fontSize: 12.5, color: "#52525b", marginTop: 12, marginBottom: 14 }}>
                          {(asset.manufacturer || asset.modelNumber) && (
                            <div>
                              <span style={{ color: "#71717a" }}>Model: </span>
                              <span style={{ fontWeight: 600, color: "#18181b" }}>
                                {asset.manufacturer ? `${asset.manufacturer} ` : ""}
                                {asset.modelNumber || ""}
                              </span>
                            </div>
                          )}
                          <div>
                            <span style={{ color: "#71717a" }}>Serial / ID: </span>
                            <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#09090b" }}>
                              {asset.serialNumber || asset.serial || "N/A"}
                            </span>
                          </div>
                          {assignedDateStr && (
                            <div>
                              <span style={{ color: "#71717a" }}>Date Given: </span>
                              <span style={{ fontWeight: 500, color: "#18181b" }}>{assignedDateStr}</span>
                            </div>
                          )}
                          <div>
                            <span style={{ color: "#71717a" }}>Condition When Given: </span>
                            <span style={{ fontWeight: 600, color: "#166534" }}>{condition}</span>
                          </div>
                          {asset.warrantyExpiry && (
                            <div>
                              <span style={{ color: "#71717a" }}>Warranty Till: </span>
                              <span>{new Date(asset.warrantyExpiry).toLocaleDateString()}</span>
                            </div>
                          )}
                          {asset.notes && (
                            <div style={{ fontSize: 12, color: "#71717a", fontStyle: "italic", marginTop: 4 }}>
                              "{asset.notes}"
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Acknowledgement Footer */}
                      <div
                        style={{
                          borderTop: "1px solid #e5e7eb",
                          paddingTop: 12,
                          marginTop: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 10,
                        }}
                      >
                        {isAcknowledged ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#166534", fontSize: 12, fontWeight: 600 }}>
                            <IconCheck size={14} />
                            <span>
                              Confirmed
                              {asset.currentAssignment?.acknowledgedAt
                                ? ` (${new Date(asset.currentAssignment.acknowledgedAt).toLocaleDateString()})`
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 8 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#b45309", fontSize: 12, fontWeight: 600 }}>
                              <IconClock size={13} />
                              <span>Awaiting Confirmation</span>
                            </span>
                            {asset._id && (
                              <button
                                type="button"
                                className="btn-sm btn-primary"
                                onClick={() => handleAcknowledge(asset._id, asset.name)}
                                disabled={acknowledgingId === asset._id}
                                style={{ fontSize: 12, padding: "5px 12px" }}
                              >
                                {acknowledgingId === asset._id ? "Confirming..." : "Confirm Receipt"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historical Custody Section (if previous equipment returned) */}
          {history.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 14,
                padding: "22px 24px",
                marginBottom: 28,
              }}
            >
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#09090b" }}>
                Returned Assets
              </h3>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e4e7", textAlign: "left", color: "#71717a" }}>
                      <th style={{ padding: "10px 12px" }}>Asset ID & Name</th>
                      <th style={{ padding: "10px 12px" }}>Serial Number</th>
                      <th style={{ padding: "10px 12px" }}>Date Given</th>
                      <th style={{ padding: "10px 12px" }}>Returned Date</th>
                      <th style={{ padding: "10px 12px" }}>Return Condition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f4f4f5" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#09090b" }}>
                          {h.name}
                          <span style={{ color: "#71717a", fontFamily: "monospace", fontSize: 11, marginLeft: 6 }}>
                            ({h.assetTag})
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#52525b" }}>
                          {h.serialNumber || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#52525b" }}>
                          {h.assignedDate ? new Date(h.assignedDate).toLocaleDateString() : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#166534", fontWeight: 500 }}>
                          {h.returnDate ? new Date(h.returnDate).toLocaleDateString() : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#52525b" }}>
                          {h.conditionAtReturn || "Good"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* IT Policy & Return Procedure Banner */}
          <div
            style={{
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: 12,
              padding: "18px 22px",
              fontSize: 13,
              color: "#0369a1",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <IconInfo size={20} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Company Asset Policy & Return Procedure</div>
              <div>
                All equipment remains the property of the organization. Only authorized IT administrators can log
                asset handovers or record returns. If a device requires maintenance or replacement, contact IT Operations
                at <strong>it-ops@company.internal</strong>. Do not hand over devices to third parties without prior authorization.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
