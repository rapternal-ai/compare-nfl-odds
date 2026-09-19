import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import type { DecisionAction, Market, Orderbook, RiskConfig, ScanRecord } from "@/domain/types";
import type { PaperFill, PaperOrder, PaperPosition } from "@/domain/portfolio";
import type { Database } from "./client";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function claimJob(sql: Database, id: string, startedAt: Date) {
  const rows = await sql`INSERT INTO job_runs (id, job_type, status, started_at) VALUES (${id}, 'market_scan', 'running', ${startedAt}) ON CONFLICT (id) DO NOTHING RETURNING id`;
  return rows.length === 1;
}

export async function failJob(sql: Database, id: string, error: unknown) {
  await sql`UPDATE job_runs SET status = 'failed', completed_at = now(), error = ${error instanceof Error ? error.message : "Unknown scan failure"} WHERE id = ${id}`;
}

export async function persistScan(sql: Database, jobId: string, records: ScanRecord[], completedAt: Date) {
  await sql.begin(async (transaction) => {
    for (const { market, orderbook, decision } of records) {
      if (market.game) {
        await transaction`INSERT INTO games (id, away_team, home_team, starts_at) VALUES (${market.game.id}, ${market.game.awayTeam}, ${market.game.homeTeam}, ${market.game.startsAt}) ON CONFLICT (id) DO UPDATE SET away_team = EXCLUDED.away_team, home_team = EXCLUDED.home_team, starts_at = EXCLUDED.starts_at`;
      }
      await transaction`INSERT INTO markets (ticker, series_ticker, game_id, yes_outcome, status, rules_url, observed_at) VALUES (${market.ticker}, ${market.seriesTicker}, ${market.game?.id ?? null}, ${market.yesOutcome}, ${market.status}, ${market.rulesUrl}, ${orderbook.asOf}) ON CONFLICT (ticker) DO UPDATE SET game_id = EXCLUDED.game_id, status = EXCLUDED.status, observed_at = EXCLUDED.observed_at`;
      await transaction`INSERT INTO market_rules_versions (ticker, version, rules_primary, rules_secondary, tie_settlement_cents, fetched_at) VALUES (${market.ticker}, ${market.rules.version}, ${market.rules.primary}, ${market.rules.secondary}, ${market.rules.tieSettlementCents}, ${market.rules.fetchedAt}) ON CONFLICT (ticker, version) DO NOTHING`;
      const inputHash = hash({ ticker: market.ticker, rulesVersion: market.rules.version, orderbook, probability: decision.probability });
      await transaction`INSERT INTO market_snapshots (ticker, as_of, orderbook, market, input_hash) VALUES (${market.ticker}, ${orderbook.asOf}, ${transaction.json(orderbook as unknown as JSONValue)}, ${transaction.json(market as unknown as JSONValue)}, ${inputHash}) ON CONFLICT (input_hash) DO UPDATE SET market = EXCLUDED.market, as_of = EXCLUDED.as_of`;
      if (market.game && decision.probability) {
        const probability = decision.probability;
        await transaction`INSERT INTO probability_estimates (game_id, outcome, probability_bps, lower_bound_bps, source, model_version, as_of) VALUES (${market.game.id}, ${probability.outcome}, ${probability.probabilityBps}, ${probability.lowerBoundBps}, ${probability.source}, ${probability.modelVersion}, ${probability.asOf})`;
      }
      await transaction`INSERT INTO decisions (ticker, action, reasons, input_snapshot_hash, quote_depth, expected_fee_cents, created_at) VALUES (${market.ticker}, ${decision.action}, ${transaction.json(decision.reasons)}, ${inputHash}, ${transaction.json(orderbook as unknown as JSONValue)}, ${null}, ${completedAt})`;
    }
    await transaction`UPDATE job_runs SET status = 'completed', completed_at = ${completedAt}, error = null WHERE id = ${jobId}`;
  });
}

