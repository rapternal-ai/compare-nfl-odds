import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundedYesFill, executableYesBid, executableYesQuote } from "./pricing";
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

  it("values exits by walking executable Yes bids", () => {
    assert.deepEqual(executableYesBid({ ...book, yesBids: [{ priceCents: 60, quantity: 5 }, { priceCents: 58, quantity: 10 }] }, 10), {
      quantity: 10,
      averagePriceCents: 59,
      totalCostCents: 590,
    });
    assert.equal(executableYesBid(book, 51), null);
  });

  it("partially fills only at or below the limit price", () => {
    assert.deepEqual(boundedYesFill(book, 20, 61), {
      quantity: 10,
      averagePriceCents: 61,
      totalCostCents: 610,
    });
    assert.equal(boundedYesFill(book, 20, 60), null);
  });
});
