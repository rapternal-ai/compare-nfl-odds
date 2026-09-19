import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { americanImpliedProbability, consensusProbability, normalizeTwoWayMoneyline, type SportsbookMoneyline } from "./sportsbook";

const quote: SportsbookMoneyline = { bookmaker: "test", awayTeam: "Away", homeTeam: "Home", startsAt: "2026-09-20T20:00:00Z", awayAmerican: -150, homeAmerican: 130, asOf: "2026-09-13T12:00:00Z", settlement: "kalshi-compatible" };

describe("sportsbook normalization", () => {
  it("converts positive and negative American odds", () => {
    assert.equal(americanImpliedProbability(-150).toFixed(4), "0.6000");
    assert.equal(americanImpliedProbability(150).toFixed(4), "0.4000");
  });

  it("removes two-way overround proportionally", () => {
    const normalized = normalizeTwoWayMoneyline(quote);
    assert.equal(normalized.awayProbabilityBps + normalized.homeProbabilityBps, 10_000);
    assert.ok(normalized.overroundBps > 0);
  });

  it("rejects settlement mismatches", () => {
    assert.throws(() => normalizeTwoWayMoneyline({ ...quote, settlement: "different" }), /not comparable/);
  });

  it("builds a conservative lower bound from consensus dispersion", () => {
    const result = consensusProbability([6_000, 6_200, 6_100]);
    assert.equal(result.probabilityBps, 6_100);
    assert.equal(result.lowerBoundBps, 5_900);
  });
});
