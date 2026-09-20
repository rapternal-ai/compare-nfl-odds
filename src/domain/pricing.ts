import Decimal from "decimal.js";
import type { ExecutableQuote, Orderbook, OrderbookLevel } from "./types";

export function yesAsks(noBids: OrderbookLevel[]): OrderbookLevel[] {
  return noBids
    .map(({ priceCents, quantity }) => ({ priceCents: 100 - priceCents, quantity }))
    .sort((a, b) => a.priceCents - b.priceCents);
}

export interface BoundedFill {
  quantity: number;
  averagePriceCents: number;
  totalCostCents: number;
}

export function executableYesBid(orderbook: Orderbook, quantity: number): BoundedFill | null {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer");
  let remaining = quantity;
  let total = new Decimal(0);
  for (const level of [...orderbook.yesBids].sort((a, b) => b.priceCents - a.priceCents)) {
    const amount = Math.min(remaining, level.quantity);
    total = total.plus(new Decimal(amount).times(level.priceCents));
    remaining -= amount;
    if (!remaining) break;
  }
  if (remaining) return null;
  return { quantity, averagePriceCents: total.div(quantity).toDecimalPlaces(4).toNumber(), totalCostCents: total.toNumber() };
}

export function boundedYesFill(orderbook: Orderbook, quantity: number, limitPriceCents: number): BoundedFill | null {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer");
  let remaining = quantity;
  let filled = 0;
  let total = new Decimal(0);
  for (const level of yesAsks(orderbook.noBids)) {
    if (level.priceCents > limitPriceCents) break;
    const amount = Math.min(remaining, level.quantity);
    total = total.plus(new Decimal(amount).times(level.priceCents));
    filled += amount;
    remaining -= amount;
    if (!remaining) break;
  }
  if (!filled) return null;
  return {
    quantity: filled,
    averagePriceCents: total.div(filled).toDecimalPlaces(4).toNumber(),
    totalCostCents: total.toNumber(),
  };
}

export function executableYesQuote(orderbook: Orderbook, quantity: number): ExecutableQuote | null {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantity must be a positive integer");
  const asks = yesAsks(orderbook.noBids);
  let remaining = quantity;
  let availableQuantity = 0;
  let total = new Decimal(0);
  let limitPriceCents = 0;

  for (const level of asks) {
    if (level.quantity <= 0) continue;
    availableQuantity += level.quantity;
    const fill = Math.min(remaining, level.quantity);
    total = total.plus(new Decimal(fill).times(level.priceCents));
    if (fill > 0) limitPriceCents = level.priceCents;
    remaining -= fill;
    if (remaining === 0) break;
  }
  if (remaining > 0) return null;

  const bestBid = [...orderbook.yesBids].sort((a, b) => b.priceCents - a.priceCents)[0];
  return {
    quantity,
    availableQuantity,
    averagePriceCents: total.div(quantity).toDecimalPlaces(2).toNumber(),
    limitPriceCents,
    totalCostCents: total.toNumber(),
    spreadCents: bestBid ? asks[0].priceCents - bestBid.priceCents : null,
  };
}
