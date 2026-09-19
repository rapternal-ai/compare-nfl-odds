import type { CandidateDecision, ExecutableQuote, RiskConfig } from "./types";

export interface PaperPosition {
  ticker: string;
  quantity: number;
  costBasisCents: number;
  totalFeesCents: number;
  createdAt: string;
  updatedAt: string;
}

export type PaperOrderStatus = "resting" | "partial" | "filled" | "cancelled" | "expired";

export interface PaperFill {
  orderId: string;
  ticker: string;
  priceCents: number;
  quantity: number;
  feeCents: number;
  filledAt: string;
}

export interface PaperOrder {
  id: string;
  decisionKey: string;
  ticker: string;
  side: "buy";
  limitPriceCents: number;
  requestedQuantity: number;
  filledQuantity: number;
  status: PaperOrderStatus;
  quoteAsOf: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountState {
  cashCents: number;
  positions: PaperPosition[];
  gameCostCents: number;
  dayCostCents: number;
  dayStartsAt: string;
}

export interface EntryResult {
  order: PaperOrder | null;
  fill: PaperFill | null;
  position: PaperPosition | null;
  rejection: string | null;
}

export function executePaperEntry(
  decision: CandidateDecision,
  quote: ExecutableQuote,
  risk: RiskConfig,
  account: AccountState,
  now: Date,
): EntryResult {
  if (risk.mode !== "paper") {
    return { order: null, fill: null, position: null, rejection: "Execution mode is not paper" };
  }
  if (decision.action !== "TRADE") {
    return { order: null, fill: null, position: null, rejection: "Decision is not TRADE" };
  }

  const totalPositionCost = quote.totalCostCents;
  const entryFee = quote.quantity * risk.feeCentsPerContract;
  const totalEntryCost = totalPositionCost + entryFee;

  if (totalEntryCost > risk.maxCostPerEntryCents) {
    return { order: null, fill: null, position: null, rejection: `Entry cost ${totalEntryCost}¢ exceeds max cost per entry ${risk.maxCostPerEntryCents}¢` };
  }
  if (totalEntryCost > account.cashCents) {
    return { order: null, fill: null, position: null, rejection: `Insufficient cash: need ${totalEntryCost}¢, have ${account.cashCents}¢` };
  }

  const openPositionCost = account.positions
    .filter((p) => p.ticker !== decision.ticker)
    .reduce((sum, p) => sum + p.costBasisCents + p.totalFeesCents, 0);
  const sameGamePosition = account.positions.find((p) => p.ticker === decision.ticker);
  const sameMarketCost = (sameGamePosition?.costBasisCents ?? 0) + (sameGamePosition?.totalFeesCents ?? 0);

  if (account.gameCostCents + totalEntryCost > risk.maxOpenCostPerGameCents) {
    return { order: null, fill: null, position: null, rejection: `Game exposure would exceed ${risk.maxOpenCostPerGameCents}¢` };
  }
  if (openPositionCost + sameMarketCost + totalEntryCost > risk.maxTotalOpenCostCents) {
    return { order: null, fill: null, position: null, rejection: `Total open exposure would exceed ${risk.maxTotalOpenCostCents}¢` };
  }
  if (account.dayCostCents + totalEntryCost > risk.maxDailyNewCostCents) {
    return { order: null, fill: null, position: null, rejection: `Daily new cost limit ${risk.maxDailyNewCostCents}¢ would be exceeded` };
  }
  if (account.positions.length >= risk.maxConcurrentPositions && !sameGamePosition) {
    return { order: null, fill: null, position: null, rejection: `Max concurrent positions ${risk.maxConcurrentPositions} reached` };
  }

  const decisionKey = `${decision.ticker}:${decision.marketAsOf}`;
  const orderId = `paper-${decisionKey}`;
  const order: PaperOrder = {
    id: orderId,
    decisionKey,
    ticker: decision.ticker,
    side: "buy",
    limitPriceCents: quote.limitPriceCents,
    requestedQuantity: quote.quantity,
    filledQuantity: quote.quantity,
    status: "filled",
    quoteAsOf: decision.marketAsOf,
    expiresAt: new Date(now.getTime() + 15_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const fill: PaperFill = {
    orderId,
    ticker: decision.ticker,
    priceCents: quote.averagePriceCents,
    quantity: quote.quantity,
    feeCents: entryFee,
    filledAt: now.toISOString(),
  };

  let position: PaperPosition;
  if (sameGamePosition) {
    const newQuantity = sameGamePosition.quantity + quote.quantity;
    const newCost = sameGamePosition.costBasisCents + totalPositionCost;
    const newFees = sameGamePosition.totalFeesCents + entryFee;
    position = {
      ...sameGamePosition,
      quantity: newQuantity,
      costBasisCents: newCost,
      totalFeesCents: newFees,
      updatedAt: now.toISOString(),
    };
  } else {
    position = {
      ticker: decision.ticker,
      quantity: quote.quantity,
      costBasisCents: totalPositionCost,
      totalFeesCents: entryFee,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  return { order, fill, position, rejection: null };
}
