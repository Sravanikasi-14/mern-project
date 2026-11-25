import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CHAT_LIST_POLL_MS,
  chatPollIntervalMs,
  resetChatPollActivityForTests,
} from "./chatPollInterval.js";
import { isPermanentPlatformEntitlementError } from "./platformEntitlementError.js";

const root = dirname(fileURLToPath(import.meta.url));
const useChatQueries = readFileSync(join(root, "../hooks/useChatQueries.js"), "utf8");
const sidebarSrc = readFileSync(join(root, "../components/Sidebar.jsx"), "utf8");

describe("F66 chat polling helpers", () => {
  it("pauses polling when the document is hidden", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "hidden", addEventListener() {} };
    try {
      assert.equal(chatPollIntervalMs(10_000, {}), false);
    } finally {
      globalThis.document = prev;
    }
  });

  it("returns base interval when visible and recently active", () => {
    const prev = globalThis.document;
    globalThis.document = {
      visibilityState: "visible",
      addEventListener() {},
    };
    try {
      resetChatPollActivityForTests(Date.now());
      assert.equal(chatPollIntervalMs(10_000, {}), 10_000);
      assert.equal(chatPollIntervalMs(30_000, {}), 30_000);
    } finally {
      globalThis.document = prev;
    }
  });

  it("applies idle backoff when visible but inactive", () => {
    const prev = globalThis.document;
    globalThis.document = {
      visibilityState: "visible",
      addEventListener() {},
    };
    try {
      resetChatPollActivityForTests(Date.now() - 120_000);
      assert.equal(chatPollIntervalMs(10_000, {}), 30_000);
      assert.equal(chatPollIntervalMs(CHAT_LIST_POLL_MS, {}), 90_000);
    } finally {
      globalThis.document = prev;
    }
  });

  it("useChatQueries wires visibility-aware poll + no background interval", () => {
    assert.match(useChatQueries, /chatPollIntervalMs/);
    assert.match(useChatQueries, /CHAT_LIST_POLL_MS/);
    assert.match(useChatQueries, /limit: CONVERSATION_LIST_LIMIT/);
    const bgFlags = useChatQueries.match(/refetchIntervalInBackground:\s*false/g) || [];
    assert.ok(bgFlags.length >= 3);
  });

  it("stops unread refetchInterval on permanent platform entitlement 403", () => {
    const entitlementHelper = readFileSync(
      join(root, "platformEntitlementError.js"),
      "utf8"
    );
    assert.match(useChatQueries, /isPermanentPlatformEntitlementError/);
    assert.match(useChatQueries, /query\.state\.error/);
    assert.match(entitlementHelper, /PLATFORM_MODULE_DISABLED/);
    assert.match(entitlementHelper, /PLATFORM_FEATURE_DISABLED/);
    assert.equal(
      isPermanentPlatformEntitlementError({
        response: { status: 403, data: { code: "PLATFORM_MODULE_DISABLED" } },
      }),
      true
    );
    assert.equal(
      isPermanentPlatformEntitlementError({
        response: { status: 403, data: { code: "PLATFORM_FEATURE_DISABLED" } },
      }),
      true
    );
    assert.equal(
      isPermanentPlatformEntitlementError({
        response: { status: 403, data: { code: "OTHER" } },
      }),
      false
    );
    assert.equal(
      isPermanentPlatformEntitlementError({
        response: { status: 500, data: { code: "PLATFORM_MODULE_DISABLED" } },
      }),
      false
    );
  });

  it("Sidebar gates unread poll and withMessages on chat entitlement", () => {
    assert.match(sidebarSrc, /platformModuleAllowed\(company,\s*"chat"\)/);
    assert.match(sidebarSrc, /chatEntitled/);
    assert.match(sidebarSrc, /chatEntitled\s*\?\s*withMessages/);
  });
});
