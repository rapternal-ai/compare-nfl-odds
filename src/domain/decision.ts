import type { CandidateDecision, Market, Orderbook, ProbabilityEstimate, StrategyConfig } from "./types";
import { executableYesQuote } from "./pricing";

const ageSeconds = (timestamp: string, now: Date) => (now.getTime() - new Date(timestamp).getTime()) / 1_000;

export function decideCandidate(input: {
  market: Market;
  orderbook: Orderbook;
  probability: ProbabilityEstimate | null;
  probabilityError?: string;
  config: StrategyConfig;
  now: Date;
}): CandidateDecision {
  const { market, orderbook, probability, probabilityError, config, now } = input;
  const reasons: string[] = [];
  const game = market.game;
  const quote = executableYesQuote(orderbook, config.quantity);

  if (!config.marketSeriesAllowlist.includes(market.seriesTicker)) reasons.push("Market series is not allowed");
  if (market.status !== "open") reasons.push(`Market is ${market.status}`);
  if (!game) reasons.push("Market could not be mapped to exactly one NFL game");
  if (market.volume24h < config.min24hVolumeContracts) reasons.push("24h volume is below the configured minimum");
  if (ageSeconds(orderbook.asOf, now) > config.maxMarketQuoteAgeSeconds) reasons.push("Market quote is stale");
  if (!quote) reasons.push("Orderbook depth cannot fill the configured quantity");
  if (quote?.spreadCents !== null && quote && quote.spreadCents > config.maxBidAskSpreadCents) reasons.push("Bid-ask spread is too wide");
  if (quote && quote.availableQuantity < config.minVisibleContractsAtLimit) reasons.push("Visible liquidity is below the configured minimum");
  if (!probability) reasons.push(probabilityError ? `Probability benchmark unavailable: ${probabilityError}` : "No independent probability benchmark is available");
  if (probability && ageSeconds(probability.asOf, now) > config.maxBenchmarkAgeSeconds) reasons.push("Probability benchmark is stale");

  if (game) {
    const minutesUntilStart = (new Date(game.startsAt).getTime() - now.getTime()) / 60_000;
    if (minutesUntilStart > config.earliestEntryHoursBeforeStart * 60) reasons.push("Game is outside the earliest entry window");
    if (minutesUntilStart < config.latestEntryMinutesBeforeStart) reasons.push("Game has started or is inside the entry cutoff");
  }

  const netEdgeBps = quote && probability
    ? probability.lowerBoundBps - quote.averagePriceCents * 100 - config.feeCentsPerContract * 100 - config.uncertaintyBufferBps
    : null;
  if (netEdgeBps !== null && netEdgeBps < config.minNetEdgeBps) reasons.push("Net edge is below the configured minimum");

  return {
    ticker: market.ticker,
    matchup: game ? `${game.awayTeam} at ${game.homeTeam}` : market.title,
    startsAt: game?.startsAt ?? "",
    action: reasons.length === 0 ? "TRADE" : "NO_TRADE",
    reasons: reasons.length === 0 ? ["All eligibility, freshness, liquidity, and edge checks passed"] : reasons,
    quote,
    probability,
    netEdgeBps,
    expectedValueCents: quote && probability
      ? (probability.probabilityBps / 100) - quote.averagePriceCents - config.feeCentsPerContract
      : null,
    marketAsOf: orderbook.asOf,
    rulesUrl: market.rulesUrl,
  };
}
