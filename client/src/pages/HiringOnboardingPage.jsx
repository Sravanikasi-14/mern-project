import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import ModuleToolbar from "../components/ModuleToolbar";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import HiringCandidateModal from "../components/hiring/HiringCandidateModal";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import {
  HIRING_STAGE_CHIPS,
  HIRING_STAGE_LABELS,
  OFFER_STATUS_BADGES,
  ONBOARDING_STATUS_BADGES,
  STAGE_BADGES,
  defaultTabForStage,
  formatDate,
  normalizeStageParam,
  primaryActionForRow,
  stageFromLegacyStatus,
} from "../utils/hiringStage";
import "./HiringOnboarding.css";

const OfferLettersManagement = lazy(() => import("./OfferLettersManagement"));

const DEFAULT_PAGE_SIZE = 20;
const VALID_TABS = new Set(["overview", "offer", "onboarding", "account", "timeline"]);

function Badge({ badge, children }) {
  const b = badge || { bg: "#f4f4f5", color: "#52525b", border: "#e4e4e7" };
  return (
    <span className="hw-badge" style={{ background: b.bg, color: b.color, borderColor: b.border }}>
      {children}
    </span>
  );
}

export default function HiringOnboardingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, company } = useAuth();
  const canCreateOffer = hrPortalAllows(user, company, "hiring.create");

  const stage =
    normalizeStageParam(searchParams.get("stage")) ||
    stageFromLegacyStatus(searchParams.get("status")) ||
    "ALL";
  const deepLinkOfferId = (searchParams.get("offerId") || "").trim();
  const deepLinkTab = (searchParams.get("tab") || "").trim().toLowerCase();
  const composing = searchParams.get("compose") === "1";
  const composeEditId = (searchParams.get("editOfferId") || "").trim();

  const openCompose = useCallback(
    (editId = "") => {
      const next = new URLSearchParams(searchParams);
      next.set("compose", "1");
      if (editId) next.set("editOfferId", editId);
      else next.delete("editOfferId");
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams]
  );

  const [searchTerm, setSearchTerm] = useState(searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("search") || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ONE modal. `open` holds the row snapshot used to render instantly; modal fetches the rest.
  const [open, setOpen] = useState(null); // { offerId, row, tab }
  const [liveConnected, setLiveConnected] = useState(false);
  const [live, setLive] = useState({ tick: 0, submissionId: "" });

  const requestSeq = useRef(0);
  const filtersRef = useRef({});
  const handledDeepLinkRef = useRef("");

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [stage, debouncedSearch, pageSize]);

  const fetchList = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;
      try {
        if (!silent) setLoading(true);
        const params = { page, limit: pageSize };
        if (stage !== "ALL") params.stage = stage;
        if (debouncedSearch) params.search = debouncedSearch;
        const res = await api.get("/hiring/candidates", { params });
        if (seq !== requestSeq.current) return; // stale response
        setRows(res.data.candidates || []);
        setSummary(res.data.summary || null);
        setPagination(res.data.pagination || { page, limit: pageSize, total: 0, totalPages: 1 });
        setError("");
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err.response?.data?.message || "Failed to load hiring pipeline.");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [stage, debouncedSearch, page, pageSize]
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  filtersRef.current = { refetch: () => fetchList({ silent: true }) };

  const closeCompose = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("compose");
    next.delete("editOfferId");
    setSearchParams(next, { replace: true });
    fetchList({ silent: true });
  }, [searchParams, setSearchParams, fetchList]);

  // SSE: on event refetch the LIST only; tell an open modal which candidate changed.
  useEffect(() => {
    const baseURL = api.defaults.baseURL || "/api";
    const eventsUrl = `${baseURL.replace(/\/$/, "")}/onboarding/events`;
    let eventSource = null;
    let timer = null;
    try {
      eventSource = new EventSource(eventsUrl, { withCredentials: true });
      eventSource.onopen = () => setLiveConnected(true);
      eventSource.onerror = () => setLiveConnected(false);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload || payload.type === "CONNECTED") {
            setLiveConnected(true);
            return;
          }
          clearTimeout(timer);
          timer = setTimeout(() => {
            filtersRef.current.refetch();
            if (payload.submissionId) {
              setLive((cur) => ({ tick: cur.tick + 1, submissionId: String(payload.submissionId) }));
            }
          }, 250);
        } catch {
          /* ignore malformed event */
        }
      };
    } catch {
      /* EventSource unavailable */
    }
    return () => {
      clearTimeout(timer);
      if (eventSource) eventSource.close();
    };
  }, []);

  const updateParams = useCallback(
    (mutate) => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const setStage = (key) => {
    updateParams((p) => {
      if (key === "ALL") p.delete("stage");
      else p.set("stage", key);
      p.delete("status");
    });
  };

  const openCandidate = useCallback((row, tab) => {
    setOpen({ offerId: String(row.offerId), row, tab: tab || defaultTabForStage(row.stage) });
  }, []);

  const closeModal = useCallback(() => {
    setOpen(null);
    if (deepLinkOfferId) {
      updateParams((p) => {
        p.delete("offerId");
        p.delete("tab");
      });
    }
  }, [deepLinkOfferId, updateParams]);

  // Deep link (?offerId=...&tab=...): open the modal immediately, even before the list returns.
  useEffect(() => {
    if (!deepLinkOfferId || handledDeepLinkRef.current === deepLinkOfferId) return;
    handledDeepLinkRef.current = deepLinkOfferId;
    const match = rows.find((r) => String(r.offerId) === deepLinkOfferId);
    setOpen({
      offerId: deepLinkOfferId,
      row: match || { offerId: deepLinkOfferId },
      tab: VALID_TABS.has(deepLinkTab) ? deepLinkTab : match ? defaultTabForStage(match.stage) : "overview",
    });
  }, [deepLinkOfferId, deepLinkTab, rows]);

  // Keep the modal's light header fresh when the list refreshes.
  const openRow = useMemo(() => {
    if (!open) return null;
    return rows.find((r) => String(r.offerId) === open.offerId) || open.row;
  }, [open, rows]);

  const chipCount = (chip) => (summary ? summary[chip.summaryKey] ?? 0 : null);

  const emptyFiltered = stage !== "ALL" || debouncedSearch;

  const stageNav = (
    <div className="dept-chip-row hw-stage-row" role="tablist" aria-label="Filter by stage">
      {HIRING_STAGE_CHIPS.map((chip) => {
        const count = chipCount(chip);
        return (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={stage === chip.key}
            className={`dept-chip${stage === chip.key ? " is-selected" : ""}`}
            onClick={() => setStage(chip.key)}
          >
            {chip.label}
            {count !== null ? <strong>{count}</strong> : null}
          </button>
        );
      })}
      {stage === "WITHDRAWN" || (summary?.withdrawn > 0 && stage === "ALL") ? (
        <button
          type="button"
          role="tab"
          aria-selected={stage === "WITHDRAWN"}
          className={`dept-chip${stage === "WITHDRAWN" ? " is-selected" : ""}`}
          onClick={() => setStage(stage === "WITHDRAWN" ? "ALL" : "WITHDRAWN")}
        >
          Withdrawn
          <strong>{summary?.withdrawn ?? 0}</strong>
        </button>
      ) : null}
    </div>
  );

  if (composing) {
    return (
      <main className="container-wide hw-page">
        <Suspense fallback={<div className="hw-skel" style={{ height: 120, marginTop: 24 }} />}>
          <OfferLettersManagement
            embedded
            autoCreate={!composeEditId}
            editOfferId={composeEditId || null}
            onBack={closeCompose}
            onSaved={() => fetchList({ silent: true })}
          />
        </Suspense>
      </main>
    );
  }

  return (
    <main className="container-wide hw-page">
      <AppHeader
        title="Hiring & Onboarding"
        subtitle="Offers, candidate onboarding, HR review and account setup in one place."
        actions={
          <span
            className={`hw-live${liveConnected ? " is-on" : ""}`}
            title={liveConnected ? "Live updates connected" : "Live updates reconnecting"}
          >
            ● {liveConnected ? "Live" : "Offline"}
          </span>
        }
        nav={stageNav}
      />

      <ModuleToolbar
        searchValue={searchTerm}
        onSearchChange={(e) => setSearchTerm(e.target.value)}
        searchPlaceholder="Search name, email or role..."
        searchAriaLabel="Search candidates"
        actions={
          canCreateOffer ? (
            <button type="button" className="btn-primary" onClick={() => openCompose()}>
              + New offer
            </button>
          ) : null
        }
      />

      {error && (
        <div className="hw-alert hw-alert-error" role="alert">
          {error}{" "}
          <button type="button" className="hw-link-btn" onClick={() => fetchList()}>Retry</button>
        </div>
      )}

      <div className="hw-table-card table-wrapper-relative">
        {loading && <div className="table-progress-bar" />}
        <div className="hw-table-scroll">
          <table className="hw-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Offer</th>
                <th>Onboarding</th>
                <th>Stage</th>
                <th>Updated</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody className={loading && rows.length > 0 ? "hw-dim" : ""}>
              {loading && rows.length === 0 ? (
                <TableSkeletonRows rowCount={6} colCount={8} widths={["120px", "170px", "110px", "80px", "100px", "90px", "80px", "100px"]} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="hw-empty">
                      <p style={{ margin: "0 0 12px" }}>
                        {emptyFiltered ? "No candidates match the selected filters." : "No offers or onboarding records yet."}
                      </p>
                      {emptyFiltered && (
                        <button
                          type="button"
                          className="hw-btn hw-btn-sm"
                          onClick={() => {
                            setSearchTerm("");
                            setStage("ALL");
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const offerBadge = OFFER_STATUS_BADGES[row.offerStatus];
                  const onbBadge = ONBOARDING_STATUS_BADGES[row.onboardingStatus];
                  const primary = primaryActionForRow(row);
                  return (
                    <tr key={row.offerId} className="hw-row" onClick={() => openCandidate(row)}>
                      <td>
                        <span className="hw-name">{row.name || "—"}</span>
                      </td>
                      <td>{row.email}</td>
                      <td>
                        <span>{row.position || "—"}</span>
                        {row.department ? <span className="hw-sub">{row.department}</span> : null}
                      </td>
                      <td>
                        <Badge badge={offerBadge}>{offerBadge?.label || row.offerStatus}</Badge>
                        {row.emailDeliveryStatus === "DELIVERY_FAILED" && (
                          <span className="hw-sub" style={{ color: "#b91c1c" }}>Email failed</span>
                        )}
                      </td>
                      <td>
                        {row.onboardingStatus ? (
                          <>
                            <Badge badge={onbBadge}>{onbBadge?.label || row.onboardingStatus}</Badge>
                            {row.sectionsPendingCount > 0 && (
                              <span className="hw-sub">{row.sectionsPendingCount} section{row.sectionsPendingCount > 1 ? "s" : ""} to review</span>
                            )}
                          </>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td>
                        <Badge badge={STAGE_BADGES[row.stage]}>{HIRING_STAGE_LABELS[row.stage] || row.stage}</Badge>
                      </td>
                      <td style={{ color: "#64748b" }}>{formatDate(row.updatedAt)}</td>
                      <td className="hw-actions">
                        <button
                          type="button"
                          className="hw-btn hw-btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCandidate(row, primary.tab);
                          }}
                        >
                          {primary.label}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination.total > 0 && (
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            pageSizeOptions={[10, 20, 50]}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => setPageSize(s)}
            itemLabel="candidates"
          />
        )}
      </div>

      {open && (
        <HiringCandidateModal
          key={open.offerId}
          offerId={open.offerId}
          row={openRow}
          initialTab={open.tab}
          liveTick={live.tick}
          liveSubmissionId={live.submissionId}
          onClose={closeModal}
          onChanged={() => fetchList({ silent: true })}
        />
      )}
    </main>
  );
}
