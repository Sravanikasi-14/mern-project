import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

function storageKey(userId, tableId) {
  return `hrms:cols:${userId || "anon"}:${tableId}`;
}

/**
 * Persist per-table column visibility for the authenticated user.
 * `columns` = [{ id, label, essential?: boolean, defaultVisible?: boolean }]
 */
export function useColumnPreferences(tableId, columns) {
  const { user } = useAuth();
  const userId = user?._id || user?.id || user?.email || "anon";

  const defaults = useMemo(() => {
    const map = {};
    for (const col of columns) {
      map[col.id] = col.defaultVisible !== false;
    }
    return map;
  }, [columns]);

  const [visible, setVisible] = useState(defaults);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(userId, tableId));
      if (!raw) {
        setVisible(defaults);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setVisible(defaults);
        return;
      }
      const next = { ...defaults };
      for (const col of columns) {
        if (col.essential) {
          next[col.id] = true;
        } else if (typeof parsed[col.id] === "boolean") {
          next[col.id] = parsed[col.id];
        }
      }
      setVisible(next);
    } catch {
      setVisible(defaults);
    }
  }, [userId, tableId, columns, defaults]);

  const persist = useCallback(
    (next) => {
      setVisible(next);
      try {
        localStorage.setItem(storageKey(userId, tableId), JSON.stringify(next));
      } catch {
        // ignore quota / private mode
      }
    },
    [userId, tableId]
  );

  const toggle = useCallback(
    (columnId) => {
      const col = columns.find((c) => c.id === columnId);
      if (!col || col.essential) return;
      persist({ ...visible, [columnId]: !visible[columnId] });
    },
    [columns, persist, visible]
  );

  const reset = useCallback(() => {
    persist({ ...defaults });
  }, [defaults, persist]);

  const isVisible = useCallback((columnId) => Boolean(visible[columnId]), [visible]);

  return { visible, isVisible, toggle, reset, columns };
}
