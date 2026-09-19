import { createDatabase } from "@/db/client";
import { runPersistedScan } from "@/services/persisted-scan";

async function main() {
  const scannedAt = new Date();
  const source = process.env.MARKET_DATA_SOURCE === "kalshi" ? "kalshi" : "fixtures";
  const minute = scannedAt.toISOString().slice(0, 16);
  const jobId = process.env.SCAN_JOB_ID ?? `market-scan:${source}:${minute}`;
  const sql = createDatabase();
  try {
    const result = await runPersistedScan(sql, jobId, scannedAt);
    process.stdout.write(`${JSON.stringify(result ? { jobId, status: "completed", scannedAt: scannedAt.toISOString(), candidateCount: result.candidates.length, source: result.source } : { jobId, status: "duplicate" }, null, 2)}\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Worker failed"}\n`);
  process.exitCode = 1;
});
