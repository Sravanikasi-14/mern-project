import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPayrollPayloadIsAggregateOnly,
  isModuleEmpty,
  resolveCompanyAdminDashboardViewState,
} from "./companyAdminDashboardView.js";

describe("Company Admin dashboard view states", () => {
  it("resolves loading when fetching without cached data", () => {
    const view = resolveCompanyAdminDashboardViewState({ isLoading: true, data: null });
    assert.equal(view.state, "loading");
  });

  it("resolves error when request fails without cached data", () => {
    const view = resolveCompanyAdminDashboardViewState({
      isLoading: false,
      isError: true,
      data: null,
      error: { message: "Network down" },
    });
    assert.equal(view.state, "error");
    assert.match(view.message, /Network down/);
  });

  it("resolves success when payload is present", () => {
    const view = resolveCompanyAdminDashboardViewState({
      isLoading: false,
      isError: false,
      data: { overview: { activeEmployeeCount: 2 } },
    });
    assert.equal(view.state, "success");
  });

  it("marks empty modules without fabricating content", () => {
    const empty = {
      leave: { available: true, total: 0 },
      payroll: { available: true, hasCycle: false },
      assets: { available: true, total: 0 },
      recentActivity: [],
      attendance: { available: false },
    };
    assert.equal(isModuleEmpty("leave", empty), true);
    assert.equal(isModuleEmpty("payroll", empty), true);
    assert.equal(isModuleEmpty("assets", empty), true);
    assert.equal(isModuleEmpty("activity", empty), true);
    assert.equal(isModuleEmpty("attendance", empty), true);
  });

  it("rejects payroll payloads that expose sensitive employee details", () => {
    assert.equal(
      assertPayrollPayloadIsAggregateOnly({
        hasCycle: true,
        totalNetPayable: 1000,
        paymentStatus: "PAID",
      }),
      true
    );
    assert.equal(
      assertPayrollPayloadIsAggregateOnly({
        totalNetPayable: 1000,
        monthlySalary: 50000,
      }),
      false
    );
  });
});
