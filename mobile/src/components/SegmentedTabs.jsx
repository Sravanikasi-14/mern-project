export default function SegmentedTabs({ value, onChange, options }) {
  return (
    <div className="seg-tabs" role="tablist">
      {options.map((option) => {
        const id = option.value ?? option;
        const label = option.label ?? option;
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "is-active" : ""}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
