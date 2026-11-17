/**
 * NEW-S1 — Feature-flagged automatic continuation for truncated scheduler waves.
 *
 * Primary path: awaited in-process hops (no fire-and-forget). Each hop reuses
 * runSchedulerForAllCompanies with the same mode + waveStartedAt and the fleet
 * / afterCompanyId cursor. Optional awaited HTTP self-continue is secondary and
 * still authenticated with CRON_SECRET.
 */

import {
  schedulerAutoContinue,
  schedulerBudgetMs,
  schedulerChainBudgetMs,
  schedulerContinueBaseUrl,
  schedulerContinueTimeoutMs,
  schedulerContinueViaHttp,
  schedulerMaxChainDepth,
  schedulerMinHopBudgetMs,
  schedulerMode,
} from "./config.js";
import { runSchedulerForAllCompanies } from "./executionController.js";

export function normalizeChainDepth(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(20, Math.floor(n));
}

export function shouldAutoContinue({
  truncated,
  chainDepth,
  autoContinue = schedulerAutoContinue(),
  maxChainDepth = schedulerMaxChainDepth(),
} = {}) {
  if (!truncated) return false;
  if (!autoContinue) return false;
  return normalizeChainDepth(chainDepth) < maxChainDepth;
}

export function remainingHopBudgetMs({
  chainDeadlineMs,
  nowMs = Date.now(),
  configuredBudgetMs = schedulerBudgetMs(),
  minHopBudgetMs = schedulerMinHopBudgetMs(),
  headroomMs = 1_000,
} = {}) {
  const remaining = Math.max(0, Number(chainDeadlineMs) - nowMs - headroomMs);
  const hop = Math.min(Math.max(0, configuredBudgetMs), remaining);
  if (hop < minHopBudgetMs) return 0;
  return hop;
}

/**
 * Build an authenticated continuation request (for HTTP path / tests).
 * Caller must already be cron-authorized; this only shapes the outbound call.
 */
export function buildContinuationRequest({
  baseUrl = schedulerContinueBaseUrl(),
  afterCompanyId = null,
  waveStartedAt = null,
  chainDepth = 0,
  mode = schedulerMode(),
  budgetMs,
  concurrency,
  maxCompanies,
  cronSecret = process.env.CRON_SECRET || process.env.ANNOUNCEMENT_CRON_SECRET || "",
} = {}) {
  const origin = String(baseUrl || "").replace(/\/$/, "");
  if (!origin) {
    return { ok: false, reason: "missing_base_url" };
  }
  if (!cronSecret) {
    return { ok: false, reason: "missing_cron_secret" };
  }

  const url = new URL(`${origin}/api/workforce-scheduler/run`);
  const body = {
    afterCompanyId: afterCompanyId ? String(afterCompanyId) : null,
    chainDepth: normalizeChainDepth(chainDepth),
    waveStartedAt: waveStartedAt ? new Date(waveStartedAt).toISOString() : undefined,
    dryRun: mode === "dry-run" ? "true" : undefined,
  };
  if (Number.isFinite(budgetMs)) body.budgetMs = budgetMs;
  if (Number.isFinite(concurrency)) body.concurrency = concurrency;
  if (Number.isFinite(maxCompanies)) body.maxCompanies = maxCompanies;

  return {
    ok: true,
    url: url.toString(),
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
    },
    body,
  };
}

/**
 * Awaited HTTP continuation. Failures are returned — never thrown to the caller
 * for transport errors — so the parent response can report continuation status
 * while the durable fleet cursor remains the recovery source of truth.
 */
