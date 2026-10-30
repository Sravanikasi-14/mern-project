import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./AuthContext";
import ProtectedRoute from "./ProtectedRoute";
import AppShell from "./AppShell";
import { queryClient } from "./queryClient";
import { ToastProvider } from "../components/Toast";
import SessionBoot from "../components/SessionBoot";
import LoginPage from "../pages/auth/LoginPage";
import OnboardPage from "../pages/auth/OnboardPage";
import ActivatePage from "../pages/auth/ActivatePage";
import OfferReviewPage from "../pages/auth/OfferReviewPage";
import CandidateOnboardingPage from "../pages/auth/CandidateOnboardingPage";
import EmployeeHomePage from "../pages/employee/HomePage";
import EmployeeAttendancePage from "../pages/employee/AttendancePage";
import EmployeeLeavePage from "../pages/employee/LeavePage";
import EmployeeTasksPage from "../pages/employee/TasksPage";
import EmployeePayslipsPage from "../pages/employee/PayslipsPage";
import EmployeeProfilePage from "../pages/employee/ProfilePage";
import EmployeeAssetsPage from "../pages/employee/AssetsPage";
import EmployeeImpactPage from "../pages/employee/ImpactPage";
import EmployeeSettingsPage from "../pages/employee/SettingsPage";
import EmployeeMorePage from "../pages/employee/MorePage";
import EmployeePoliciesPage from "../pages/employee/PoliciesPage";
import HrHomePage from "../pages/hr/HomePage";
import HrPeoplePage from "../pages/hr/PeoplePage";
import HrPersonPage from "../pages/hr/PersonPage";
import HrPersonEditPage from "../pages/hr/PersonEditPage";
import HrAttendancePage from "../pages/hr/AttendancePage";
import HrAttendanceDetailPage from "../pages/hr/AttendanceDetailPage";
import HrLiveTrackingPage from "../pages/hr/LiveTrackingPage";
import HrLeavePage from "../pages/hr/LeavePage";
import HrAssetsPage from "../pages/hr/AssetsPage";
import HrWorkPage from "../pages/hr/WorkPage";
import HrPoliciesPage from "../pages/hr/PoliciesPage";
import HrPolicyDetailPage from "../pages/hr/PolicyDetailPage";
import HrPayrollPage from "../pages/hr/PayrollPage";
import HrPayslipDetailPage from "../pages/hr/PayslipDetailPage";
import HrOffersPage from "../pages/hr/OffersPage";
import HrOnboardingPage from "../pages/hr/OnboardingPage";
import HrSettingsPage from "../pages/hr/SettingsPage";
import HrReportsPage from "../pages/hr/ReportsPage";
import HrImpactPage from "../pages/hr/ImpactPage";
import HrMorePage from "../pages/hr/MorePage";

function IndexRedirect() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) {
    return <SessionBoot />;
  }
  if (isAuthenticated && user) {
    return <Navigate to={user.role === "HR_ADMIN" ? "/admin/dashboard" : "/app"} replace />;
  }
  return <Navigate to="/login" replace />;
}

function Employee({ children }) {
  return (
    <ProtectedRoute roles={["EMPLOYEE"]}>
      {children}
    </ProtectedRoute>
  );
}

function Hr({ children }) {
  return (
    <ProtectedRoute roles={["HR_ADMIN"]}>
      {children}
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/onboard" element={<OnboardPage />} />
            <Route path="/activate" element={<ActivatePage />} />
            <Route path="/offers/review/:token" element={<OfferReviewPage />} />
            <Route path="/candidate/onboarding/:token" element={<CandidateOnboardingPage />} />
            <Route element={<Employee><AppShell /></Employee>}>
              <Route path="/app" element={<EmployeeHomePage />} />
              <Route path="/app/dashboard" element={<EmployeeHomePage />} />
              <Route path="/app/attendance" element={<EmployeeAttendancePage />} />
              <Route path="/app/leave" element={<EmployeeLeavePage />} />
              <Route path="/app/tasks" element={<EmployeeTasksPage />} />
              <Route path="/app/work-impact" element={<EmployeeImpactPage />} />
              <Route path="/app/payslips" element={<EmployeePayslipsPage />} />
              <Route path="/app/assets" element={<EmployeeAssetsPage />} />
              <Route path="/app/impact-points" element={<EmployeeImpactPage />} />
              <Route path="/app/profile" element={<EmployeeProfilePage />} />
              <Route path="/app/documents" element={<EmployeeProfilePage documentsOnly />} />
              <Route path="/app/settings" element={<EmployeeSettingsPage />} />
              <Route path="/app/policies" element={<EmployeePoliciesPage />} />
              <Route path="/app/policies/:section" element={<HrPolicyDetailPage readOnly />} />
              <Route path="/app/more" element={<EmployeeMorePage />} />
            </Route>
            <Route element={<Hr><AppShell /></Hr>}>
              <Route path="/admin/dashboard" element={<HrHomePage />} />
              <Route path="/admin" element={<HrPeoplePage />} />
              <Route path="/admin/employees/:id" element={<HrPersonPage />} />
              <Route path="/admin/employees/:id/edit" element={<HrPersonEditPage />} />
              <Route path="/admin/attendance" element={<HrAttendancePage />} />
              <Route path="/admin/attendance/live" element={<HrLiveTrackingPage />} />
              <Route path="/admin/attendance/:id" element={<HrAttendanceDetailPage />} />
              <Route path="/admin/leave" element={<HrLeavePage />} />
              <Route path="/admin/assets" element={<HrAssetsPage />} />
              <Route path="/admin/work-management" element={<HrWorkPage />} />
              <Route path="/admin/work-impact" element={<HrWorkPage />} />
              <Route path="/admin/policies" element={<HrPoliciesPage />} />
              <Route path="/admin/policies/:section" element={<HrPolicyDetailPage />} />
              <Route path="/admin/payroll" element={<HrPayrollPage />} />
              <Route path="/admin/payroll/payslips/:payslipId" element={<HrPayslipDetailPage />} />
              <Route path="/admin/offers" element={<HrOffersPage />} />
              <Route path="/admin/onboarding" element={<HrOnboardingPage />} />
              <Route path="/admin/impact-points" element={<HrImpactPage />} />
              <Route path="/admin/reports" element={<HrReportsPage />} />
              <Route path="/admin/settings" element={<HrSettingsPage />} />
              <Route path="/admin/more" element={<HrMorePage />} />
            </Route>
            <Route path="/" element={<IndexRedirect />} />
            <Route path="*" element={<IndexRedirect />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
    </QueryClientProvider>
  );
}
