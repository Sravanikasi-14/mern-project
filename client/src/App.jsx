import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { buildHiringRedirect } from "./utils/hiringStage";
import { homeForRole } from "./utils/navigation";
import { QueryClientProvider } from "@tanstack/react-query";
import AppLayout from "./components/AppLayout";
import HrModuleGate from "./components/HrModuleGate";
import ProtectedRoute from "./components/ProtectedRoute";
import SessionBoot from "./components/SessionBoot";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { queryClient } from "./lib/queryClient";
import "./index.css";

const AdminHome = lazy(() => import("./pages/AdminHome"));
const AdminLeaveManagement = lazy(() => import("./pages/AdminLeaveManagement"));
const EditEmployee = lazy(() => import("./pages/EditEmployee"));
const EmployeeDashboard = lazy(() => import("./pages/EmployeeDashboard"));
const EmployeeHome = lazy(() => import("./pages/EmployeeHome"));
const EmployeeProfile = lazy(() => import("./pages/EmployeeProfile"));
const Login = lazy(() => import("./pages/Login"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const HiringOnboardingPage = lazy(() => import("./pages/HiringOnboardingPage"));
const OrganizationPage = lazy(() => import("./pages/OrganizationPage"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AdminPayroll = lazy(() => import("./pages/AdminPayroll"));
const CandidateOfferReview = lazy(() => import("./pages/CandidateOfferReview"));
const CandidateOnboardingPage = lazy(() => import("./pages/CandidateOnboardingPage"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminPolicies = lazy(() => import("./pages/AdminPolicies"));
const AccountActivation = lazy(() => import("./pages/AccountActivation"));
const AdminAttendanceOverview = lazy(() => import("./pages/AdminAttendanceOverview"));
const AdminLiveTracking = lazy(() => import("./pages/AdminLiveTracking"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminAssets = lazy(() => import("./pages/AdminAssets"));
const EmployeeAttendance = lazy(() => import("./pages/EmployeeAttendance"));
const EmployeeLeave = lazy(() => import("./pages/EmployeeLeave"));
const EmployeePayslips = lazy(() => import("./pages/EmployeePayslips"));
const EmployeeAssets = lazy(() => import("./pages/EmployeeAssets"));
const AdminWorkManagement = lazy(() => import("./pages/AdminWorkManagement"));
const AdminImpactPoints = lazy(() => import("./pages/AdminImpactPoints"));
const EmployeeTasks = lazy(() => import("./pages/EmployeeTasks"));
const EmployeeImpactPoints = lazy(() => import("./pages/EmployeeImpactPoints"));
const EmployeeSettings = lazy(() => import("./pages/EmployeeSettings"));
const PeopleDirectory = lazy(() => import("./pages/PeopleDirectory"));
const CompanyHrManagement = lazy(() => import("./pages/CompanyHrManagement"));
const AdminReports = lazy(() => import("./pages/AdminReports"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));

const PORTAL_ROLES = ["HR_ADMIN", "COMPANY_ADMIN"];

function Portal({ children }) {
  return (
    <ProtectedRoute roles={PORTAL_ROLES}>
      <AppLayout>
        <HrModuleGate>{children}</HrModuleGate>
      </AppLayout>
    </ProtectedRoute>
  );
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div className="spinner" />
    </div>
  );
}

function HiringRedirect({ context }) {
  const location = useLocation();
  return <Navigate to={buildHiringRedirect(location.search, context)} replace />;
}

function IndexRedirect() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) {
    return <SessionBoot />;
  }
  if (isAuthenticated && user) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return <LandingPage />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboard" element={<Onboarding />} />
          <Route path="/offers/review/:token" element={<CandidateOfferReview />} />
          <Route path="/candidate/onboarding/:token" element={<CandidateOnboardingPage />} />
          <Route path="/activate" element={<AccountActivation />} />
          <Route path="/company/hr-management" element={<Navigate to="/admin/hr-management" replace />} />
          <Route path="/company" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<Portal><AdminDashboard /></Portal>} />
          <Route path="/admin" element={<Portal><AdminHome /></Portal>} />
          <Route path="/admin/organization" element={<Portal><OrganizationPage /></Portal>} />
          <Route path="/admin/employees/:id" element={<Portal><EmployeeProfile /></Portal>} />
          <Route path="/admin/employees/:id/edit" element={<Portal><EditEmployee /></Portal>} />
          <Route path="/admin/attendance" element={<Portal><AdminAttendanceOverview /></Portal>} />
          <Route path="/admin/live-tracking" element={<Portal><AdminLiveTracking /></Portal>} />
          <Route path="/admin/leave" element={<Portal><AdminLeaveManagement /></Portal>} />
          <Route path="/admin/hiring" element={<Portal><HiringOnboardingPage /></Portal>} />
          <Route path="/admin/hiring/offer-editor" element={<Portal><Navigate to="/admin/hiring?compose=1" replace /></Portal>} />
          <Route path="/admin/offers" element={<Portal><HiringRedirect context="offers" /></Portal>} />
          <Route path="/admin/onboarding" element={<Portal><HiringRedirect context="onboarding" /></Portal>} />
          <Route path="/admin/payroll" element={<Portal><AdminPayroll /></Portal>} />
          <Route path="/admin/assets" element={<Portal><AdminAssets /></Portal>} />
          <Route path="/admin/settings" element={<Portal><AdminSettings /></Portal>} />
          <Route path="/admin/policies" element={<Portal><AdminPolicies /></Portal>} />
          <Route path="/admin/work-management" element={<Portal><AdminWorkManagement /></Portal>} />
          <Route path="/admin/work-impact" element={<Portal><AdminWorkManagement /></Portal>} />
          <Route path="/admin/impact-points" element={<Portal><AdminImpactPoints /></Portal>} />
          <Route path="/admin/reports" element={<Portal><AdminReports /></Portal>} />
          <Route path="/admin/messages" element={<Portal><MessagesPage /></Portal>} />
          <Route
            path="/admin/hr-management"
            element={
              <ProtectedRoute roles={["COMPANY_ADMIN"]}>
                <AppLayout>
                  <CompanyHrManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/dashboard"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/attendance"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeAttendance />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/leave"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeLeave />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/payslips"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeePayslips />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/assets"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeAssets />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/tasks"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeTasks />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/work-impact"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeTasks />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/impact-points"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeImpactPoints />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/profile"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeHome defaultTab="overview" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/directory"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <PeopleDirectory />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/settings"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeSettings />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/messages"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <MessagesPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/documents"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeHome defaultTab="documents" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<IndexRedirect />} />
          <Route path="*" element={<IndexRedirect />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
