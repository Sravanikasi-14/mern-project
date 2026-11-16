import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { chatPollIntervalMs } from "./chatPollInterval.js";

const root = dirname(fileURLToPath(import.meta.url));
const useChatQueries = readFileSync(join(root, "../hooks/useChatQueries.js"), "utf8");

describe("F66 chat polling helpers", () => {
  it("pauses polling when the document is hidden", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "hidden" };
    try {
      assert.equal(chatPollIntervalMs(10_000, {}), false);
    } finally {
      globalThis.document = prev;
    }
  });

  it("returns base interval when visible", () => {
    const prev = globalThis.document;
    globalThis.document = { visibilityState: "visible" };
    try {
      assert.equal(chatPollIntervalMs(10_000, {}), 10_000);
      assert.equal(chatPollIntervalMs(30_000, {}), 30_000);
    } finally {
      globalThis.document = prev;
    }
  });

  it("useChatQueries wires visibility-aware poll + no background interval", () => {
    assert.match(useChatQueries, /chatPollIntervalMs/);
    const bgFlags = useChatQueries.match(/refetchIntervalInBackground:\s*false/g) || [];
    assert.ok(bgFlags.length >= 3);
  });
});
