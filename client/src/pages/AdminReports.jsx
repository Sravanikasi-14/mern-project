import AppHeader from "../components/AppHeader";
import HrIntelligenceSection from "../components/HrIntelligenceSection";

/**
 * AI Reports workspace — Gemini-assisted operational intelligence.
 * Route remains /admin/reports for bookmarks and permissions.
 * Page identity lives in the intelligence header to avoid title duplication.
 */
export default function AdminReports() {
  return (
    <>
      <AppHeader hidePageIdentity title="AI Reports" />
      <HrIntelligenceSection />
    </>
  );
}
