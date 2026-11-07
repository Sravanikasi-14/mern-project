import AppHeader from "../components/AppHeader";
import OrganizationWorkspace from "../components/organization-workspace/OrganizationWorkspace";
import "./Organization.css";

export default function OrganizationPage() {
  return (
    <main className="container-wide org-page">
      <AppHeader
        title="Organization"
        subtitle="See who reports to whom, and manage departments, teams, job titles, and access."
      />
      <OrganizationWorkspace />
    </main>
  );
}
