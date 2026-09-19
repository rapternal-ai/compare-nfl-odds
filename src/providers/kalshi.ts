import Decimal from "decimal.js";
import { z } from "zod";
import type { Market, MarketDataProvider, MarketRules, MarketStatus, Orderbook } from "@/domain/types";

const rawMarketSchema = z.object({
  ticker: z.string().min(1),
  event_ticker: z.string().min(1),
  market_type: z.literal("binary"),
  title: z.string().optional().default(""),
  yes_sub_title: z.string().min(1),
  status: z.string(),
  occurrence_datetime: z.string().datetime(),
  updated_time: z.string().datetime(),
  volume_24h_fp: z.string(),
  rules_primary: z.string().min(1),
  rules_secondary: z.string().min(1),
});

const marketsResponseSchema = z.object({
  markets: z.array(rawMarketSchema),
  cursor: z.string(),
});

const fixedPointLevel = z.tuple([z.string(), z.string()]);
const orderbookResponseSchema = z.object({
  orderbook_fp: z.object({
    yes_dollars: z.array(fixedPointLevel).nullable(),
    no_dollars: z.array(fixedPointLevel).nullable(),
  }),
});

type RawMarket = z.infer<typeof rawMarketSchema>;
type Fetch = typeof fetch;

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
const retryDelayMs = (headers: Headers, attempt: number) => {
  const header = headers.get("retry-after");
  if (!header) return Math.min(250 * 2 ** attempt, 2_000);
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1_000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return Math.min(250 * 2 ** attempt, 2_000);
};

const MATCHUP_PATTERN = /wins the (.+?) vs (.+?) Pro Football game originally scheduled for ([A-Z][a-z]{2} \d{1,2}, \d{4})/;

function statusOf(status: string): MarketStatus {
  if (status === "active") return "open";
  if (status === "initialized" || status === "inactive") return "paused";
  return "closed";
}

function rulesOf(raw: RawMarket, fetchedAt: string): MarketRules {
  const tie = raw.rules_secondary.match(/tie, the market will resolve to \$(0\.\d+)/i)?.[1];
  return {
    primary: raw.rules_primary,
    secondary: raw.rules_secondary,
    version: raw.updated_time,
    fetchedAt,
    tieSettlementCents: tie ? new Decimal(tie).times(100).toNumber() : null,
  };
}

export function mapNflEvent(rawMarkets: RawMarket[], fetchedAt: string): Market[] {
  if (rawMarkets.length !== 2) return [];
  const [first, second] = rawMarkets;
  if (first.event_ticker !== second.event_ticker || first.ticker === second.ticker) return [];
  if (first.occurrence_datetime !== second.occurrence_datetime) return [];
  if (first.yes_sub_title === second.yes_sub_title) return [];

  const firstMatch = first.rules_secondary.match(MATCHUP_PATTERN);
  const secondMatch = second.rules_secondary.match(MATCHUP_PATTERN);
  if (!firstMatch || !secondMatch || firstMatch.slice(1).join("|") !== secondMatch.slice(1).join("|")) return [];
  if (!first.rules_primary.startsWith(`If ${first.yes_sub_title} wins the `)) return [];
  if (!second.rules_primary.startsWith(`If ${second.yes_sub_title} wins the `)) return [];

  const [, awayTeam, homeTeam] = firstMatch;
  return rawMarkets.map((raw) => ({
    ticker: raw.ticker,
    seriesTicker: "KXNFLGAME",
    title: raw.title || `${raw.yes_sub_title} wins`,
    status: statusOf(raw.status),
    game: {
      id: raw.event_ticker,
      awayTeam,
      homeTeam,
      startsAt: new Date(new Date(raw.occurrence_datetime).getTime() - 3 * 60 * 60_000).toISOString(),
    },
    yesOutcome: raw.yes_sub_title,
    volume24h: new Decimal(raw.volume_24h_fp).floor().toNumber(),
    rulesUrl: `${raw.ticker}`,
    rules: rulesOf(raw, fetchedAt),
  }));
}

export class ReadOnlyKalshiProvider implements MarketDataProvider {
  private readonly rules = new Map<string, MarketRules>();

  constructor(
    private readonly baseUrl: string,
    private readonly request: Fetch = fetch,
    private readonly maxPages = 10,
    private readonly maxRetries = 3,
    private readonly gameFilter?: string,
    private readonly startsWithinHours?: number,
  ) {}

  private async getJson(url: string) {
    let lastError = "";
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const response = await this.request(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (response.ok) return response.json();
      lastError = `Kalshi request failed: ${response.status}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries - 1) {
        await delay(retryDelayMs(response.headers, attempt));
        continue;
      }
      throw new Error(lastError);
    }
    throw new Error(lastError);
  }

  async listEligibleMarkets(): Promise<Market[]> {
    const grouped = new Map<string, RawMarket[]>();
    let cursor = "";
    const fetchedAt = new Date().toISOString();

    for (let page = 0; page < this.maxPages; page += 1) {
      const query = new URLSearchParams({ series_ticker: "KXNFLGAME", status: "open", mve_filter: "exclude", limit: "1000" });
      if (cursor) query.set("cursor", cursor);
      const parsed = marketsResponseSchema.parse(await this.getJson(`${this.baseUrl}/markets?${query}`));
      for (const raw of parsed.markets) grouped.set(raw.event_ticker, [...(grouped.get(raw.event_ticker) ?? []), raw]);
      cursor = parsed.cursor;
      if (!cursor) break;
      if (page === this.maxPages - 1) throw new Error("Kalshi pagination exceeded the configured page limit");
    }

    const terms = this.gameFilter?.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const nameFilter = terms?.length
      ? (market: Market) => terms.some(
        (term) => market.game?.awayTeam.toLowerCase().includes(term) || market.game?.homeTeam.toLowerCase().includes(term),
      )
      : () => true;
    const deadline = this.startsWithinHours
      ? new Date(new Date(fetchedAt).getTime() + this.startsWithinHours * 60 * 60_000).toISOString()
      : null;
    const timeFilter = (market: Market) => !deadline || (market.game && market.game.startsAt >= fetchedAt && market.game.startsAt <= deadline);
    const markets = [...grouped.values()].flatMap((event) => mapNflEvent(event, fetchedAt)).filter(nameFilter).filter(timeFilter);
    for (const market of markets) this.rules.set(market.ticker, market.rules);
    return markets;
  }

  async getOrderbook(ticker: string): Promise<Orderbook> {
    const parsed = orderbookResponseSchema.parse(await this.getJson(`${this.baseUrl}/markets/${encodeURIComponent(ticker)}/orderbook?depth=100`));
    const levels = (items: [string, string][] | null) => (items ?? []).map(([price, quantity]) => ({
      priceCents: new Decimal(price).times(100).toNumber(),
      quantity: new Decimal(quantity).floor().toNumber(),
    }));
    return {
      ticker,
      yesBids: levels(parsed.orderbook_fp.yes_dollars),
      noBids: levels(parsed.orderbook_fp.no_dollars),
      asOf: new Date().toISOString(),
    };
  }

  async getMarketRules(ticker: string): Promise<MarketRules> {
    const rules = this.rules.get(ticker);
    if (!rules) throw new Error(`Rules are unavailable before market discovery: ${ticker}`);
    return rules;
  }
}
