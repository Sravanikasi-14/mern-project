import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hrAdminActionAvailability,
  resolveHrManagementListState,
  validateHrInviteForm,
} from "./companyHrManagementView.js";

describe("Company Admin HR Management view helpers", () => {
  it("validates invitation form fields", () => {
    assert.equal(validateHrInviteForm({}).valid, false);
    assert.ok(validateHrInviteForm({}).errors.fullName);
    assert.ok(validateHrInviteForm({ fullName: "A", email: "bad" }).errors.email);

    const ok = validateHrInviteForm({ fullName: " Pat Admin ", email: "Pat@Acme.test" });
    assert.equal(ok.valid, true);
    assert.equal(ok.values.fullName, "Pat Admin");
    assert.equal(ok.values.email, "pat@acme.test");
  });

  it("resolves loading, empty, error and success list states", () => {
    assert.equal(resolveHrManagementListState({ isLoading: true }).state, "loading");
    assert.equal(
      resolveHrManagementListState({
        isError: true,
        error: { message: "boom" },
      }).state,
      "error"
    );
    assert.equal(resolveHrManagementListState({ data: { items: [] } }).state, "empty");
    assert.equal(
      resolveHrManagementListState({
        data: { items: [{ id: "1" }] },
      }).state,
      "success"
    );
  });

  it("exposes confirmation-relevant action availability", () => {
    const pending = hrAdminActionAvailability({
      isActive: false,
      invitationStatus: "PENDING",
    });
    assert.equal(pending.canResend, true);
    assert.equal(pending.canRevoke, true);
    assert.equal(pending.canDeactivate, false);

    const active = hrAdminActionAvailability({
      isActive: true,
      invitationStatus: "ACCEPTED",
      lastLoginAt: new Date().toISOString(),
    });
    assert.equal(active.canDeactivate, true);
    assert.equal(active.canActivate, false);
    assert.equal(active.canResend, false);
  });
});
