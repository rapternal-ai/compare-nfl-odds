import { defaultRisk } from "@/domain/config";
import type { ScanRecord } from "@/domain/types";
import type { Database } from "@/db/client";
import { executePaperEntryAtomically, getPaperControlState } from "@/db/repository";

export async function executePaperScan(sql: Database, records: ScanRecord[], now = new Date()) {
  const { risk } = await getPaperControlState(sql, defaultRisk);
  const results = [];
  for (const { decision } of records) {
    if (decision.action !== "TRADE" || !decision.quote) continue;
    results.push(await executePaperEntryAtomically(sql, decision, risk, now));
  }
  return results;
}