export interface JobRunSummary {
  id: string;
  jobType: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export async function getRecentJobRuns(sql: Database, limit = 20): Promise<JobRunSummary[]> {
  const rows = await sql`
    SELECT id, job_type, status, started_at, completed_at, error
    FROM job_runs
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    jobType: r.job_type,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    error: r.error,
  }));
}

export interface LatestMarketSummary {
  ticker: string;
  seriesTicker: string;
  status: string;
  yesOutcome: string;
  awayTeam: string | null;
  homeTeam: string | null;
  startsAt: string | null;
  lastSnapshotAt: string | null;
  lastDecisionAt: string | null;
  lastAction: DecisionAction | null;
  lastReasons: string[];
}

export async function getLatestMarketSummaries(sql: Database): Promise<LatestMarketSummary[]> {
  const rows = await sql`
    SELECT
      m.ticker,
      m.series_ticker,
      m.status,
      m.yes_outcome,
      g.away_team,
      g.home_team,
      g.starts_at,
      s.as_of AS last_snapshot_at,
      d.created_at AS last_decision_at,
      d.action AS last_action,
      d.reasons AS last_reasons
    FROM markets m
    LEFT JOIN games g ON m.game_id = g.id
    LEFT JOIN LATERAL (
      SELECT as_of FROM market_snapshots WHERE ticker = m.ticker ORDER BY as_of DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT created_at, action, reasons FROM decisions WHERE ticker = m.ticker ORDER BY created_at DESC LIMIT 1
    ) d ON true
    ORDER BY m.ticker
  `;
  return rows.map((r) => ({
    ticker: r.ticker,
    seriesTicker: r.series_ticker,
    status: r.status,
    yesOutcome: r.yes_outcome,
    awayTeam: r.away_team,
    homeTeam: r.home_team,
    startsAt: r.starts_at,
    lastSnapshotAt: r.last_snapshot_at,
    lastDecisionAt: r.last_decision_at,
    lastAction: r.last_action,
    lastReasons: r.last_reasons ?? [],
  }));
}

export interface MarketHistory {
  ticker: string;
  seriesTicker: string;
  status: string;
  yesOutcome: string;
  awayTeam: string | null;
  homeTeam: string | null;
  startsAt: string | null;
  snapshots: { asOf: string; orderbook: Orderbook; market: Market }[];
  probabilities: { asOf: string; probabilityBps: number; lowerBoundBps: number; source: string; gameId: string; outcome: string; modelVersion: string }[];
  decisions: { createdAt: string; action: DecisionAction; reasons: string[] }[];
}

export async function getMarketHistory(sql: Database, ticker: string, limit = 100): Promise<MarketHistory | null> {
  const details = await sql`
    SELECT
      m.ticker,
      m.series_ticker,
      m.status,
      m.yes_outcome,
      g.away_team,
      g.home_team,
      g.starts_at
    FROM markets m
    LEFT JOIN games g ON m.game_id = g.id
    WHERE m.ticker = ${ticker}
    LIMIT 1
  `;
  if (details.length === 0) return null;

  const d = details[0];
  const [snapshots, probabilities, decisions] = await Promise.all([
    sql`
      SELECT as_of, orderbook, market
      FROM market_snapshots
      WHERE ticker = ${ticker}
      ORDER BY as_of DESC
      LIMIT ${limit}
    `,
    sql`
      SELECT p.as_of, p.probability_bps, p.lower_bound_bps, p.source, p.game_id, p.outcome, p.model_version
      FROM probability_estimates p
      JOIN markets m ON m.game_id = p.game_id AND m.yes_outcome = p.outcome
      WHERE m.ticker = ${ticker}
      ORDER BY p.as_of DESC
      LIMIT ${limit}
    `,
    sql`
      SELECT created_at, action, reasons
      FROM decisions
      WHERE ticker = ${ticker}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
  ]);

  return {
    ticker: d.ticker,
    seriesTicker: d.series_ticker,
    status: d.status,
    yesOutcome: d.yes_outcome,
    awayTeam: d.away_team,
    homeTeam: d.home_team,
    startsAt: d.starts_at,
    snapshots: snapshots.map((s) => ({
      asOf: s.as_of,
      orderbook: typeof s.orderbook === "string" ? JSON.parse(s.orderbook) : s.orderbook,
      market: typeof s.market === "string" ? JSON.parse(s.market) : (s.market ?? { ticker: d.ticker, title: d.ticker, seriesTicker: d.series_ticker, status: d.status, game: null, yesOutcome: d.yes_outcome, volume24h: 0, rulesUrl: d.ticker, rules: { primary: "", secondary: "", version: "", fetchedAt: s.as_of, tieSettlementCents: null } } as Market),
    })).reverse(),
    probabilities: probabilities.map((p) => ({
      asOf: p.as_of,
      probabilityBps: p.probability_bps,
      lowerBoundBps: p.lower_bound_bps,
      source: p.source,
      gameId: p.game_id,
      outcome: p.outcome,
      modelVersion: p.model_version,
    })).reverse(),
    decisions: decisions.map((d2) => ({ createdAt: d2.created_at, action: d2.action, reasons: d2.reasons })).reverse(),
  };
}

