import Decimal from "decimal.js";

export interface SportsbookMoneyline {
  bookmaker: string;
  awayTeam: string;
  homeTeam: string;
  startsAt: string;
  awayAmerican: number;
  homeAmerican: number;
  asOf: string;
  settlement: "kalshi-compatible" | "different";
}

export interface NormalizedMoneyline {
  bookmaker: string;
  awayProbabilityBps: number;
  homeProbabilityBps: number;
  overroundBps: number;
  asOf: string;
}

export function americanImpliedProbability(american: number): Decimal {
  if (!Number.isInteger(american) || american === 0 || Math.abs(american) < 100) throw new Error("American odds must be an integer with absolute value of at least 100");
  return american > 0
    ? new Decimal(100).div(new Decimal(american).plus(100))
    : new Decimal(-american).div(new Decimal(-american).plus(100));
}

export function normalizeTwoWayMoneyline(quote: SportsbookMoneyline): NormalizedMoneyline {
  if (quote.settlement !== "kalshi-compatible") throw new Error("Settlement rules are not comparable");
  const awayRaw = americanImpliedProbability(quote.awayAmerican);
  const homeRaw = americanImpliedProbability(quote.homeAmerican);
  const total = awayRaw.plus(homeRaw);
  return {
    bookmaker: quote.bookmaker,
    awayProbabilityBps: awayRaw.div(total).times(10_000).round().toNumber(),
    homeProbabilityBps: homeRaw.div(total).times(10_000).round().toNumber(),
    overroundBps: total.minus(1).times(10_000).round().toNumber(),
    asOf: quote.asOf,
  };
}

export function consensusProbability(values: number[]) {
  if (values.length < 2) throw new Error("At least two comparable bookmakers are required");
  const mean = new Decimal(values.reduce((sum, value) => sum + value, 0)).div(values.length);
  const variance = values.reduce((sum, value) => sum.plus(new Decimal(value).minus(mean).pow(2)), new Decimal(0)).div(values.length);
  const uncertaintyBps = Decimal.max(200, variance.sqrt().times(1.96)).ceil();
  return {
    probabilityBps: mean.round().toNumber(),
    lowerBoundBps: Decimal.max(0, mean.minus(uncertaintyBps)).floor().toNumber(),
    uncertaintyBps: uncertaintyBps.toNumber(),
  };
}
