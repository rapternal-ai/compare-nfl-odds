import type { Database } from "@/db/client";
import { claimJob, failJob, persistScan } from "@/db/repository";
import { loadCandidates, type ScanResult } from "./source";
import { executePaperScan } from "./execution";

export async function runPersistedScan(sql: Database, jobId: string, now = new Date()): Promise<ScanResult | null> {
  if (!await claimJob(sql, jobId, now)) return null;
  try {
    const result = await loadCandidates(now);
    await persistScan(sql, jobId, result.records, new Date());
    await executePaperScan(sql, result.records, now);
    return result;
  } catch (error) {
    await failJob(sql, jobId, error);
    throw error;
  }
}
