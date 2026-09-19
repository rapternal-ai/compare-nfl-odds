import { defaultStrategy } from "@/domain/config";
import { decideCandidate } from "@/domain/decision";
import type { CandidateDecision, ProbabilityEstimate, StrategyConfig } from "@/domain/types";
import type { MarketHistory } from "./history";

export interface BacktestPoint {
  asOf: string;
  decision: CandidateDecision;
  probability: ProbabilityEstimate | null;
}

export interface BacktestResult {
  ticker: string;
  points: BacktestPoint[];
  tradeCount: number;
  noTradeCount: number;
  avgNetEdgeBps: number | null;
  reasonCounts: Record<string, number>;
  error: string | null;
}

function parseConfig(input: string | undefined): { config: StrategyConfig; error: string | null } {
  if (!input) return { config: defaultStrategy, error: null };
  try {
    const parsed = JSON.parse(decodeURIComponent(input));
    return { config: { ...defaultStrategy, ...parsed }, error: null };
  } catch (error) {
    return { config: defaultStrategy, error: error instanceof Error ? error.message : "Invalid strategy JSON" };
  }
}

export function runBacktest(history: MarketHistory, rawConfig?: string): BacktestResult {
  const { config, error: configError } = parseConfig(rawConfig);
  const probabilities = [...history.probabilities].sort(
    (a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime(),
  );

  const points: BacktestPoint[] = [];
  for (const snapshot of history.snapshots) {
    const snapshotTime = new Date(snapshot.asOf).getTime();
    const probability = probabilities
      .filter((p) => new Date(p.asOf).getTime() <= snapshotTime)
      .pop() ?? null;
    const decision = decideCandidate({
      market: snapshot.market,
      orderbook: snapshot.orderbook,
      probability,
      config,
      now: new Date(snapshot.asOf),
    });
    points.push({ asOf: snapshot.asOf, decision, probability });
  }

  const tradePoints = points.filter(({ decision }) => decision.action === "TRADE");
  const reasonCounts: Record<string, number> = {};
  for (const { decision } of points) {
    for (const reason of decision.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }

  const netEdges = tradePoints.map(({ decision }) => decision.netEdgeBps).filter((v): v is number => v !== null);
  const avgNetEdgeBps = netEdges.length ? netEdges.reduce((a, b) => a + b, 0) / netEdges.length : null;

  return {
    ticker: history.ticker,
    points: points.sort((a, b) => new Date(b.asOf).getTime() - new Date(a.asOf).getTime()),
    tradeCount: tradePoints.length,
    noTradeCount: points.length - tradePoints.length,
    avgNetEdgeBps: avgNetEdgeBps ? Math.round(avgNetEdgeBps) : null,
    reasonCounts,
    error: configError,
  };
}
