import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDatabase } from "./client";
import { defaultRisk } from "@/domain/config";
import { executePaperEntryAtomically, fillActivePaperOrder, revalidateAndExecutePaperEntry } from "./repository";
import { runPersistedScan } from "@/services/persisted-scan";

describe("persisted scan", { skip: process.env.TEST_DATABASE_INTEGRATION !== "true" }, () => {
  it("persists an audit trail once for a stable job ID", async () => {
    const sql = createDatabase();
    const previousSource = process.env.MARKET_DATA_SOURCE;
    process.env.MARKET_DATA_SOURCE = "fixtures";
    const jobId = `integration:${randomUUID()}`;
    try {
      const first = await runPersistedScan(sql, jobId, new Date("2026-09-13T12:00:00Z"));
      const duplicate = await runPersistedScan(sql, jobId, new Date("2026-09-13T12:00:00Z"));
      assert.equal(first?.records.length, 6);
      assert.equal(duplicate, null);
      const jobs = await sql`SELECT status FROM job_runs WHERE id = ${jobId}`;
      const decisions = await sql`SELECT count(*)::int AS count FROM decisions WHERE created_at = (SELECT completed_at FROM job_runs WHERE id = ${jobId})`;
      assert.equal(jobs[0].status, "completed");
      assert.equal(decisions[0].count, 6);

      const trade = first?.records.find(({ decision }) => decision.action === "TRADE")?.decision;
      assert.ok(trade);
      const uniqueDecision = { ...trade, marketAsOf: `${trade.marketAsOf}:${randomUUID()}` };
      const results = await Promise.all([
        executePaperEntryAtomically(sql, uniqueDecision, defaultRisk, new Date("2026-09-13T12:01:00Z")),
        executePaperEntryAtomically(sql, uniqueDecision, defaultRisk, new Date("2026-09-13T12:01:00Z")),
      ]);
      assert.deepEqual(results.map(({ status }) => status).sort(), ["duplicate", "filled"]);

      const partialDecision = { ...trade, marketAsOf: `${trade.marketAsOf}:${randomUUID()}` };
      const partial = await revalidateAndExecutePaperEntry(sql, partialDecision, {
        ticker: trade.ticker,
        yesBids: [{ priceCents: 55, quantity: 20 }],
        noBids: [{ priceCents: 100 - trade.quote!.limitPriceCents, quantity: 5 }],
        asOf: "2026-09-13T12:01:00Z",
      }, defaultRisk, new Date("2026-09-13T12:01:00Z"), 15);
      assert.equal(partial.status, "partial");
      const stored = await sql`SELECT status, filled_quantity, requested_quantity FROM paper_orders WHERE decision_key = ${`${partialDecision.ticker}:${partialDecision.marketAsOf}`}`;
      assert.equal(stored[0].status, "partial");
      assert.equal(stored[0].filled_quantity, 5);
      assert.equal(stored[0].requested_quantity, trade.quote!.quantity);
      const completed = await fillActivePaperOrder(sql, `paper-${partialDecision.ticker}:${partialDecision.marketAsOf}`, {
        ticker: trade.ticker,
        yesBids: [{ priceCents: 55, quantity: 20 }],
        noBids: [{ priceCents: 100 - trade.quote!.limitPriceCents, quantity: trade.quote!.quantity }],
        asOf: "2026-09-13T12:01:30Z",
      }, defaultRisk, new Date("2026-09-13T12:01:30Z"), 15);
      assert.equal(completed.status, "filled");
    } finally {
      process.env.MARKET_DATA_SOURCE = previousSource;
      await sql.end();
    }
  });
});
