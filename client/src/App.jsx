import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./context/AuthContext";
import AdminHome from "./pages/AdminHome";
import EmployeeHome from "./pages/EmployeeHome";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import "./index.css";

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
                <AdminHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/app"
            element={
              <ProtectedRoute roles={["EMPLOYEE"]}>
                <EmployeeHome />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
