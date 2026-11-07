import { useEffect, useState } from "react";
import api from "../../services/api";

export function useDesignationCatalog() {
  const [designations, setDesignations] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/designations")
      .then((res) => {
        if (!cancelled) {
          setDesignations(Array.isArray(res.data?.designations) ? res.data.designations : []);
        }
      })
      .catch(() => {
        if (!cancelled) setDesignations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return designations;
}

/** Apply catalog title and level only when the typed title matches an active designation. */
export function matchDesignation(designations, title, currentGrade) {
  const needle = String(title || "").trim().toLowerCase();
  if (!needle) return null;
  const match = designations.find(
    (row) => row.isActive !== false && String(row.title || "").trim().toLowerCase() === needle
  );
  if (!match) return null;
  return {
    title: match.title,
    grade: match.grade ? match.grade : currentGrade || "",
  };
}
