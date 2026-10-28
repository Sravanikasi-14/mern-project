import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import "./index.css";

const AdminHome = lazy(() => import("./pages/AdminHome"));
const AdminLeaveManagement = lazy(() => import("./pages/AdminLeaveManagement"));
const EditEmployee = lazy(() => import("./pages/EditEmployee"));
const EmployeeDashboard = lazy(() => import("./pages/EmployeeDashboard"));
const EmployeeHome = lazy(() => import("./pages/EmployeeHome"));
const EmployeeProfile = lazy(() => import("./pages/EmployeeProfile"));
const Login = lazy(() => import("./pages/Login"));
const OfferLettersManagement = lazy(() => import("./pages/OfferLettersManagement"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const AdminPayroll = lazy(() => import("./pages/AdminPayroll"));
const CandidateOfferReview = lazy(() => import("./pages/CandidateOfferReview"));
const CandidateOnboardingPage = lazy(() => import("./pages/CandidateOnboardingPage"));
const AdminOnboardingReview = lazy(() => import("./pages/AdminOnboardingReview"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminPolicies = lazy(() => import("./pages/AdminPolicies"));
const AccountActivation = lazy(() => import("./pages/AccountActivation"));
const AdminAttendanceOverview = lazy(() => import("./pages/AdminAttendanceOverview"));
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

function IndexRedirect() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) {
    return (
      <div
        className="auth-restore-screen"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f4f5",
        }}
      >
        <div className="spinner" />
      </div>
    );
  }
  if (isAuthenticated && user) {
    return <Navigate to={user.role === "HR_ADMIN" ? "/admin/dashboard" : "/app/dashboard"} replace />;
  }
  return <Navigate to="/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboard" element={<Onboarding />} />
          <Route path="/offers/review/:token" element={<CandidateOfferReview />} />
          <Route path="/candidate/onboarding/:token" element={<CandidateOnboardingPage />} />
          <Route path="/activate" element={<AccountActivation />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminDashboard />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminHome />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employees/:id"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <EmployeeProfile />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employees/:id/edit"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <EditEmployee />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/attendance"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminAttendanceOverview />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/leave"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminLeaveManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/offers"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <OfferLettersManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/onboarding"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminOnboardingReview />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/payroll"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminPayroll />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/assets"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminAssets />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminSettings />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/policies"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminPolicies />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/work-management"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminWorkManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/work-impact"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminWorkManagement />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/impact-points"
            element={
              <ProtectedRoute roles={["HR_ADMIN"]}>
                <AppLayout>
                  <AdminImpactPoints />
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
  );
}

export default App;
