import { useLocation, useNavigate } from "react-router-dom";

const TASK_PATHS = ["/app/tasks"];
const IMPACT_PATHS = ["/app/impact-points", "/app/work-impact"];

export default function WorkSectionNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const impact = IMPACT_PATHS.includes(location.pathname);
  const tasks = TASK_PATHS.includes(location.pathname) || !impact;

  return (
    <div className="wk-switch" role="tablist" aria-label="Work section">
      <button
        type="button"
        role="tab"
        aria-selected={tasks}
        className={tasks ? "is-active" : ""}
        onClick={() => navigate("/app/tasks")}
      >
        Tasks
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={impact}
        className={impact ? "is-active" : ""}
        onClick={() => navigate("/app/impact-points")}
      >
        Impact
      </button>
    </div>
  );
}
