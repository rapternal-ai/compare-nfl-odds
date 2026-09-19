import { defaultRisk, defaultStrategy } from "@/domain/config";
import type { MarketDataProvider, ScanRecord } from "@/domain/types";
import type { Database } from "@/db/client";
import { expirePaperOrders, fillActivePaperOrder, getActivePaperOrders, getPaperControlState, revalidateAndExecutePaperEntry } from "@/db/repository";

export async function executePaperScan(sql: Database, records: ScanRecord[], marketData: MarketDataProvider, now = new Date()) {
  const { risk } = await getPaperControlState(sql, defaultRisk);
  await expirePaperOrders(sql, now);
  for (const order of await getActivePaperOrders(sql)) {
    const orderbook = await marketData.getOrderbook(order.ticker);
    await fillActivePaperOrder(sql, order.id, orderbook, risk, now, defaultStrategy.maxMarketQuoteAgeSeconds);
  }
  const results = [];
  for (const { decision } of records) {
    if (decision.action !== "TRADE" || !decision.quote) continue;
    const orderbook = await marketData.getOrderbook(decision.ticker);
    results.push(await revalidateAndExecutePaperEntry(
      sql,
      decision,
      orderbook,
      risk,
      now,
      defaultStrategy.maxMarketQuoteAgeSeconds,
    ));
  }
  return results;
}
