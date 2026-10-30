import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import { IconClose, IconInfo } from "./Icons";
import { EmployeeIcon } from "./EmployeeIcon";
import ChatbotWidget from "./ChatbotWidget";
import { useAuth } from "../context/AuthContext";
import "./Sidebar.css";

export default function AppLayout({ children }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const roleClass = user?.role === "HR_ADMIN" ? "role-hr" : user?.role === "EMPLOYEE" ? "role-employee" : "";

  const handleNotifyModule = (moduleName) => {
    setToastMessage(`${moduleName} module is currently under development.`);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  return (
    <div className={`app-shell has-mobile-tabbar ${roleClass} ${collapsed ? "sidebar-collapsed" : ""}`}>
      {/* Mobile Header Bar */}
      <header className="mobile-header">
        <button
          type="button"
          className="mobile-hamburger-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open Navigation Menu"
        >
          {user?.role === "EMPLOYEE" ? (
            <EmployeeIcon name="menu" size={22} strokeWidth={2} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <div className="mobile-brand-title">
          <span>HRMS</span>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Persistent Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onNotifyModule={handleNotifyModule}
      />

      {/* Main Page Content Area */}
      <div className="app-main-content">
        {children || <Outlet />}
      </div>

      <MobileNav />

      {/* Floating Gemini AI Assistant Chatbot */}
      <ChatbotWidget />

      {/* Toast Notification for un-implemented modules */}
      {toastMessage && (
        <div className="module-toast-notification" role="status">
          <div className="toast-icon">
            <IconInfo size={16} />
          </div>
          <div className="toast-text">{toastMessage}</div>
          <button
            type="button"
            className="toast-close"
            onClick={() => setToastMessage(null)}
            aria-label="Dismiss notification"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
