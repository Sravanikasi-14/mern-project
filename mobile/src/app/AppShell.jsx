import { useState } from "react";
import { Outlet } from "react-router-dom";
import AskAiSheet from "../components/AskAiSheet";
import BottomNav from "../components/BottomNav";
import NotificationSheet from "../components/NotificationSheet";
import RouteErrorBoundary from "../components/RouteErrorBoundary";
import { useAndroidBackButton } from "../hooks/useAndroidBackButton";
import { AskAiContext } from "./askAiContext";
import { NotifyContext } from "./notifyContext";

export default function AppShell() {
  const [askOpen, setAskOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  useAndroidBackButton();

  return (
    <AskAiContext.Provider value={() => setAskOpen(true)}>
      <NotifyContext.Provider value={() => setNotifyOpen(true)}>
        <div className="app-shell">
          <div className="app-body">
            <RouteErrorBoundary>
              <Outlet />
            </RouteErrorBoundary>
          </div>
          <BottomNav />
          <AskAiSheet open={askOpen} onClose={() => setAskOpen(false)} />
          <NotificationSheet open={notifyOpen} onClose={() => setNotifyOpen(false)} />
        </div>
      </NotifyContext.Provider>
    </AskAiContext.Provider>
  );
}
