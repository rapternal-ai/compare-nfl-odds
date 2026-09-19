import type { Market, MarketDataProvider, NflGame, Orderbook, ProbabilityEstimate, ProbabilityProvider } from "@/domain/types";

const isoFromNow = (minutes: number, now = new Date()) => new Date(now.getTime() + minutes * 60_000).toISOString();

export function buildFixtures(now = new Date()) {
  const game: NflGame = { id: "BAL-WAS", awayTeam: "Baltimore", homeTeam: "Washington", startsAt: isoFromNow(24 * 60, now) };
  const market = (overrides: Partial<Market> = {}): Market => ({
    ticker: "KXNFLGAME-BALWAS-BAL",
    seriesTicker: "KXNFLGAME",
    title: "Baltimore at Washington winner",
    status: "open",
    game,
    yesOutcome: "Baltimore",
    volume24h: 4_820,
    rulesUrl: "https://kalshi.com/markets/kxnflgame",
    rules: {
      primary: "Resolves Yes if Baltimore wins the recorded game.",
      secondary: "A tie resolves at 50 cents.",
      version: "fixture-v1",
      fetchedAt: now.toISOString(),
      tieSettlementCents: 50,
    },
    ...overrides,
  });
  const orderbook = (ticker: string, overrides: Partial<Orderbook> = {}): Orderbook => ({
    ticker,
    yesBids: [{ priceCents: 59, quantity: 80 }],
    noBids: [{ priceCents: 39, quantity: 40 }, { priceCents: 37, quantity: 100 }],
    asOf: now.toISOString(),
    ...overrides,
  });

  const normal = market();
  const tied = market({ ticker: "KXNFLGAME-GBMIN-GB", title: "Green Bay at Minnesota winner", yesOutcome: "Green Bay", game: { id: "GB-MIN", awayTeam: "Green Bay", homeTeam: "Minnesota", startsAt: isoFromNow(30 * 60, now) } });
  const postponed = market({ ticker: "KXNFLGAME-BUFCIN-BUF", title: "Buffalo at Cincinnati winner", yesOutcome: "Buffalo", status: "closed", game: { id: "BUF-CIN", awayTeam: "Buffalo", homeTeam: "Cincinnati", startsAt: isoFromNow(40 * 60, now) } });
  const ambiguous = market({ ticker: "KXNFLGAME-NYGNYJ-NY", title: "New York matchup winner", yesOutcome: "New York", game: null });
  const stale = market({ ticker: "KXNFLGAME-DALPHI-DAL", title: "Dallas at Philadelphia winner", yesOutcome: "Dallas", game: { id: "DAL-PHI", awayTeam: "Dallas", homeTeam: "Philadelphia", startsAt: isoFromNow(10 * 60, now) } });
  const shallow = market({ ticker: "KXNFLGAME-KCLV-KC", title: "Kansas City at Las Vegas winner", yesOutcome: "Kansas City", game: { id: "KC-LV", awayTeam: "Kansas City", homeTeam: "Las Vegas", startsAt: isoFromNow(20 * 60, now) } });
  const markets = [normal, tied, postponed, ambiguous, stale, shallow];
  const books = new Map(markets.map((item) => [item.ticker, orderbook(item.ticker)]));
  books.set(stale.ticker, orderbook(stale.ticker, { asOf: isoFromNow(-5, now) }));
  books.set(shallow.ticker, orderbook(shallow.ticker, { noBids: [{ priceCents: 39, quantity: 5 }] }));
  return { markets, books };
}

export class FixtureMarketDataProvider implements MarketDataProvider {
  private readonly fixture;
  constructor(now = new Date()) { this.fixture = buildFixtures(now); }
  async listEligibleMarkets() { return this.fixture.markets; }
  async getOrderbook(ticker: string) {
    const book = this.fixture.books.get(ticker);
    if (!book) throw new Error(`Missing orderbook fixture for ${ticker}`);
    return book;
  }
  async getMarketRules(ticker: string) {
    const market = this.fixture.markets.find((item) => item.ticker === ticker);
    if (!market) throw new Error(`Missing rules fixture for ${ticker}`);
    return market.rules;
  }
}

export class FixtureProbabilityProvider implements ProbabilityProvider {
  constructor(private readonly now = new Date()) {}
  async estimate(game: NflGame, outcome: string): Promise<ProbabilityEstimate> {
    return {
      gameId: game.id,
      outcome,
      probabilityBps: game.id === "GB-MIN" ? 6_500 : 7_000,
      lowerBoundBps: game.id === "GB-MIN" ? 6_100 : 6_800,
      source: "licensed-consensus-fixture",
      modelVersion: "vig-normalized-v1",
      asOf: this.now.toISOString(),
    };
  }
}
