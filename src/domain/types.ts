export type MarketStatus = "open" | "closed" | "paused";
export type DecisionAction = "TRADE" | "NO_TRADE";

export interface NflGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  startsAt: string;
}

export interface MarketRules {
  primary: string;
  secondary: string;
  version: string;
  fetchedAt: string;
  tieSettlementCents: number | null;
}

export interface Market {
  ticker: string;
  seriesTicker: string;
  title: string;
  status: MarketStatus;
  game: NflGame | null;
  yesOutcome: string;
  volume24h: number;
  rulesUrl: string;
  rules: MarketRules;
}

export interface OrderbookLevel {
  priceCents: number;
  quantity: number;
}

export interface Orderbook {
  ticker: string;
  yesBids: OrderbookLevel[];
  noBids: OrderbookLevel[];
  asOf: string;
}

export interface ProbabilityEstimate {
  gameId: string;
  outcome: string;
  probabilityBps: number;
  lowerBoundBps: number;
  source: string;
  modelVersion: string;
  asOf: string;
}

export interface StrategyConfig {
  marketSeriesAllowlist: string[];
  earliestEntryHoursBeforeStart: number;
  latestEntryMinutesBeforeStart: number;
  min24hVolumeContracts: number;
  maxBidAskSpreadCents: number;
  minVisibleContractsAtLimit: number;
  minNetEdgeBps: number;
  maxBenchmarkAgeSeconds: number;
  maxMarketQuoteAgeSeconds: number;
  quantity: number;
  feeCentsPerContract: number;
  uncertaintyBufferBps: number;
}

export interface RiskConfig {
  mode: "paper" | "demo" | "live";
  startingBankrollCents: number;
  maxCostPerEntryCents: number;
  maxOpenCostPerGameCents: number;
  maxTotalOpenCostCents: number;
  maxDailyNewCostCents: number;
  maxConcurrentPositions: number;
  maxDailyRealizedLossCents: number;
  autoExitIfNetEdgeBelowBps: number;
  autoExitMinNetProfitCents: number;
  autoExitMinMinutesBeforeStart: number;
  feeCentsPerContract: number;
}

export interface ExecutableQuote {
  quantity: number;
  availableQuantity: number;
  averagePriceCents: number;
  limitPriceCents: number;
  totalCostCents: number;
  spreadCents: number | null;
}

export interface CandidateDecision {
  ticker: string;
  matchup: string;
  startsAt: string;
  action: DecisionAction;
  reasons: string[];
  quote: ExecutableQuote | null;
  probability: ProbabilityEstimate | null;
  netEdgeBps: number | null;
  expectedValueCents: number | null;
  marketAsOf: string;
  rulesUrl: string;
}

export interface ScanRecord {
  market: Market;
  orderbook: Orderbook;
  decision: CandidateDecision;
}

export interface MarketDataProvider {
  listEligibleMarkets(): Promise<Market[]>;
  getOrderbook(ticker: string): Promise<Orderbook>;
  getMarketRules(ticker: string): Promise<MarketRules>;
}

export interface ProbabilityProvider {
  estimate(game: NflGame, outcome: string, asOf: Date): Promise<ProbabilityEstimate>;
}
