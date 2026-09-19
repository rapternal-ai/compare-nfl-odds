import { createHash } from "node:crypto";
import type { JSONValue } from "postgres";
import type { CandidateDecision, DecisionAction, Market, Orderbook, RiskConfig, ScanRecord } from "@/domain/types";
import { executePaperEntry, type PaperFill, type PaperOrder, type PaperPosition } from "@/domain/portfolio";
import { boundedYesFill } from "@/domain/pricing";
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

export interface PaperControlState {
  risk: RiskConfig;
  newEntriesPaused: boolean;
  updatedAt: string | null;
}

export async function getPaperControlState(sql: Database, fallback: RiskConfig): Promise<PaperControlState> {
  const [configs, settings] = await Promise.all([
    sql`SELECT config, created_at FROM risk_config_versions ORDER BY id DESC LIMIT 1`,
    sql`SELECT new_entries_paused, updated_at FROM app_settings WHERE id = true`,
  ]);
  const config = configs[0]?.config;
  return {
    risk: config ? (typeof config === "string" ? JSON.parse(config) : config) as RiskConfig : fallback,
    newEntriesPaused: settings[0]?.new_entries_paused ?? false,
    updatedAt: settings[0]?.updated_at ?? configs[0]?.created_at ?? null,
  };
}

export async function saveRiskConfig(sql: Database, config: RiskConfig) {
  await sql`INSERT INTO risk_config_versions (config) VALUES (${sql.json(config as unknown as JSONValue)})`;
}

export async function setNewEntriesPaused(sql: Database, paused: boolean) {
  await sql`
    INSERT INTO app_settings (id, new_entries_paused, updated_at) VALUES (true, ${paused}, now())
    ON CONFLICT (id) DO UPDATE SET new_entries_paused = EXCLUDED.new_entries_paused, updated_at = EXCLUDED.updated_at
  `;
}

