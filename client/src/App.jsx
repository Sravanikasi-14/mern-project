import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AdminHome from "./pages/AdminHome";
import AdminLeaveManagement from "./pages/AdminLeaveManagement";
import EditEmployee from "./pages/EditEmployee";
import EmployeeDashboard from "./pages/EmployeeDashboard";
import EmployeeHome from "./pages/EmployeeHome";
import EmployeeProfile from "./pages/EmployeeProfile";
import Login from "./pages/Login";
import OfferLettersManagement from "./pages/OfferLettersManagement";
import Onboarding from "./pages/Onboarding";
import "./index.css";

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
    return <Navigate to={user.role === "HR_ADMIN" ? "/admin" : "/app"} replace />;
  }
  return <Navigate to="/login" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/onboard" element={<Onboarding />} />
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
            path="/app"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard activeSection="overview" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/attendance"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard activeSection="attendance" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/leave"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard activeSection="leave" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/payslips"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard activeSection="payslips" />
                </AppLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/app/assets"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <AppLayout>
                  <EmployeeDashboard activeSection="assets" />
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
                  <EmployeeHome defaultTab="edit_profile" />
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
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
