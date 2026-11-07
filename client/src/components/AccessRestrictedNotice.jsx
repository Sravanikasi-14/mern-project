import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { dismissAccessNotice, subscribeAccessNotice } from "../utils/accessNotice";
import "./AccessRestrictedNotice.css";

export default function AccessRestrictedNotice() {
  const [notice, setNotice] = useState(null);
  const gotItRef = useRef(null);

  useEffect(() => subscribeAccessNotice(setNotice), []);

  useEffect(() => {
    if (!notice) return undefined;
    gotItRef.current?.focus();
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissAccessNotice();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className="access-restricted-overlay"
      role="presentation"
      onClick={() => dismissAccessNotice()}
    >
      <div
        className="access-restricted-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-restricted-title"
        aria-describedby="access-restricted-message"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="access-restricted-icon" aria-hidden="true">
          <Lock size={22} strokeWidth={2} />
        </span>
        <h2 id="access-restricted-title">{notice.title}</h2>
        <p id="access-restricted-message">{notice.message}</p>
        <button
          ref={gotItRef}
          type="button"
          className="btn-primary access-restricted-confirm"
          onClick={() => dismissAccessNotice()}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function AccessRestrictedInline() {
  return (
    <p className="access-restricted-inline" role="note">
      <strong>Access restricted.</strong> You don&apos;t have permission to perform this action. Your HR Admin access is limited by the permissions assigned by your Company Admin.
    </p>
  );
}