export interface PaperOrderSummary {
  id: string;
  ticker: string;
  status: string;
  limitPriceCents: number;
  requestedQuantity: number;
  filledQuantity: number;
  quoteAsOf: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PaperFillSummary {
  orderId: string | null;
  ticker: string;
  priceCents: number;
  quantity: number;
  feeCents: number;
  filledAt: string;
}

export interface PortfolioSummary {
  cashCents: number;
  atRiskCents: number;
  reservedCents: number;
  dayCostCents: number;
  positions: PaperPosition[];
  orders: PaperOrderSummary[];
  fills: PaperFillSummary[];
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
  const [positions, orderRows, fillRows, reserveRows] = await Promise.all([
    getOpenPositions(sql),
    sql`SELECT id, ticker, status, limit_price_cents, requested_quantity, filled_quantity, quote_as_of, expires_at, created_at FROM paper_orders ORDER BY created_at DESC LIMIT 50`,
    sql`SELECT order_id, ticker, price_cents, quantity, fee_cents, filled_at FROM paper_fills ORDER BY filled_at DESC LIMIT 50`,
    sql`SELECT COALESCE(SUM((requested_quantity - filled_quantity) * limit_price_cents + (requested_quantity - filled_quantity) * ${risk.feeCentsPerContract}), 0) AS total FROM paper_orders WHERE status IN ('resting', 'partial')`,
  ]);
  const atRiskCents = positions.reduce((sum, p) => sum + p.costBasisCents + p.totalFeesCents, 0);
  const reservedCents = Number(reserveRows[0].total);
  const dayCostCents = await getTodaysFillCost(sql, now);
  return {
    cashCents: risk.startingBankrollCents - atRiskCents - reservedCents,
    atRiskCents,
    reservedCents,
    dayCostCents,
    positions,
    orders: orderRows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      status: r.status,
      limitPriceCents: r.limit_price_cents,
      requestedQuantity: r.requested_quantity,
      filledQuantity: r.filled_quantity,
      quoteAsOf: r.quote_as_of,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
    fills: fillRows.map((r) => ({
      orderId: r.order_id,
      ticker: r.ticker,
      priceCents: Number(r.price_cents),
      quantity: r.quantity,
      feeCents: r.fee_cents,
      filledAt: r.filled_at,
    })),
  };
}

export async function persistPaperEntry(sql: Database, order: PaperOrder, fill: PaperFill, position: PaperPosition) {
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO paper_orders (id, decision_key, ticker, side, limit_price_cents, requested_quantity, filled_quantity, status, created_at)
      VALUES (${order.id}, ${order.decisionKey}, ${order.ticker}, ${order.side}, ${order.limitPriceCents}, ${order.requestedQuantity}, ${order.filledQuantity}, ${order.status}, ${order.createdAt})
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

export async function executePaperEntryAtomically(sql: Database, decision: CandidateDecision, risk: RiskConfig, now: Date) {
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('paper-entry-risk'))`;
    const decisionKey = `${decision.ticker}:${decision.marketAsOf}`;
    const duplicate = await transaction`SELECT id FROM paper_orders WHERE decision_key = ${decisionKey} LIMIT 1`;
    if (duplicate.length) return { status: "duplicate" as const, reason: "Decision already executed" };

    const settings = await transaction`SELECT new_entries_paused FROM app_settings WHERE id = true`;
    if (settings[0]?.new_entries_paused) {
      await transaction`INSERT INTO risk_events (ticker, decision_key, event_type, reason) VALUES (${decision.ticker}, ${decisionKey}, 'entry_blocked', 'New paper entries are paused')`;
      return { status: "rejected" as const, reason: "New paper entries are paused" };
    }

    const positions = (await transaction`
      SELECT ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at
      FROM paper_positions
      ORDER BY ticker
    `).map((r) => ({
      ticker: r.ticker,
      quantity: r.quantity,
      costBasisCents: r.cost_basis_cents,
      totalFeesCents: r.total_fees_cents,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const { start, end } = dayBounds(now);
    const daily = await transaction`
      SELECT COALESCE(SUM(price_cents * quantity + fee_cents), 0) AS total
      FROM paper_fills
      WHERE filled_at >= ${start.toISOString()} AND filled_at < ${end.toISOString()}
    `;
    const gameExposure = await transaction`
      SELECT COALESCE(SUM(p.cost_basis_cents + p.total_fees_cents), 0) AS total
      FROM paper_positions p
      JOIN markets held_market ON held_market.ticker = p.ticker
      JOIN markets candidate_market ON candidate_market.ticker = ${decision.ticker}
      WHERE held_market.game_id = candidate_market.game_id
    `;
    const atRiskCents = positions.reduce((sum, p) => sum + p.costBasisCents + p.totalFeesCents, 0);
    if (!decision.quote) return { status: "rejected" as const, reason: "Executable quote is unavailable" };
    const result = executePaperEntry(decision, decision.quote, risk, {
      cashCents: risk.startingBankrollCents - atRiskCents,
      positions,
      gameCostCents: Number(gameExposure[0].total),
      dayCostCents: Number(daily[0].total),
      dayStartsAt: start.toISOString(),
    }, now);
    if (result.rejection || !result.order || !result.fill || !result.position) {
      const reason = result.rejection ?? "Paper entry was rejected";
      await transaction`INSERT INTO risk_events (ticker, decision_key, event_type, reason) VALUES (${decision.ticker}, ${decisionKey}, 'entry_blocked', ${reason})`;
      return { status: "rejected" as const, reason };
    }

    const { order, fill, position } = result;
    await transaction`
      INSERT INTO paper_orders (id, decision_key, ticker, side, limit_price_cents, requested_quantity, filled_quantity, status, created_at)
      VALUES (${order.id}, ${order.decisionKey}, ${order.ticker}, ${order.side}, ${order.limitPriceCents}, ${order.requestedQuantity}, ${order.filledQuantity}, ${order.status}, ${order.createdAt})
    `;
    await transaction`
      INSERT INTO paper_fills (ticker, price_cents, quantity, fee_cents, filled_at)
      VALUES (${fill.ticker}, ${fill.priceCents}, ${fill.quantity}, ${fill.feeCents}, ${fill.filledAt})
    `;
    await transaction`
      INSERT INTO paper_positions (ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at)
      VALUES (${position.ticker}, ${position.quantity}, ${position.costBasisCents}, ${position.totalFeesCents}, ${position.createdAt}, ${position.updatedAt})
      ON CONFLICT (ticker) DO UPDATE SET quantity = EXCLUDED.quantity, cost_basis_cents = EXCLUDED.cost_basis_cents,
        total_fees_cents = EXCLUDED.total_fees_cents, updated_at = EXCLUDED.updated_at
    `;
    return { status: "filled" as const, reason: null };
  });
}

export async function expirePaperOrders(sql: Database, now: Date) {
  const rows = await sql`
    UPDATE paper_orders SET status = 'expired', updated_at = ${now.toISOString()}
    WHERE status IN ('resting', 'partial') AND expires_at <= ${now.toISOString()}
    RETURNING id
  `;
  return rows.length;
}

export async function getActivePaperOrders(sql: Database) {
  const rows = await sql`
    SELECT id, ticker FROM paper_orders
    WHERE status IN ('resting', 'partial')
    ORDER BY created_at
  `;
  return rows.map((r) => ({ id: r.id as string, ticker: r.ticker as string }));
}

export async function fillActivePaperOrder(
  sql: Database,
  orderId: string,
  orderbook: Orderbook,
  risk: RiskConfig,
  now: Date,
  maxQuoteAgeSeconds: number,
) {
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('paper-entry-risk'))`;
    const rows = await transaction`
      SELECT id, ticker, limit_price_cents, requested_quantity, filled_quantity, status, expires_at
      FROM paper_orders WHERE id = ${orderId} FOR UPDATE
    `;
    if (!rows.length || !["resting", "partial"].includes(rows[0].status)) return { status: "closed" as const, filledQuantity: 0 };
    if (new Date(rows[0].expires_at).getTime() <= now.getTime()) {
      await transaction`UPDATE paper_orders SET status = 'expired', updated_at = ${now.toISOString()} WHERE id = ${orderId}`;
      return { status: "expired" as const, filledQuantity: 0 };
    }
    const ageSeconds = (now.getTime() - new Date(orderbook.asOf).getTime()) / 1_000;
    if (ageSeconds < 0 || ageSeconds > maxQuoteAgeSeconds) return { status: "stale" as const, filledQuantity: 0 };
    const remaining = rows[0].requested_quantity - rows[0].filled_quantity;
    const fill = boundedYesFill(orderbook, remaining, rows[0].limit_price_cents);
    if (!fill) return { status: rows[0].status as "resting" | "partial", filledQuantity: 0 };
    const filledQuantity = rows[0].filled_quantity + fill.quantity;
    const status = filledQuantity === rows[0].requested_quantity ? "filled" : "partial";
    const feeCents = fill.quantity * risk.feeCentsPerContract;
    await transaction`UPDATE paper_orders SET filled_quantity = ${filledQuantity}, status = ${status}, quote_as_of = ${orderbook.asOf}, updated_at = ${now.toISOString()} WHERE id = ${orderId}`;
    await transaction`INSERT INTO paper_fills (order_id, ticker, price_cents, quantity, fee_cents, filled_at) VALUES (${orderId}, ${rows[0].ticker}, ${fill.averagePriceCents}, ${fill.quantity}, ${feeCents}, ${now.toISOString()})`;
    await transaction`
      INSERT INTO paper_positions (ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at)
      VALUES (${rows[0].ticker}, ${fill.quantity}, ${fill.totalCostCents}, ${feeCents}, ${now.toISOString()}, ${now.toISOString()})
      ON CONFLICT (ticker) DO UPDATE SET quantity = paper_positions.quantity + EXCLUDED.quantity,
        cost_basis_cents = paper_positions.cost_basis_cents + EXCLUDED.cost_basis_cents,
        total_fees_cents = paper_positions.total_fees_cents + EXCLUDED.total_fees_cents, updated_at = EXCLUDED.updated_at
    `;
    return { status: status as "partial" | "filled", filledQuantity: fill.quantity };
  });
}

