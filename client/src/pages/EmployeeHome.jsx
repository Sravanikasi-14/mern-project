import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function EmployeeHome() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchMyProfile = async () => {
      try {
        const response = await api.get("/employees/me");
        if (!cancelled) {
          setProfile(response.data?.employee || null);
        }
      } catch (err) {
        if (!cancelled) {
          if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
            setError("We're unable to connect right now. Please try again in a moment.");
          } else {
            setError(err.response?.data?.message || "Unable to load employee profile.");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchMyProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container">
      <AppHeader title="Employee Portal" />

      {loading && <p style={{ color: "#64748b" }}>Loading your employee profile...</p>}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {!loading && (
        <div style={{ marginTop: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              paddingBottom: "18px",
              marginBottom: "20px",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "#e0e7ff",
                color: "#4338ca",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "700",
                fontSize: "18px",
              }}
            >
              {(profile?.fullName || user?.email || "E")[0].toUpperCase()}
            </div>
            <div>
              <h2 style={{ margin: "0 0 4px", fontSize: "18px", color: "#0f172a" }}>
                {profile?.fullName || "Employee"}
              </h2>
              <span style={{ fontSize: "13px", color: "#64748b" }}>
                {user?.email} • {profile?.employeeCode || "Pending"}
              </span>
            </div>
          </div>

          <h3 style={{ fontSize: "14px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "14px" }}>
            My Information
          </h3>

          <div className="detail-grid">
            <div className="detail-item">
              <strong>Employee Code</strong>
              <span>{profile?.employeeCode || "—"}</span>
            </div>
            <div className="detail-item">
              <strong>Account Status</strong>
              <span className={`status-badge ${profile?.status === "ACTIVE" ? "status-active" : "status-inactive"}`}>
                {profile?.status || "ACTIVE"}
              </span>
            </div>
            <div className="detail-item">
              <strong>Job Title</strong>
              <span>{profile?.job?.jobTitle || "Not specified"}</span>
            </div>
            <div className="detail-item">
              <strong>Assigned Project</strong>
              <span>{profile?.job?.project?.projectName || "Unassigned"}</span>
            </div>
            <div className="detail-item">
              <strong>Phone</strong>
              <span>{profile?.phoneNumber || "Not provided"}</span>
            </div>
            <div className="detail-item">
              <strong>Work Email</strong>
              <span>{profile?.email || user?.email}</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
