import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executableYesQuote } from "./pricing";
import type { Orderbook } from "./types";

const book: Orderbook = {
  ticker: "TEST",
  yesBids: [{ priceCents: 59, quantity: 50 }],
  noBids: [{ priceCents: 39, quantity: 10 }, { priceCents: 37, quantity: 20 }],
  asOf: "2026-09-13T12:00:00Z",
};

describe("executableYesQuote", () => {
  it("walks derived Yes asks across levels", () => {
    assert.deepEqual(executableYesQuote(book, 20), {
      quantity: 20,
      availableQuantity: 30,
      averagePriceCents: 62,
      limitPriceCents: 63,
      totalCostCents: 1_240,
      spreadCents: 2,
    });
  });

  it("refuses insufficient depth", () => {
    assert.equal(executableYesQuote(book, 31), null);
  });
});
