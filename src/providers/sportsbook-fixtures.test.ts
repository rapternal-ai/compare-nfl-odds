import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NflGame } from "@/domain/types";
import { buildSportsbookFixtures, SportsbookFixtureProbabilityProvider } from "./sportsbook-fixtures";

const game: NflGame = { id: "A-H", awayTeam: "Away", homeTeam: "Home", startsAt: "2026-09-20T20:00:00Z" };

describe("SportsbookFixtureProbabilityProvider", () => {
  it("strictly maps a game and excludes incompatible settlement rules", async () => {
    const provider = new SportsbookFixtureProbabilityProvider(buildSportsbookFixtures(game, new Date("2026-09-13T12:00:00Z")));
    const estimate = await provider.estimate(game, "Away", new Date());
    assert.match(estimate.source, /book-a,book-b/);
    assert.doesNotMatch(estimate.source, /incompatible-book/);
    assert.ok(estimate.lowerBoundBps < estimate.probabilityBps);
  });

  it("rejects mismatched outcomes and games with fewer than two books", async () => {
    const quotes = buildSportsbookFixtures(game).slice(0, 1);
    await assert.rejects(new SportsbookFixtureProbabilityProvider(quotes).estimate(game, "Other", new Date()), /Outcome/);
    await assert.rejects(new SportsbookFixtureProbabilityProvider(quotes).estimate(game, "Away", new Date()), /At least two/);
  });
});
