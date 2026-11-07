import { useAuth } from "../../app/AuthContext";

/**
 * Phase CA1 placeholder shell for Company Admin portal routing on mobile.
 */
export default function CompanyAdminHomePage() {
  const { user, company, logout } = useAuth();
  const brand = company?.branding?.displayName || company?.companyName || "Company";

  return (
    <main className="page-shell" style={{ padding: 20 }}>
      <p className="caption" style={{ margin: "0 0 6px" }}>
        Company Admin
      </p>
      <h1 style={{ margin: "0 0 12px", fontSize: 20 }}>{brand}</h1>
      <p className="caption" style={{ margin: "0 0 16px", lineHeight: 1.45 }}>
        Signed in as {user?.email || "Company Admin"}. Portal modules will be added in later
        phases.
      </p>
      <button type="button" className="btn-secondary" onClick={() => logout()}>
        Sign out
      </button>
    </main>
  );
}
