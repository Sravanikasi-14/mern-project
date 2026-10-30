export default function Toggle({ checked, onChange, label, description, disabled = false }) {
  return (
    <div className="settings-row">
      <div>
        <p className="summary-title">{label}</p>
        {description ? <p className="summary-sub">{description}</p> : null}
      </div>
      <button
        type="button"
        className={`toggle${checked ? " is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
      >
        <span />
      </button>
    </div>
  );
}
