import type { CandidateDecision, MarketDataProvider, ScanRecord } from "@/domain/types";
import { FixtureMarketDataProvider, FixtureProbabilityProvider } from "@/providers/fixtures";
import { ReadOnlyKalshiProvider } from "@/providers/kalshi";
import { SportsGameOddsProbabilityProvider } from "@/providers/sports-game-odds";
import { UnavailableProbabilityProvider } from "@/providers/unavailable-probability";
import { scanMarketsDetailed } from "./scanner";

export interface ScanResult {
  candidates: CandidateDecision[];
  records: ScanRecord[];
  marketData: MarketDataProvider;
  source: "fixtures" | "kalshi";
  warning: string | null;
}

export async function loadCandidates(now = new Date()): Promise<ScanResult> {
  if (process.env.MARKET_DATA_SOURCE !== "kalshi") {
    const marketData = new FixtureMarketDataProvider(now);
    const records = await scanMarketsDetailed({ marketData, probabilities: new FixtureProbabilityProvider(now), now });
    return {
      candidates: records.map(({ decision }) => decision),
      records,
      marketData,
      source: "fixtures",
      warning: null,
    };
  }

  const baseUrl = process.env.KALSHI_API_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2";
  const gameFilter = process.env.GAME_FILTER;
  const gameStartsWithinHours = Number(process.env.GAME_STARTS_WITHIN_HOURS);
  const oddsStartsWithinHours = Number(process.env.SPORTS_GAME_ODDS_STARTS_WITHIN_HOURS);
  const hasLiveProbabilities = process.env.PROBABILITY_SOURCE === "sports-game-odds" && Boolean(process.env.SPORTS_GAME_ODDS_API_KEY);
  const probabilities = hasLiveProbabilities
    ? new SportsGameOddsProbabilityProvider(process.env.SPORTS_GAME_ODDS_API_KEY!, undefined, undefined, undefined, Number.isFinite(oddsStartsWithinHours) ? oddsStartsWithinHours : undefined)
    : new UnavailableProbabilityProvider();
  const marketData = new ReadOnlyKalshiProvider(
    baseUrl,
    undefined,
    undefined,
    undefined,
    gameFilter,
    Number.isFinite(gameStartsWithinHours) ? gameStartsWithinHours : undefined,
  );
  const records = await scanMarketsDetailed({ marketData, probabilities, now });
  return {
    candidates: records.map(({ decision }) => decision),
    records,
    marketData,
    source: "kalshi",
    warning: hasLiveProbabilities ? null : "Live market data is enabled, but no licensed probability feed is configured. All candidates must remain NO TRADE.",
  };
}
