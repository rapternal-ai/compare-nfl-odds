import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDatabase } from "./client";
import { defaultRisk } from "@/domain/config";
import type { ScanRecord } from "@/domain/types";
import { executePaperEntryAtomically, executePaperExit, fillActivePaperOrder, revalidateAndExecutePaperEntry, settlePaperPosition } from "./repository";
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

describe("paper exits and settlements", { skip: process.env.TEST_DATABASE_INTEGRATION !== "true" }, () => {
  async function createPosition(sql: ReturnType<typeof createDatabase>, quantity = 10, costBasisCents = 500, feesCents = 10) {
    const id = randomUUID();
    const gameId = `test-game-${id}`;
    const ticker = `TEST-${id}`;
    await sql`INSERT INTO games (id, away_team, home_team, starts_at) VALUES (${gameId}, 'Test Away', 'Test Home', '2026-09-20T20:00:00Z')`;
    await sql`INSERT INTO markets (ticker, series_ticker, game_id, yes_outcome, status, rules_url, observed_at) VALUES (${ticker}, 'KXNFLGAME', ${gameId}, 'Test Away', 'open', ${ticker}, '2026-09-18T12:00:00Z')`;
    await sql`INSERT INTO paper_positions (ticker, quantity, cost_basis_cents, total_fees_cents) VALUES (${ticker}, ${quantity}, ${costBasisCents}, ${feesCents})`;
    return { gameId, ticker };
  }

  async function cleanup(sql: ReturnType<typeof createDatabase>, gameId: string, ticker: string) {
    await sql`DELETE FROM paper_realized_events WHERE ticker = ${ticker}`;
    await sql`DELETE FROM paper_fills WHERE ticker = ${ticker}`;
    await sql`DELETE FROM paper_orders WHERE ticker = ${ticker}`;
    await sql`DELETE FROM paper_positions WHERE ticker = ${ticker}`;
    await sql`DELETE FROM markets WHERE ticker = ${ticker}`;
    await sql`DELETE FROM games WHERE id = ${gameId}`;
  }

  it("exits only with full executable depth and records realized P&L", async () => {
    const sql = createDatabase();
    const created = await createPosition(sql);
    const now = new Date("2026-09-18T12:00:00Z");
    const record: ScanRecord = {
      market: { ticker: created.ticker, seriesTicker: "KXNFLGAME", title: "Test Away wins", status: "open", game: { id: created.gameId, awayTeam: "Test Away", homeTeam: "Test Home", startsAt: "2026-09-20T20:00:00Z" }, yesOutcome: "Test Away", volume24h: 2_000, rulesUrl: created.ticker, rules: { primary: "test", secondary: "test", version: "1", fetchedAt: now.toISOString(), tieSettlementCents: null } },
      orderbook: { ticker: created.ticker, yesBids: [{ priceCents: 70, quantity: 10 }], noBids: [], asOf: now.toISOString() },
      decision: { ticker: created.ticker, matchup: "Test Away at Test Home", startsAt: "2026-09-20T20:00:00Z", action: "NO_TRADE", reasons: ["Net edge is below the configured minimum"], quote: null, probability: { gameId: created.gameId, outcome: "Test Away", probabilityBps: 6_200, lowerBoundBps: 6_000, source: "test", modelVersion: "1", asOf: now.toISOString() }, netEdgeBps: null, expectedValueCents: null, marketAsOf: now.toISOString(), rulesUrl: created.ticker },
    };
    try {
      const shallow = await executePaperExit(sql, { ...record, orderbook: { ...record.orderbook, yesBids: [{ priceCents: 70, quantity: 9 }] } }, defaultRisk, now);
      assert.equal(shallow, null);
      const exited = await executePaperExit(sql, record, { ...defaultRisk, autoExitMinNetProfitCents: 100 }, now);
      assert.ok(exited);
      assert.equal(exited.pnlCents, 180);
      const [positions, events, sellOrders] = await Promise.all([
        sql`SELECT count(*)::int AS count FROM paper_positions WHERE ticker = ${created.ticker}`,
        sql`SELECT pnl_cents, event_type FROM paper_realized_events WHERE ticker = ${created.ticker}`,
        sql`SELECT side, status FROM paper_orders WHERE ticker = ${created.ticker}`,
      ]);
      assert.equal(positions[0].count, 0);
      assert.equal(Number(events[0].pnl_cents), 180);
      assert.equal(events[0].event_type, "exit");
      assert.deepEqual({ side: sellOrders[0].side, status: sellOrders[0].status }, { side: "sell", status: "filled" });
    } finally {
      await cleanup(sql, created.gameId, created.ticker);
      await sql.end();
    }
  });

  it("settles once, computes losses, cancels orders, and activates the daily loss limit", async () => {
    const sql = createDatabase();
    const created = await createPosition(sql);
    const now = new Date("2026-09-18T12:00:00Z");
    try {
      await sql`INSERT INTO paper_orders (id, decision_key, ticker, side, limit_price_cents, requested_quantity, filled_quantity, status, created_at, updated_at, expires_at) VALUES (${`open-${created.ticker}`}, ${`open-${created.ticker}`}, ${created.ticker}, 'buy', 40, 10, 0, 'resting', ${now.toISOString()}, ${now.toISOString()}, '2026-09-18T12:10:00Z')`;
      const results = await Promise.allSettled([settlePaperPosition(sql, created.ticker, 0, "verified test result", now), settlePaperPosition(sql, created.ticker, 0, "verified test result", now)]);
      assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
      const events = await sql`SELECT pnl_cents FROM paper_realized_events WHERE ticker = ${created.ticker}`;
      assert.equal(events.length, 1);
      assert.equal(Number(events[0].pnl_cents), -510);
      const orders = await sql`SELECT status FROM paper_orders WHERE ticker = ${created.ticker}`;
      assert.equal(orders[0].status, "cancelled");
      const decision = { ticker: created.ticker, matchup: "Test Away at Test Home", startsAt: "2026-09-20T20:00:00Z", action: "TRADE" as const, reasons: [], quote: { quantity: 10, availableQuantity: 10, averagePriceCents: 40, limitPriceCents: 40, totalCostCents: 400, spreadCents: 2 }, probability: null, netEdgeBps: 600, expectedValueCents: 10, marketAsOf: "2026-09-18T12:01:00Z", rulesUrl: created.ticker };
      const blocked = await revalidateAndExecutePaperEntry(sql, decision, { ticker: created.ticker, yesBids: [], noBids: [{ priceCents: 60, quantity: 10 }], asOf: "2026-09-18T12:01:00Z" }, { ...defaultRisk, maxDailyRealizedLossCents: 500 }, new Date("2026-09-18T12:01:00Z"), 15);
      assert.equal(blocked.status, "rejected");
      assert.match(blocked.reason ?? "", /Daily realized loss limit/);
    } finally {
      await cleanup(sql, created.gameId, created.ticker);
      await sql.end();
    }
  });
});
