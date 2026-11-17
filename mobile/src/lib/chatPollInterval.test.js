import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_LIST_POLL_MS,
  chatPollIntervalMs,
  resetChatPollActivityForTests,
} from "./chatPollInterval.js";

describe("F66 mobile chat polling helpers", () => {
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
    globalThis.document = { visibilityState: "visible", addEventListener() {} };
    try {
      resetChatPollActivityForTests(Date.now());
      assert.equal(chatPollIntervalMs(CHAT_LIST_POLL_MS, {}), CHAT_LIST_POLL_MS);
    } finally {
      globalThis.document = prev;
    }
  });

  it("applies idle backoff when visible but inactive", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "visible", addEventListener() {} };
    try {
      resetChatPollActivityForTests(Date.now() - 120_000);
      assert.equal(chatPollIntervalMs(10_000, {}), 30_000);
    } finally {
      globalThis.document = prev;
    }
  });
});
