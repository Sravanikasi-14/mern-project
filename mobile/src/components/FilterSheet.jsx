import { useState } from "react";
import Modal from "./Modal";

export default function FilterSheet({
  search,
  onSearch,
  searchPlaceholder = "Search",
  children,
  onApply,
  onReset,
  active = false,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="search-row">
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
        />
        <button
          type="button"
          className={`filter-btn${active ? " is-active" : ""}`}
          onClick={() => setOpen(true)}
        >
          Filters
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                onReset?.();
              }}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onApply?.();
                setOpen(false);
              }}
            >
              Apply
            </button>
          </>
        }
      >
        <div className="form-grid">{children}</div>
      </Modal>
    </>
  );
}
