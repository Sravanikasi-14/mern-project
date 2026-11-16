import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, GitCompareArrows } from "lucide-react";
import platformApi from "../../services/platformApi";
import { PaAlert, PaPageHeader } from "../../components/platform/paUi";

const EMPTY_FORM = {
  code: "",
  name: "",
  description: "",
  modulesAll: true,
  includedModules: [],
  maxEmployeeSeats: 25,
  maxStorageMb: 0,
  amount: 0,
  currency: "INR",
  billingCycle: "MONTHLY",
  trialDays: 0,
  isActive: true,
};

export default function PlatformPlans() {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showCompare, setShowCompare] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: async () => (await platformApi.get("/platform/plans")).data,
  });

  const compareQuery = useQuery({
    queryKey: ["platform", "plans", "comparison"],
    queryFn: async () => (await platformApi.get("/platform/plans/comparison")).data,
    enabled: showCompare,
  });

  const modulesQuery = useQuery({
    queryKey: ["platform", "modules"],
    queryFn: async () => (await platformApi.get("/platform/modules")).data,
  });

  const catalogModules = useMemo(
    () => (modulesQuery.data?.catalog?.modules || []).map((m) => m.key),
    [modulesQuery.data]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing?.id) {
        return (
          await platformApi.patch(`/platform/plans/${editing.id}`, {
            ...form,
            confirm: true,
          })
        ).data;
      }
      return (await platformApi.post("/platform/plans", form)).data;
    },
    onSuccess: () => {
      setMessage(editing ? "Plan updated." : "Plan created.");
      setError("");
      setEditing(null);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ["platform", "plans"] });
    },
    onError: (err) => setError(err?.response?.data?.message || "Save failed."),
  });

  const toggleActive = async (plan) => {
    setError("");
    if (
      plan.isActive &&
      !window.confirm(
        `Deactivate plan ${plan.code}? Existing subscribers keep entitlements; new assignments will be blocked.`
      )
    ) {
      return;
    }
    try {
      await platformApi.patch(`/platform/plans/${plan.id}`, {
        isActive: !plan.isActive,
        confirm: true,
      });
      qc.invalidateQueries({ queryKey: ["platform", "plans"] });
      setMessage(plan.isActive ? "Plan deactivated." : "Plan activated.");
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to change plan status.");
    }
  };

  const startEdit = (plan) => {
    setEditing(plan);
    setForm({
      code: plan.code,
      name: plan.name,
      description: plan.description || "",
      modulesAll: plan.modulesAll,
      includedModules: plan.modulesAll ? [] : [...(plan.includedModules || [])],
      maxEmployeeSeats: plan.maxEmployeeSeats,
      maxStorageMb: plan.maxStorageMb || 0,
      amount: plan.amount || 0,
      currency: plan.currency || "INR",
      billingCycle: plan.billingCycle || "NONE",
      trialDays: plan.trialDays || 0,
      isActive: plan.isActive,
    });
  };

  return (
    <div>
      <PaPageHeader
        title="Plans & Billing"
        description="Centrally managed plans drive subscription entitlements. No live payment gateway — invoices support manual payment recording only."
        actions={
          <>
            <button
              type="button"
              className="pa-btn pa-btn-primary"
              onClick={() => {
                setEditing({});
                setForm(EMPTY_FORM);
              }}
            >
              <Plus size={16} strokeWidth={2} /> New plan
            </button>
            <button
              type="button"
              className="pa-btn pa-btn-secondary"
              onClick={() => setShowCompare((v) => !v)}
            >
              <GitCompareArrows size={16} strokeWidth={2} />{" "}
              {showCompare ? "Hide comparison" : "Compare plans"}
            </button>
          </>
        }
      />

      {message ? <PaAlert tone="success">{message}</PaAlert> : null}
      {error ? <PaAlert tone="error">{error}</PaAlert> : null}

      {editing ? (
        <div className="pa-panel">
          <h2>{editing.id ? `Edit ${editing.code}` : "Create plan"}</h2>
          <div className="pa-form-grid">
            {!editing.id ? (
              <div className="pa-field">
                <label>Code</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  required
                />
              </div>
            ) : null}
            <div className="pa-field">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="pa-field">
              <label>Max employees</label>
              <input
                type="number"
                min={1}
                value={form.maxEmployeeSeats}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxEmployeeSeats: Number(e.target.value) }))
                }
              />
            </div>
            <div className="pa-field">
              <label>Storage limit (MB, 0 = unlimited)</label>
              <input
                type="number"
                min={0}
                value={form.maxStorageMb}
                onChange={(e) => setForm((f) => ({ ...f, maxStorageMb: Number(e.target.value) }))}
              />
            </div>
            <div className="pa-field">
              <label>Amount</label>
              <input
                type="number"
                min={0}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))}
              />
            </div>
            <div className="pa-field">
              <label>Currency</label>
              <input
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="pa-field">
              <label>Billing cycle</label>
              <select
                value={form.billingCycle}
                onChange={(e) => setForm((f) => ({ ...f, billingCycle: e.target.value }))}
              >
                <option value="NONE">None</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
            <div className="pa-field">
              <label>Trial days</label>
              <input
                type="number"
                min={0}
                value={form.trialDays}
                onChange={(e) => setForm((f) => ({ ...f, trialDays: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="pa-field" style={{ marginTop: 12 }}>
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={form.modulesAll}
              onChange={(e) => setForm((f) => ({ ...f, modulesAll: e.target.checked }))}
            />
            Include all modules
          </label>
          {!form.modulesAll ? (
            <div className="pa-form-grid" style={{ marginTop: 12 }}>
              {catalogModules.map((key) => (
                <label key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={form.includedModules.includes(key)}
                    onChange={(e) => {
                      setForm((f) => ({
                        ...f,
                        includedModules: e.target.checked
                          ? [...f.includedModules, key]
                          : f.includedModules.filter((k) => k !== key),
                      }));
                    }}
                  />
                  {key}
                </label>
              ))}
            </div>
          ) : null}
          <div className="pa-toolbar" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="pa-btn pa-btn-primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save plan"}
            </button>
            <button
              type="button"
              className="pa-btn pa-btn-secondary"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showCompare ? (
        <div className="pa-panel">
          <h2>Plan comparison</h2>
          {!compareQuery.data ? (
            <p className="pa-muted">Loading…</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="pa-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    {compareQuery.data.plans.map((p) => (
                      <th key={p.id}>
                        {p.name}
                        <div className="pa-muted">
                          {p.amount} {p.currency}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(compareQuery.data.modules || []).map((mod) => (
                    <tr key={mod}>
                      <td>{mod}</td>
                      {compareQuery.data.plans.map((p) => (
                        <td key={p.id}>{p.modules[mod] ? "✓" : "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <div className="pa-panel">
        <h2>Plans</h2>
        {isLoading ? <p className="pa-muted">Loading…</p> : null}
        <table className="pa-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Seats</th>
              <th>Price</th>
              <th>Companies</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.plans || []).map((plan) => (
              <tr key={plan.id}>
                <td>
                  <strong>{plan.name}</strong>
                  <div className="pa-muted">{plan.code}</div>
                </td>
                <td>{plan.maxEmployeeSeats}</td>
                <td>
                  {plan.amount} {plan.currency} / {plan.billingCycle}
                </td>
                <td>{plan.companyCount ?? 0}</td>
                <td>
                  <span className={`pa-badge${plan.isActive ? "" : " is-danger"}`}>
                    {plan.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <div className="pa-toolbar">
                    <button
                      type="button"
                      className="pa-btn pa-btn-secondary"
                      onClick={() => startEdit(plan)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="pa-btn pa-btn-secondary"
                      onClick={() => toggleActive(plan)}
                    >
                      {plan.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
