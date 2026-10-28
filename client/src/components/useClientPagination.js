import { useEffect, useMemo, useState } from "react";

export function useClientPagination(items, defaultSize = 10) {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const slice = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, safePage, pageSize]);

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize: (size) => {
      setPageSize(Number(size) || defaultSize);
      setPage(1);
    },
    total,
    totalPages,
    slice,
  };
}
