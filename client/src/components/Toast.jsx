import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, options = {}) => {
    const text = String(message || "").trim();
    if (!text) return;
    const kind = options.kind === "error" || options.kind === "success" ? options.kind : "info";
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => {
      // Avoid duplicate identical toasts already visible.
      if (prev.some((item) => item.message === text && item.kind === kind)) return prev;
      return [...prev, { id, message: text, kind }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.kind || "info"}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { push: () => {} };
  }
  return ctx;
}
