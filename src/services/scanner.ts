import { defaultStrategy } from "@/domain/config";
import { decideCandidate } from "@/domain/decision";
import type { CandidateDecision, MarketDataProvider, ProbabilityProvider, ScanRecord, StrategyConfig } from "@/domain/types";

export async function scanMarketsDetailed(input: {
  marketData: MarketDataProvider;
  probabilities: ProbabilityProvider;
  now?: Date;
  config?: StrategyConfig;
}): Promise<ScanRecord[]> {
  const now = input.now ?? new Date();
  const config = input.config ?? defaultStrategy;
  const markets = await input.marketData.listEligibleMarkets();

  const records: ScanRecord[] = [];
  for (const market of markets) {
    const orderbook = await input.marketData.getOrderbook(market.ticker);
    let probabilityError: string | undefined;
    const probability = market.game
      ? await input.probabilities.estimate(market.game, market.yesOutcome, now).catch((error: unknown) => {
          probabilityError = error instanceof Error ? error.message : "Unknown provider error";
          return null;
        })
      : null;
    records.push({
      market,
      orderbook,
      decision: decideCandidate({ market, orderbook, probability, probabilityError, config, now }),
    });
  }
  return records;
}

export async function scanMarkets(input: Parameters<typeof scanMarketsDetailed>[0]): Promise<CandidateDecision[]> {
  return (await scanMarketsDetailed(input)).map(({ decision }) => decision);
}
