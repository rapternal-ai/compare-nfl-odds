import { createDatabase } from "@/db/client";
import { settlePaperPosition } from "@/db/repository";

export async function settlePaper(ticker: string, settlementValueCents: number) {
  if (!ticker) throw new Error("Ticker is required");
  if (!Number.isInteger(settlementValueCents) || settlementValueCents < 0 || settlementValueCents > 100) throw new Error("Settlement value must be an integer from 0 to 100 cents");
  const sql = createDatabase();
  try {
    return await settlePaperPosition(sql, ticker, settlementValueCents, "Manual paper settlement; result must be independently verified");
  } finally {
    await sql.end();
  }
}
