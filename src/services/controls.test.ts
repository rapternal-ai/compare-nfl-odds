import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRiskConfig } from "./controls";

const valid = {
  mode: "paper",
  startingBankrollCents: 100_000,
  maxCostPerEntryCents: 1_000,
  maxOpenCostPerGameCents: 2_000,
  maxTotalOpenCostCents: 10_000,
  maxDailyNewCostCents: 5_000,
  maxConcurrentPositions: 8,
  feeCentsPerContract: 1,
};

describe("parseRiskConfig", () => {
  it("coerces numeric form values and accepts ordered limits", () => {
    const parsed = parseRiskConfig({ ...valid, maxConcurrentPositions: "4" });
    assert.equal(parsed.maxConcurrentPositions, 4);
  });

  it("rejects internally inconsistent limits", () => {
    assert.throws(() => parseRiskConfig({ ...valid, maxCostPerEntryCents: 3_000 }), /per-game limit/);
    assert.throws(() => parseRiskConfig({ ...valid, maxDailyNewCostCents: 200_000 }), /starting bankroll/);
  });
});
