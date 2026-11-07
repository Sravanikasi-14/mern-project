import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_RESTRICTED_MESSAGE,
  announceAccessRestricted,
  dismissAccessNotice,
  isHrPermissionDenial,
  resetAccessNoticeForTests,
  setAccessSnapshot,
  shouldAnnouncePermissionDenial,
  subscribeAccessNotice,
} from "./accessNotice.js";

test("only an enforced HR Admin permission denial is recognized", () => {
  resetAccessNoticeForTests();
  const denied = {
    response: { status: 403, data: { code: "HR_PERMISSION_DENIED", message: "Missing payroll.calculate" } },
    config: { method: "post" },
  };
  setAccessSnapshot({ role: "COMPANY_ADMIN" }, { hrAccessEnforcement: { mode: "ENFORCED" } });
  assert.equal(isHrPermissionDenial(denied), false);
  setAccessSnapshot({ role: "HR_ADMIN" }, { hrAccessEnforcement: { mode: "OFF" } });
  assert.equal(isHrPermissionDenial(denied), false);
  setAccessSnapshot({ role: "EMPLOYEE" }, { hrAccessEnforcement: { mode: "ENFORCED" } });
  assert.equal(isHrPermissionDenial(denied), false);
  setAccessSnapshot({ role: "HR_ADMIN" }, { hrAccessEnforcement: { mode: "ENFORCED" } });
  assert.equal(isHrPermissionDenial(denied), true);
});

test("background reads stay quiet and repeated action denials collapse", () => {
  resetAccessNoticeForTests();
  setAccessSnapshot({ role: "HR_ADMIN" }, { hrAccessEnforcement: { mode: "ENFORCED" } });
  const read = {
    response: { status: 403, data: { code: "HR_SCOPE_DENIED" } },
    config: { method: "get" },
  };
  const write = {
    response: { status: 403, data: { code: "HR_PERMISSION_DENIED" } },
    config: { method: "post" },
  };
  assert.equal(shouldAnnouncePermissionDenial(read), false);
  assert.equal(shouldAnnouncePermissionDenial(write), true);
  const seen = [];
  subscribeAccessNotice((notice) => seen.push(notice ? notice.message : null));
  assert.equal(announceAccessRestricted(), true);
  assert.equal(announceAccessRestricted(), false);
  assert.deepEqual(seen, [ACCESS_RESTRICTED_MESSAGE]);
  dismissAccessNotice();
  assert.equal(announceAccessRestricted(), true);
  assert.deepEqual(seen, [ACCESS_RESTRICTED_MESSAGE, null, ACCESS_RESTRICTED_MESSAGE]);
});
