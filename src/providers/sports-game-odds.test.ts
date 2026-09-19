import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NflGame } from "@/domain/types";
import { SportsGameOddsProbabilityProvider } from "./sports-game-odds";

const game: NflGame = { id: "KXNFLGAME-26SEP20WASDAL", awayTeam: "WAS Commanders", homeTeam: "DAL Cowboys", startsAt: "2026-09-20T20:25:00Z" };
const byBookmaker = (away: boolean) => ({
  draftkings: { odds: away ? "+135" : "-150", lastUpdatedAt: "2026-09-13T12:00:00Z", available: true },
  fanduel: { odds: away ? "+130" : "-145", lastUpdatedAt: "2026-09-13T12:01:00Z", available: true },
});
const payload = {
  success: true,
  data: [{
    eventID: "event-1", leagueID: "NFL",
    teams: {
      away: { names: { long: "Washington Commanders", medium: "Commanders", short: "WAS" } },
      home: { names: { long: "Dallas Cowboys", medium: "Cowboys", short: "DAL" } },
    },
    status: { startsAt: "2026-09-20T20:25:00Z", started: false, cancelled: false },
    odds: {
      "points-away-game-ml-away": { byBookmaker: byBookmaker(true) },
      "points-home-game-ml-home": { byBookmaker: byBookmaker(false) },
    },
  }],
  nextCursor: null,
};

describe("SportsGameOddsProbabilityProvider", () => {
  it("authenticates by header, maps aliases, and builds a multi-book consensus", async () => {
    let apiKey = "";
    const request = async (_input: string | URL | Request, init?: RequestInit) => {
      apiKey = new Headers(init?.headers).get("x-api-key") ?? "";
      return new Response(JSON.stringify(payload));
    };
    const provider = new SportsGameOddsProbabilityProvider("secret", request as typeof fetch);
    const estimate = await provider.estimate(game, "Washington", new Date());
    assert.equal(apiKey, "secret");
    assert.match(estimate.source, /draftkings,fanduel/);
    assert.ok(estimate.probabilityBps < 5_000);
    assert.ok(estimate.lowerBoundBps < estimate.probabilityBps);
  });

  it("fails closed for ambiguous games", async () => {
    const duplicateRequest = async () => new Response(JSON.stringify({ ...payload, data: [...payload.data, ...payload.data] }));
    await assert.rejects(new SportsGameOddsProbabilityProvider("secret", duplicateRequest as typeof fetch).estimate(game, "Washington", new Date()), /exactly one/);
  });

  it("follows pagination before producing an estimate", async () => {
    let calls = 0;
    const pagedRequest = async () => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1 ? { ...payload, data: [], nextCursor: "more" } : payload));
    };
    const estimate = await new SportsGameOddsProbabilityProvider("secret", pagedRequest as typeof fetch).estimate(game, "Washington", new Date());
    assert.equal(calls, 2);
    assert.ok(estimate.probabilityBps > 0);
  });
});
