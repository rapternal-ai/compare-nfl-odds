import { defaultRisk } from "@/domain/config";
import type { ScanRecord } from "@/domain/types";
import type { AccountState } from "@/domain/portfolio";
import { executePaperEntry } from "@/domain/portfolio";
import type { Database } from "@/db/client";
import { getOpenPositions, getTodaysFillCost, persistPaperEntry } from "@/db/repository";

export async function executePaperScan(sql: Database, records: ScanRecord[], now = new Date()) {
  const risk = defaultRisk;
  const positions = await getOpenPositions(sql);
  const dayCostCents = await getTodaysFillCost(sql, now);
  const atRiskCents = positions.reduce((sum, p) => sum + p.costBasisCents + p.totalFeesCents, 0);
  const account: AccountState = {
    cashCents: risk.startingBankrollCents - atRiskCents,
    positions,
    dayCostCents,
    dayStartsAt: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
  };

  for (const { decision } of records) {
    if (decision.action !== "TRADE" || !decision.quote) continue;
    const { rejection, order, fill, position } = executePaperEntry(decision, decision.quote, risk, account, now);
    if (rejection || !order || !fill || !position) continue;
    await persistPaperEntry(sql, order, fill, position);
    const entryCost = fill.priceCents * fill.quantity + fill.feeCents;
    account.cashCents -= entryCost;
    account.dayCostCents += entryCost;
    const idx = account.positions.findIndex((p) => p.ticker === position.ticker);
    if (idx >= 0) account.positions[idx] = position;
    else account.positions.push(position);
  }
}
