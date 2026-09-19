import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapNflEvent, ReadOnlyKalshiProvider } from "./kalshi";

const raw = (overrides: Record<string, unknown> = {}) => ({
  ticker: "KXNFLGAME-26SEP20WASDAL-WAS",
  event_ticker: "KXNFLGAME-26SEP20WASDAL",
  market_type: "binary" as const,
  title: "Washington wins",
  yes_sub_title: "Washington",
  status: "active",
  occurrence_datetime: "2026-09-20T23:25:00Z",
  updated_time: "2026-08-25T15:33:00Z",
  volume_24h_fp: "1200.75",
  rules_primary: "If Washington wins the WAS Commanders vs DAL Cowboys Pro Football game originally scheduled for Sep 20, 2026, then the market resolves to Yes.",
  rules_secondary: "The following market refers to the team who wins the WAS Commanders vs DAL Cowboys Pro Football game originally scheduled for Sep 20, 2026. If the game ends in a tie, the market will resolve to $0.50 for each team.",
  ...overrides,
});

const pair = () => [raw(), raw({ ticker: "KXNFLGAME-26SEP20WASDAL-DAL", title: "Dallas wins", yes_sub_title: "Dallas", rules_primary: "If Dallas wins the WAS Commanders vs DAL Cowboys Pro Football game originally scheduled for Sep 20, 2026, then the market resolves to Yes." })];

describe("mapNflEvent", () => {
  it("maps exactly two contracts only when event, time, matchup, and outcomes agree", () => {
    const markets = mapNflEvent(pair(), "2026-09-13T12:00:00Z");
    assert.equal(markets.length, 2);
    assert.deepEqual(markets[0].game, { id: "KXNFLGAME-26SEP20WASDAL", awayTeam: "WAS Commanders", homeTeam: "DAL Cowboys", startsAt: "2026-09-20T20:25:00.000Z" });
    assert.equal(markets[0].rules.tieSettlementCents, 50);
    assert.equal(markets[0].volume24h, 1200);
  });

  it("rejects incomplete and contradictory events", () => {
    assert.deepEqual(mapNflEvent([raw()], "2026-09-13T12:00:00Z"), []);
    assert.deepEqual(mapNflEvent(pair().map((market, index) => index ? { ...market, occurrence_datetime: "2026-09-21T00:00:00Z" } : market), "2026-09-13T12:00:00Z"), []);
  });
});

describe("ReadOnlyKalshiProvider", () => {
  it("paginates market discovery and parses fixed-point orderbooks", async () => {
    const calls: string[] = [];
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/orderbook")) return new Response(JSON.stringify({ orderbook_fp: { yes_dollars: [["0.5900", "21.50"]], no_dollars: [["0.3900", "22.75"]] } }));
      const page = url.includes("cursor=next") ? { markets: [pair()[1]], cursor: "" } : { markets: [pair()[0]], cursor: "next" };
      return new Response(JSON.stringify(page));
    };
    const provider = new ReadOnlyKalshiProvider("https://example.test/trade-api/v2", request as typeof fetch);
    const markets = await provider.listEligibleMarkets();
    assert.equal(markets.length, 2);
    assert.ok(calls[1].includes("cursor=next"));
    const orderbook = await provider.getOrderbook(markets[0].ticker);
    assert.deepEqual(orderbook.yesBids, [{ priceCents: 59, quantity: 21 }]);
    assert.deepEqual(orderbook.noBids, [{ priceCents: 39, quantity: 22 }]);
    assert.equal((await provider.getMarketRules(markets[0].ticker)).version, "2026-08-25T15:33:00Z");
  });
});
