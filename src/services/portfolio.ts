import { defaultRisk } from "@/domain/config";
import { createDatabase } from "@/db/client";
import { getPaperControlState, loadPortfolio } from "@/db/repository";

export async function loadPortfolioSummary(now = new Date()) {
  const sql = createDatabase();
  try {
    const controls = await getPaperControlState(sql, defaultRisk);
    return {
      ...await loadPortfolio(sql, controls.risk, now),
      controls,
    };
  } finally {
    await sql.end();
  }
}
