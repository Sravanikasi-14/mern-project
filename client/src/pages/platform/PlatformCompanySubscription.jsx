import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import platformApi from "../../services/platformApi";

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function PlatformCompanySubscription({ companyId }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [planId, setPlanId] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [dates, setDates] = useState({
    startDate: "",
    endDate: "",
    trialEndsAt: "",
    renewalDate: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["platform", "subscription", companyId],
    queryFn: async () =>
      (await platformApi.get(`/platform/companies/${companyId}/subscription`)).data,
    enabled: Boolean(companyId),
  });

  useEffect(() => {
    if (!data?.subscription) return;
    setDates({
      startDate: toDateInput(data.subscription.startDate),
      endDate: toDateInput(data.subscription.endDate),
      trialEndsAt: toDateInput(data.subscription.trialEndsAt),
      renewalDate: toDateInput(data.subscription.renewalDate),
    });
  }, [data?.subscription]);

  const plansQuery = useQuery({
    queryKey: ["platform", "plans", "active"],
    queryFn: async () =>
      (await platformApi.get("/platform/plans", { params: { includeInactive: "false" } })).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["platform", "subscription", companyId] });
    qc.invalidateQueries({ queryKey: ["platform", "company", companyId] });
    qc.invalidateQueries({ queryKey: ["platform", "overview"] });
  };

  const subMutation = useMutation({
    mutationFn: async (body) =>
      (await platformApi.patch(`/platform/companies/${companyId}/subscription`, body)).data,
    onSuccess: () => {
      setMessage("Subscription updated.");
      setError("");
      invalidate();
    },
    onError: (err) => setError(err?.response?.data?.message || "Subscription update failed."),
  });

  const invoiceMutation = useMutation({
    mutationFn: async () =>
      (
        await platformApi.post(`/platform/companies/${companyId}/invoices`, {
          amount: Number(invoiceAmount),
          currency: data?.subscription?.currency || "INR",
          dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        })
      ).data,
    onSuccess: () => {
      setMessage("Invoice created (unpaid — no payment gateway).");
      setInvoiceAmount("");
      invalidate();
    },
    onError: (err) => setError(err?.response?.data?.message || "Invoice create failed."),
  });

  const payMutation = useMutation({
    mutationFn: async (invoiceId) =>
      (
        await platformApi.post(`/platform/invoices/${invoiceId}/payments`, {
          confirm: true,
          method: "MANUAL",
          note: "Manually recorded by Platform Admin",
        })
      ).data,
    onSuccess: () => {
      setMessage("Manual payment recorded (not gateway-confirmed).");
      invalidate();
    },
    onError: (err) => setError(err?.response?.data?.message || "Payment record failed."),
  });

  if (isLoading) return <p className="pa-muted">Loading subscription…</p>;
  if (!data) return <p className="pa-error">Unable to load subscription.</p>;

  const sub = data.subscription || {};

  return (
    <div className="pa-panel">
      <h2>Subscription</h2>
      <p className="pa-muted">
        Plan changes update entitlements immediately. Tenant data is never deleted by subscription
        suspension.
      </p>
      {message ? <p className="pa-muted">{message}</p> : null}
      {error ? <p className="pa-error">{error}</p> : null}

      <div className="pa-grid-stats">
        <div className="pa-stat">
          <div className="pa-stat-label">Plan</div>
          <div className="pa-stat-value" style={{ fontSize: 20 }}>
            {sub.planCode}
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Status</div>
          <div className="pa-stat-value" style={{ fontSize: 20 }}>
            {sub.status}
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Billing</div>
          <div className="pa-stat-value" style={{ fontSize: 20 }}>
            {sub.billingStatus}
          </div>
        </div>
        <div className="pa-stat">
          <div className="pa-stat-label">Seats used</div>
          <div className="pa-stat-value" style={{ fontSize: 20 }}>
            {sub.seatUsage ?? 0}/{sub.maxEmployeeSeats ?? "—"}
          </div>
        </div>
      </div>
      <p className="pa-muted">
        Storage: plan limit {sub.maxStorageMb ? `${sub.maxStorageMb} MB` : "not enforced"}.{" "}
        {sub.storageUsageNote || "Usage is checked at upload when GridFS accounting is available."}
      </p>

      <div className="pa-toolbar">
        <select className="pa-select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">Assign plan…</option>
          {(plansQuery.data?.plans || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pa-btn pa-btn-primary"
          disabled={!planId || subMutation.isPending}
          onClick={() => {
            if (window.confirm("Change this company's subscription plan?")) {
              subMutation.mutate({ planId, confirm: true });
            }
          }}
        >
          Assign plan
        </button>
        {sub.status !== "SUSPENDED" ? (
          <button
            type="button"
            className="pa-btn pa-btn-danger"
            onClick={() => {
              if (window.confirm("Suspend subscription? Tenant data will be retained.")) {
                subMutation.mutate({ status: "SUSPENDED", confirm: true });
              }
            }}
          >
            Suspend subscription
          </button>
        ) : (
          <button
            type="button"
            className="pa-btn pa-btn-primary"
            onClick={() => subMutation.mutate({ status: "ACTIVE", confirm: true })}
          >
            Reactivate subscription
          </button>
        )}
      </div>

      <table className="pa-table">
        <tbody>
          <tr>
            <th>Start</th>
            <td>
              <input
                className="pa-input"
                type="date"
                value={dates.startDate}
                onChange={(e) => setDates((prev) => ({ ...prev, startDate: e.target.value }))}
              />
            </td>
          </tr>
          <tr>
            <th>End</th>
            <td>
              <input
                className="pa-input"
                type="date"
                value={dates.endDate}
                onChange={(e) => setDates((prev) => ({ ...prev, endDate: e.target.value }))}
              />
            </td>
          </tr>
          <tr>
            <th>Trial ends</th>
            <td>
              <input
                className="pa-input"
                type="date"
                value={dates.trialEndsAt}
                onChange={(e) => setDates((prev) => ({ ...prev, trialEndsAt: e.target.value }))}
              />
            </td>
          </tr>
          <tr>
            <th>Renewal</th>
            <td>
              <input
                className="pa-input"
                type="date"
                value={dates.renewalDate}
                onChange={(e) => setDates((prev) => ({ ...prev, renewalDate: e.target.value }))}
              />
            </td>
          </tr>
          <tr>
            <th>Amount</th>
            <td>
              {sub.amount} {sub.currency} / {sub.billingCycle}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="pa-toolbar">
        <button
          type="button"
          className="pa-btn pa-btn-secondary"
          disabled={subMutation.isPending}
          onClick={() =>
            subMutation.mutate({
              startDate: dates.startDate || null,
              endDate: dates.endDate || null,
              trialEndsAt: dates.trialEndsAt || null,
              renewalDate: dates.renewalDate || null,
              confirm: true,
            })
          }
        >
          Save dates
        </button>
      </div>

      <h2 style={{ marginTop: 20 }}>Invoices</h2>
      <div className="pa-toolbar">
        <input
          className="pa-input"
          type="number"
          min={0}
          placeholder="Invoice amount"
          value={invoiceAmount}
          onChange={(e) => setInvoiceAmount(e.target.value)}
        />
        <button
          type="button"
          className="pa-btn pa-btn-secondary"
          disabled={!invoiceAmount || invoiceMutation.isPending}
          onClick={() => invoiceMutation.mutate()}
        >
          Create invoice
        </button>
      </div>
      <table className="pa-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Payment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(data.invoices || []).map((inv) => (
            <tr key={inv.id}>
              <td>{inv.invoiceNumber}</td>
              <td>
                {inv.amount} {inv.currency}
              </td>
              <td>{inv.status}</td>
              <td>
                {inv.paymentStatus}
                {!inv.payment?.gatewayConfirmed ? (
                  <div className="pa-muted">Not gateway-confirmed</div>
                ) : null}
              </td>
              <td>
                {inv.status === "DUE" || inv.paymentStatus === "UNPAID" ? (
                  <button
                    type="button"
                    className="pa-btn pa-btn-secondary"
                    onClick={() => {
                      if (window.confirm("Record a manual payment for this invoice?")) {
                        payMutation.mutate(inv.id);
                      }
                    }}
                  >
                    Record manual payment
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data.invoices || []).length === 0 ? (
        <p className="pa-muted">No invoices yet.</p>
      ) : null}

      <h2 style={{ marginTop: 20 }}>Subscription history</h2>
      {(data.history || []).length === 0 ? (
        <p className="pa-muted">No history yet.</p>
      ) : (
        <table className="pa-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>From → To</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row, idx) => (
              <tr key={`${row.action}-${idx}`}>
                <td>{row.action}</td>
                <td>
                  {row.from?.plan || "—"} → {row.to?.plan || "—"} ({row.to?.status || "—"})
                </td>
                <td>{row.at ? new Date(row.at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