export async function continueSchedulerWaveViaHttp(params = {}, { fetchImpl = fetch } = {}) {
  const built = buildContinuationRequest(params);
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason,
      truncated: true,
    };
  }

  const timeoutMs =
    Number.isFinite(params.timeoutMs) && params.timeoutMs > 0
      ? params.timeoutMs
      : schedulerContinueTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(built.url, {
      method: built.method,
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: "http_error",
        status: response.status,
        truncated: true,
        body: payload,
      };
    }
    return {
      ok: true,
      status: response.status,
      truncated: Boolean(payload?.truncated),
      body: payload,
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      reason: aborted ? "timeout" : "fetch_failed",
      message: err?.message || String(err),
      truncated: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeHopResults(aggregate, hop, chainDepth) {
  const hopResults = Array.isArray(hop.results) ? hop.results : [];
  const prior = Array.isArray(aggregate.results) ? aggregate.results : [];
  return {
    ...hop,
    skipped: false,
    companies: Math.max(Number(aggregate.companies) || 0, Number(hop.companies) || 0),
    discovered: Math.max(Number(aggregate.discovered) || 0, Number(hop.discovered) || 0),
    attempted: (Number(aggregate.attempted) || 0) + (Number(hop.attempted) || 0),
    successCount: (Number(aggregate.successCount) || 0) + (Number(hop.successCount) || 0),
    errorCount: (Number(aggregate.errorCount) || 0) + (Number(hop.errorCount) || 0),
    skippedCount: (Number(aggregate.skippedCount) || 0) + (Number(hop.skippedCount) || 0),
    results: prior.concat(hopResults),
    chainDepth,
    hops: (Number(aggregate.hops) || 0) + 1,
    autoContinued: (Number(aggregate.hops) || 0) > 0 || chainDepth > 0,
    waveStartedAt: aggregate.waveStartedAt || hop.waveStartedAt,
  };
}

/**
 * Run the multi-tenant scheduler and, when flagged, await further hops in-process
 * until the wave completes, chain depth is exhausted, or remaining time is too low.
 */
export async function runSchedulerWithAutoContinue(options = {}) {
  const autoContinue =
    options.autoContinue != null ? Boolean(options.autoContinue) : schedulerAutoContinue();
  const maxChainDepth =
    options.maxChainDepth != null
      ? normalizeChainDepth(options.maxChainDepth)
      : schedulerMaxChainDepth();
  let chainDepth = normalizeChainDepth(options.chainDepth);
  const chainStartedAt = Date.now();
  const chainBudgetMs = Number.isFinite(options.chainBudgetMs)
    ? Number(options.chainBudgetMs)
    : schedulerChainBudgetMs();
  const chainDeadlineMs = chainStartedAt + Math.max(0, chainBudgetMs);
  const configuredBudgetMs = Number.isFinite(options.budgetMs)
    ? Number(options.budgetMs)
    : schedulerBudgetMs();
  const mode = options.mode || schedulerMode();

  let aggregate = null;
  let waveStartedAt = options.waveStartedAt || null;
  let afterCompanyId = options.afterCompanyId || null;
  const continuations = [];

  while (true) {
    const hopBudget = remainingHopBudgetMs({
      chainDeadlineMs,
      nowMs: Date.now(),
      configuredBudgetMs,
      minHopBudgetMs:
        options.minHopBudgetMs != null
          ? Number(options.minHopBudgetMs)
          : schedulerMinHopBudgetMs(),
    });

    // First hop: if chain budget already exhausted, still run once with configured budget
    // when caller did not enable auto-continue (single-shot). With auto-continue, require
    // a usable hop budget after the first successful scheduling attempt setup.
    const budgetForHop =
      aggregate == null
        ? Math.min(
            configuredBudgetMs,
            Math.max(hopBudget, Math.min(configuredBudgetMs, chainBudgetMs))
          )
        : hopBudget;

    if (aggregate != null && budgetForHop <= 0) {
      continuations.push({
        kind: "in_process",
        ok: false,
        reason: "insufficient_hop_budget",
        chainDepth,
      });
      break;
    }

    const hop = await runSchedulerForAllCompanies({
      ...options,
      mode,
      budgetMs: budgetForHop,
      afterCompanyId,
      waveStartedAt: waveStartedAt || undefined,
      // After the first hop, always resume the same wave via fleet / explicit cursor.
      ignoreFleetCursor: aggregate == null ? options.ignoreFleetCursor : false,
      chainDepth,
    });

    if (!waveStartedAt && hop.waveStartedAt) {
      waveStartedAt = hop.waveStartedAt;
    }

    aggregate =
      aggregate == null ? { ...hop, hops: 1, chainDepth, autoContinued: false } : mergeHopResults(aggregate, hop, chainDepth);

    aggregate.pendingRemaining = hop.pendingRemaining;
    aggregate.truncated = hop.truncated;
    aggregate.nextAfterCompanyId = hop.nextAfterCompanyId;
    aggregate.fleet = hop.fleet;
    aggregate.waveResumed = Boolean(aggregate.waveResumed) || Boolean(hop.waveResumed);
    aggregate.durationMs = Date.now() - chainStartedAt;

    // Prevent empty-hop spin: if a continuation attempted nothing, stop even if
    // truncated remains set (fleet cursor is the recovery source of truth).
    if (
      (Number(aggregate.hops) || 0) > 1 &&
      Number(hop.attempted) === 0 &&
      Number(hop.discovered) === 0
    ) {
      aggregate.continuationStoppedReason = "empty_hop";
      break;
    }

    if (!shouldAutoContinue({ truncated: hop.truncated, chainDepth, autoContinue, maxChainDepth })) {
      if (hop.truncated && autoContinue && chainDepth >= maxChainDepth) {
        aggregate.continuationStoppedReason = "max_chain_depth";
      } else if (hop.truncated && !autoContinue) {
        aggregate.continuationStoppedReason = "auto_continue_disabled";
      }
      break;
    }

    chainDepth += 1;
    afterCompanyId = hop.nextAfterCompanyId || null;
    continuations.push({
      kind: "in_process",
      ok: true,
      chainDepth,
      afterCompanyId,
      truncated: hop.truncated,
    });
  }

  // Optional awaited HTTP hop when in-process stopped early but wave still truncated.
  const viaHttp =
    options.continueViaHttp != null
      ? Boolean(options.continueViaHttp)
      : schedulerContinueViaHttp();
  if (
    viaHttp &&
    aggregate?.truncated &&
    shouldAutoContinue({
      truncated: true,
      chainDepth,
      autoContinue,
      maxChainDepth,
    })
  ) {
    const httpResult = await continueSchedulerWaveViaHttp({
      afterCompanyId: aggregate.nextAfterCompanyId,
      waveStartedAt,
      chainDepth: chainDepth + 1,
      mode,
      budgetMs: configuredBudgetMs,
      concurrency: options.concurrency,
      maxCompanies: options.maxCompanies,
      timeoutMs: options.continueTimeoutMs,
      fetchImpl: options.fetchImpl,
    });
    continuations.push({ kind: "http", ...httpResult, chainDepth: chainDepth + 1 });
    aggregate.httpContinuation = httpResult;
    if (httpResult.ok && httpResult.body) {
      aggregate.truncated = Boolean(httpResult.body.truncated);
      aggregate.nextAfterCompanyId = httpResult.body.nextAfterCompanyId ?? aggregate.nextAfterCompanyId;
      aggregate.pendingRemaining =
        httpResult.body.pendingRemaining ?? aggregate.pendingRemaining;
      if (httpResult.body.fleet) aggregate.fleet = httpResult.body.fleet;
      aggregate.autoContinued = true;
      aggregate.hops = (Number(aggregate.hops) || 0) + 1;
      chainDepth += 1;
      aggregate.chainDepth = chainDepth;
    } else {
      aggregate.continuationStoppedReason = httpResult.reason || "http_continuation_failed";
    }
  }

  return {
    ...aggregate,
    chainDepth,
    continuations,
    autoContinueEnabled: autoContinue,
    maxChainDepth,
  };
}
