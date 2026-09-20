import type { RiskConfig, StrategyConfig } from "./types";

export const defaultStrategy: StrategyConfig = {
  marketSeriesAllowlist: ["KXNFLGAME"],
  earliestEntryHoursBeforeStart: 72,
  latestEntryMinutesBeforeStart: 30,
  min24hVolumeContracts: 1_000,
  maxBidAskSpreadCents: 3,
  minVisibleContractsAtLimit: 20,
  minNetEdgeBps: 500,
  maxBenchmarkAgeSeconds: 120,
  maxMarketQuoteAgeSeconds: 15,
  quantity: 20,
  feeCentsPerContract: 1,
  uncertaintyBufferBps: 0,
};

export const defaultRisk: RiskConfig = {
  mode: "paper",
  startingBankrollCents: 10_000_00,
  maxCostPerEntryCents: 1_000_00,
  maxOpenCostPerGameCents: 1_000_00,
  maxTotalOpenCostCents: 10_000_00,
  maxDailyNewCostCents: 3_000_00,
  maxConcurrentPositions: 8,
  maxDailyRealizedLossCents: 2_000,
  autoExitIfNetEdgeBelowBps: -200,
  autoExitMinNetProfitCents: 200,
  autoExitMinMinutesBeforeStart: 10,
  feeCentsPerContract: 1,
};
