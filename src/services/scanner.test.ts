import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixtureMarketDataProvider, FixtureProbabilityProvider } from "@/providers/fixtures";
import { scanMarkets } from "./scanner";

describe("scanMarkets", () => {
  it("produces an auditable decision for every discovered fixture", async () => {
    const now = new Date("2026-09-13T12:00:00Z");
    const decisions = await scanMarkets({ marketData: new FixtureMarketDataProvider(now), probabilities: new FixtureProbabilityProvider(now), now });
    assert.equal(decisions.length, 6);
    assert.ok(decisions.every((decision) => decision.reasons.length > 0));
    assert.ok(decisions.some(({ action }) => action === "TRADE"));
    assert.ok(decisions.some(({ action }) => action === "NO_TRADE"));
  });
});
