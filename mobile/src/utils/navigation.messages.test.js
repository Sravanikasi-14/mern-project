import assert from "node:assert/strict";
import { resolveMobileFallback, isTabRootPath } from "./navigation.js";

assert.equal(resolveMobileFallback("/app/messages"), "/app/more");
assert.equal(resolveMobileFallback("/app/messages/abc123"), "/app/messages");
assert.equal(resolveMobileFallback("/admin/messages"), "/admin/more");
assert.equal(resolveMobileFallback("/admin/messages/abc123"), "/admin/messages");
assert.equal(resolveMobileFallback("/company/messages"), "/company");
assert.equal(resolveMobileFallback("/company/messages/abc123"), "/company/messages");
assert.equal(resolveMobileFallback("/company/organization"), "/company");
assert.equal(resolveMobileFallback("/company/hr-admins"), "/company");
assert.equal(isTabRootPath("/company"), true);

console.log("navigation.messages.test.js: ok");