export async function revalidateAndExecutePaperEntry(
  sql: Database,
  decision: CandidateDecision,
  orderbook: Orderbook,
  risk: RiskConfig,
  now: Date,
  maxQuoteAgeSeconds: number,
  orderTtlSeconds = 60,
) {
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('paper-entry-risk'))`;
    await transaction`
      UPDATE paper_orders SET status = 'expired', updated_at = ${now.toISOString()}
      WHERE status IN ('resting', 'partial') AND expires_at <= ${now.toISOString()}
    `;
    const decisionKey = `${decision.ticker}:${decision.marketAsOf}`;
    const ageSeconds = (now.getTime() - new Date(orderbook.asOf).getTime()) / 1_000;
    if (ageSeconds < 0 || ageSeconds > maxQuoteAgeSeconds) {
      const reason = "Revalidated market quote is stale";
      await transaction`INSERT INTO risk_events (ticker, decision_key, event_type, reason) VALUES (${decision.ticker}, ${decisionKey}, 'entry_blocked', ${reason})`;
      return { status: "rejected" as const, reason };
    }
    const duplicate = await transaction`SELECT id FROM paper_orders WHERE decision_key = ${decisionKey} LIMIT 1`;
    if (duplicate.length) return { status: "duplicate" as const, reason: "Decision already has a paper order" };
    const open = await transaction`SELECT id FROM paper_orders WHERE ticker = ${decision.ticker} AND status IN ('resting', 'partial') LIMIT 1`;
    if (open.length) return { status: "duplicate" as const, reason: "Ticker already has an open paper order" };
    const settings = await transaction`SELECT new_entries_paused FROM app_settings WHERE id = true`;
    if (settings[0]?.new_entries_paused) {
      const reason = "New paper entries are paused";
      await transaction`INSERT INTO risk_events (ticker, decision_key, event_type, reason) VALUES (${decision.ticker}, ${decisionKey}, 'entry_blocked', ${reason})`;
      return { status: "rejected" as const, reason };
    }
    if (!decision.quote) return { status: "rejected" as const, reason: "Original executable quote is unavailable" };

    const requestedCost = decision.quote.limitPriceCents * decision.quote.quantity + risk.feeCentsPerContract * decision.quote.quantity;
    const exposure = await transaction`
      SELECT
        COALESCE((SELECT SUM(cost_basis_cents + total_fees_cents) FROM paper_positions), 0) AS positions,
        COALESCE((SELECT SUM((requested_quantity - filled_quantity) * limit_price_cents + (requested_quantity - filled_quantity) * ${risk.feeCentsPerContract}) FROM paper_orders WHERE status IN ('resting', 'partial')), 0) AS orders,
        (SELECT COUNT(DISTINCT ticker) FROM (SELECT ticker FROM paper_positions UNION SELECT ticker FROM paper_orders WHERE status IN ('resting', 'partial')) active) AS active_count,
        EXISTS(SELECT 1 FROM paper_positions WHERE ticker = ${decision.ticker}) AS candidate_active,
        COALESCE((SELECT SUM(price_cents * quantity + fee_cents) FROM paper_fills WHERE filled_at >= date_trunc('day', ${now.toISOString()}::timestamptz) AND filled_at < date_trunc('day', ${now.toISOString()}::timestamptz) + interval '1 day'), 0) AS daily
    `;
    const gameExposure = await transaction`
      SELECT
        COALESCE(SUM(p.cost_basis_cents + p.total_fees_cents), 0) +
        COALESCE((SELECT SUM((o.requested_quantity - o.filled_quantity) * o.limit_price_cents + (o.requested_quantity - o.filled_quantity) * ${risk.feeCentsPerContract}) FROM paper_orders o JOIN markets om ON om.ticker = o.ticker WHERE om.game_id = candidate.game_id AND o.status IN ('resting', 'partial')), 0) AS total
      FROM markets candidate
      LEFT JOIN markets held ON held.game_id = candidate.game_id
      LEFT JOIN paper_positions p ON p.ticker = held.ticker
      WHERE candidate.ticker = ${decision.ticker}
      GROUP BY candidate.game_id
    `;
    const totalExposure = Number(exposure[0].positions) + Number(exposure[0].orders);
    const rejection = requestedCost > risk.maxCostPerEntryCents ? `Entry reservation exceeds ${risk.maxCostPerEntryCents}¢`
      : Number(gameExposure[0]?.total ?? 0) + requestedCost > risk.maxOpenCostPerGameCents ? `Game exposure would exceed ${risk.maxOpenCostPerGameCents}¢`
      : totalExposure + requestedCost > risk.maxTotalOpenCostCents ? `Total exposure would exceed ${risk.maxTotalOpenCostCents}¢`
      : Number(exposure[0].daily) + requestedCost > risk.maxDailyNewCostCents ? `Daily new cost limit ${risk.maxDailyNewCostCents}¢ would be exceeded`
      : Number(exposure[0].active_count) >= risk.maxConcurrentPositions && !exposure[0].candidate_active ? `Max concurrent positions ${risk.maxConcurrentPositions} reached`
      : totalExposure + requestedCost > risk.startingBankrollCents ? "Insufficient paper cash for order reservation"
      : null;
    if (rejection) {
      await transaction`INSERT INTO risk_events (ticker, decision_key, event_type, reason) VALUES (${decision.ticker}, ${decisionKey}, 'entry_blocked', ${rejection})`;
      return { status: "rejected" as const, reason: rejection };
    }

    const fill = boundedYesFill(orderbook, decision.quote.quantity, decision.quote.limitPriceCents);
    const filledQuantity = fill?.quantity ?? 0;
    const status = filledQuantity === 0 ? "resting" : filledQuantity === decision.quote.quantity ? "filled" : "partial";
    const orderId = `paper-${decisionKey}`;
    const expiresAt = new Date(now.getTime() + orderTtlSeconds * 1_000).toISOString();
    await transaction`
      INSERT INTO paper_orders (id, decision_key, ticker, side, limit_price_cents, requested_quantity, filled_quantity, status, quote_as_of, expires_at, created_at, updated_at)
      VALUES (${orderId}, ${decisionKey}, ${decision.ticker}, 'buy', ${decision.quote.limitPriceCents}, ${decision.quote.quantity}, ${filledQuantity}, ${status}, ${orderbook.asOf}, ${expiresAt}, ${now.toISOString()}, ${now.toISOString()})
    `;
    if (fill) {
      const feeCents = fill.quantity * risk.feeCentsPerContract;
      await transaction`
        INSERT INTO paper_fills (order_id, ticker, price_cents, quantity, fee_cents, filled_at)
        VALUES (${orderId}, ${decision.ticker}, ${fill.averagePriceCents}, ${fill.quantity}, ${feeCents}, ${now.toISOString()})
      `;
      await transaction`
        INSERT INTO paper_positions (ticker, quantity, cost_basis_cents, total_fees_cents, created_at, updated_at)
        VALUES (${decision.ticker}, ${fill.quantity}, ${fill.totalCostCents}, ${feeCents}, ${now.toISOString()}, ${now.toISOString()})
        ON CONFLICT (ticker) DO UPDATE SET quantity = paper_positions.quantity + EXCLUDED.quantity,
          cost_basis_cents = paper_positions.cost_basis_cents + EXCLUDED.cost_basis_cents,
          total_fees_cents = paper_positions.total_fees_cents + EXCLUDED.total_fees_cents, updated_at = EXCLUDED.updated_at
      `;
    }
    return { status: status as "resting" | "partial" | "filled", reason: null };
  });
}
