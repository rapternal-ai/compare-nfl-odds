import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultStrategy } from "./config";
import { decideCandidate } from "./decision";
import { buildFixtures } from "@/providers/fixtures";
import type { ProbabilityEstimate } from "./types";

const now = new Date("2026-09-13T12:00:00Z");
const probability: ProbabilityEstimate = {
  gameId: "BAL-WAS", outcome: "Baltimore", probabilityBps: 7_000, lowerBoundBps: 6_800,
  source: "test", modelVersion: "v1", asOf: now.toISOString(),
};

describe("decideCandidate", () => {
  it("trades only when executable net edge clears every check", () => {
    const fixture = buildFixtures(now);
    const market = fixture.markets[0];
    const result = decideCandidate({ market, orderbook: fixture.books.get(market.ticker)!, probability, config: defaultStrategy, now });
    assert.equal(result.action, "TRADE");
    assert.equal(result.netEdgeBps, 600);
  });

  it("rejects a favorable displayed probability when executable costs erase the edge", () => {
    const fixture = buildFixtures(now);
    const market = fixture.markets[0];
    const result = decideCandidate({ market, orderbook: { ...fixture.books.get(market.ticker)!, noBids: [{ priceCents: 35, quantity: 30 }] }, probability: { ...probability, lowerBoundBps: 7_000 }, config: { ...defaultStrategy, feeCentsPerContract: 2 }, now });
    assert.equal(result.action, "NO_TRADE");
    assert.ok(result.reasons.includes("Net edge is below the configured minimum"));
  });

  it("fails closed for stale, postponed, ambiguous, and shallow markets", () => {
    const fixture = buildFixtures(now);
    for (const market of fixture.markets.slice(2)) {
      const result = decideCandidate({ market, orderbook: fixture.books.get(market.ticker)!, probability: market.game ? { ...probability, gameId: market.game.id } : null, config: defaultStrategy, now });
      assert.equal(result.action, "NO_TRADE");
    }
  });
});
