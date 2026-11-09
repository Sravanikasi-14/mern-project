import "./review.css";

/**
 * Configurable decision actions for review workflows.
 * Only render actions the workflow actually supports.
 *
 * actions: [{ key, label, onClick, variant: 'approve'|'reject'|'changes'|'secondary'|'primary', disabled }]
 */
export default function ReviewDecisionBar({ actions = [], className = "" }) {
  if (!actions.length) return null;

  return (
    <div className={`review-decision-bar ${className}`.trim()} role="group" aria-label="Review decisions">
      {actions.map((action) => {
        const variant = action.variant || "secondary";
        let btnClass = "btn-secondary";
        let extra = "";
        if (variant === "approve" || variant === "primary") {
          btnClass = "btn-primary";
          extra = "review-decision-approve";
        } else if (variant === "reject") {
          btnClass = "btn-secondary";
          extra = "review-decision-reject";
        } else if (variant === "changes") {
          btnClass = "btn-secondary";
          extra = "review-decision-changes";
        } else if (variant === "danger") {
          btnClass = "btn-danger";
        }
        return (
          <button
            key={action.key}
            type="button"
            className={`${btnClass} ${extra}`.trim()}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
