import { createDatabase } from "@/db/client";
import { getMarketHistory, getLatestMarketSummaries, getRecentJobRuns, type JobRunSummary, type LatestMarketSummary, type MarketHistory } from "@/db/repository";

export type { JobRunSummary, LatestMarketSummary, MarketHistory };

interface Success<T> { ok: true; data: T }
interface Failure { ok: false; error: string }
type Result<T> = Success<T> | Failure;

export interface HistoryOverview {
  jobRuns: JobRunSummary[];
  markets: LatestMarketSummary[];
}

export async function loadHistoryOverview(): Promise<Result<HistoryOverview>> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, error: "DATABASE_URL is not configured. Add it to .env.local and run npm run db:up." };
  const sql = createDatabase(url);
  try {
    const [jobRuns, markets] = await Promise.all([getRecentJobRuns(sql), getLatestMarketSummaries(sql)]);
    return { ok: true, data: { jobRuns, markets } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load history" };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

export async function loadMarketHistory(ticker: string): Promise<Result<MarketHistory>> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, error: "DATABASE_URL is not configured. Add it to .env.local and run npm run db:up." };
  const sql = createDatabase(url);
  try {
    const history = await getMarketHistory(sql, decodeURIComponent(ticker));
    if (!history) return { ok: false, error: `Market ${ticker} was not found in the scan history.` };
    return { ok: true, data: history };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load market history" };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}