export interface PortfolioSummary {
  cashCents: number;
  atRiskCents: number;
  dayCostCents: number;
  positions: PaperPosition[];
}

function dayBounds(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function getOpenPositions(sql: Database): Promise<PaperPosition[]> {
  const rows = await sql`
    SELECT ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at
    FROM paper_positions
    ORDER BY ticker
  `;
  return rows.map((r) => ({
    ticker: r.ticker,
    quantity: r.quantity,
    costBasisCents: r.cost_basis_cents,
    totalFeesCents: r.total_fees_cents,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getTodaysFillCost(sql: Database, now: Date): Promise<number> {
  const { start, end } = dayBounds(now);
  const rows = await sql`
    SELECT COALESCE(SUM(price_cents * quantity + fee_cents), 0) AS total
    FROM paper_fills
    WHERE filled_at >= ${start.toISOString()} AND filled_at < ${end.toISOString()}
  `;
  return Number(rows[0].total);
}

export async function loadPortfolio(sql: Database, risk: RiskConfig, now: Date): Promise<PortfolioSummary> {
  const positions = await getOpenPositions(sql);
  const atRiskCents = positions.reduce((sum, p) => sum + p.costBasisCents + p.totalFeesCents, 0);
  const dayCostCents = await getTodaysFillCost(sql, now);
  return {
    cashCents: risk.startingBankrollCents - atRiskCents,
    atRiskCents,
    dayCostCents,
    positions,
  };
}

export async function persistPaperEntry(sql: Database, order: PaperOrder, fill: PaperFill, position: PaperPosition) {
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO paper_orders (id, ticker, side, limit_price_cents, requested_quantity, filled_quantity, status, created_at)
      VALUES (${order.id}, ${order.ticker}, ${order.side}, ${order.limitPriceCents}, ${order.requestedQuantity}, ${order.filledQuantity}, ${order.status}, ${order.createdAt})
    `;
    await transaction`
      INSERT INTO paper_fills (ticker, price_cents, quantity, fee_cents, filled_at)
      VALUES (${fill.ticker}, ${fill.priceCents}, ${fill.quantity}, ${fill.feeCents}, ${fill.filledAt})
    `;
    await transaction`
      INSERT INTO paper_positions (ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at)
      VALUES (${position.ticker}, ${position.quantity}, ${position.costBasisCents}, ${position.totalFeesCents}, ${position.createdAt}, ${position.updatedAt})
      ON CONFLICT (ticker) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        cost_basis_cents = EXCLUDED.cost_basis_cents,
        total_fees_cents = EXCLUDED.total_fees_cents,
        updated_at = EXCLUDED.updated_at
    `;
  });
}
