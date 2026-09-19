import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultRisk } from "./config";
import { executePaperEntry, type AccountState } from "./portfolio";
import type { CandidateDecision, ExecutableQuote } from "./types";

const decision: CandidateDecision = {
  ticker: "KXNFLGAME-TEST-A",
  matchup: "Away at Home",
  startsAt: "2026-09-20T20:00:00.000Z",
  action: "TRADE",
  reasons: [],
  quote: null,
  probability: null,
  netEdgeBps: 600,
  expectedValueCents: 10,
  marketAsOf: "2026-09-18T12:00:00.000Z",
  rulesUrl: "test",
};
const quote: ExecutableQuote = {
  quantity: 20,
  availableQuantity: 20,
  averagePriceCents: 40,
  limitPriceCents: 40,
  totalCostCents: 800,
  spreadCents: 2,
};
const account: AccountState = {
  cashCents: 10_000,
  positions: [],
  gameCostCents: 0,
  dayCostCents: 0,
  dayStartsAt: "2026-09-18T00:00:00.000Z",
};

describe("executePaperEntry", () => {
  it("creates a stable decision key for idempotent execution", () => {
    const result = executePaperEntry(decision, quote, defaultRisk, account, new Date("2026-09-18T12:01:00.000Z"));
    assert.equal(result.rejection, null);
    assert.equal(result.order?.decisionKey, `${decision.ticker}:${decision.marketAsOf}`);
    assert.equal(result.fill?.quantity, 20);
  });

  it("rejects entries that breach an atomic risk limit", () => {
    const result = executePaperEntry(decision, quote, { ...defaultRisk, maxCostPerEntryCents: 500 }, account, new Date("2026-09-18T12:01:00.000Z"));
    assert.match(result.rejection ?? "", /exceeds max cost per entry/);
    assert.equal(result.order, null);
  });
});
