import { defaultRisk } from "@/domain/config";
import { createDatabase } from "@/db/client";
import { loadPortfolio } from "@/db/repository";

export async function loadPortfolioSummary(now = new Date()) {
  const sql = createDatabase();
  try {
    return await loadPortfolio(sql, defaultRisk, now);
  } finally {
    await sql.end();
  }
}
