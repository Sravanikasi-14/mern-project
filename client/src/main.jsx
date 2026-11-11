import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

try {
  const density = localStorage.getItem("hrms_table_density");
  if (density === "comfortable" || density === "compact") {
    document.documentElement.dataset.tableDensity = density;
  } else {
    document.documentElement.dataset.tableDensity = "compact";
  }
} catch {
  document.documentElement.dataset.tableDensity = "compact";
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
