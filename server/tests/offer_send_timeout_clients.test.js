process.env.NODE_ENV = "test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Offer send client timeout configuration (P0)", () => {
  it("desktop and mobile expose a 120s send-specific timeout without changing global 30s", () => {
    const desktopApi = fs.readFileSync(
      path.join(root, "client", "src", "services", "api.js"),
      "utf8"
    );
    const mobileApi = fs.readFileSync(
      path.join(root, "mobile", "src", "services", "api.js"),
      "utf8"
    );

    for (const [label, src] of [
      ["desktop", desktopApi],
      ["mobile", mobileApi],
    ]) {
      assert.ok(src.includes("timeout: 30000"), `${label} keeps global 30s timeout`);
      assert.ok(
        src.includes("OFFER_LETTER_SEND_TIMEOUT_MS = 120000"),
        `${label} defines 120s offer send timeout`
      );
      assert.ok(src.includes("postOfferLetterSend"), `${label} exports postOfferLetterSend`);
      assert.ok(
        src.includes("timeout: OFFER_LETTER_SEND_TIMEOUT_MS"),
        `${label} applies send-specific timeout`
      );
      assert.ok(src.includes("isRequestTimeoutError"), `${label} exports timeout helper`);
    }
  });

  it("desktop and mobile offer UIs call postOfferLetterSend for send/resend", () => {
    const desktopPage = fs.readFileSync(
      path.join(root, "client", "src", "pages", "OfferLettersManagement.jsx"),
      "utf8"
    );
    const mobilePage = fs.readFileSync(
      path.join(root, "mobile", "src", "pages", "hr", "OffersPage.jsx"),
      "utf8"
    );

    assert.ok(desktopPage.includes("postOfferLetterSend"));
    assert.ok(desktopPage.includes("sendInFlightRef"));
    assert.ok(desktopPage.includes("isRequestTimeoutError"));
    assert.ok(mobilePage.includes("postOfferLetterSend"));
    assert.ok(mobilePage.includes("submitLock"));
    assert.ok(mobilePage.includes("isRequestTimeoutError"));
    assert.ok(
      mobilePage.includes('selected.status === "SENT"'),
      "mobile exposes resend for SENT offers (not only DELIVERY_FAILED)"
    );
    assert.ok(
      desktopPage.includes('type: "SEND_EMAIL"') && desktopPage.includes("Resend"),
      "desktop exposes Resend for SENT offers"
    );
  });
});
