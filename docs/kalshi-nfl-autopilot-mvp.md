# Kalshi NFL Autopilot — MVP Build Specification

**Status:** Build-ready scope, September 2026  
**Owner:** CJ  
**Purpose:** A personal, rules-driven app that discovers individual NFL game-winner markets on Kalshi, estimates whether an executable price is attractive, places constrained orders, manages open positions, and records every decision.

## 1. Outcome and boundaries

The user configures a bankroll allocation, allowed markets, minimum value threshold, position limits, and exit behavior. The app scans pregame NFL moneyline-equivalent event contracts, proposes or executes trades within those limits, and displays the evidence behind each action. An autonomous app must be able to decide **not to trade**; a weekly trade target is not a requirement.

**MVP includes** only single-game, pregame NFL winner markets; Yes/No contract pricing; a market/orderbook scanner; an independently sourced probability benchmark; fees and liquidity estimates; rule-based entries and exits; portfolio reconciliation; dashboard; audit trail; paper mode; Kalshi demo mode; and an explicitly enabled live mode.

**MVP excludes** combos, spreads, totals, player props, futures, in-game trades, multiple exchanges, margin/perpetuals, automatic funding or withdrawals, autonomous strategy rewrites, and AI-generated probabilities or unsupervised AI order placement.

The benchmark model is a hypothesis to evaluate, **not** evidence of a profitable edge. A price discrepancy may reflect latency, settlement-rule differences, or errors in the benchmark.

## 2. User experience

Dashboard: account mode and pause state; free cash and amount at risk; open positions; resting orders; realized/unrealized P&L; current eligible markets; and a timestamp for all price/model inputs.

Every candidate displays the matchup, event time, contract/rule link, executable ask and available size, benchmark probability, estimated fees, confidence/uncertainty buffer, estimated net edge, maximum permitted quantity, and a short *trade / no-trade reason*. Every action displays its triggering rule, input snapshot, order ID, fills, fees, and resulting position.

Controls: set and version strategy parameters; switch among `paper`, `demo`, and `live`; pause **new entries** independently of position monitoring; cancel resting entry orders; manually close an owned position with a limit; and export an audit CSV. Switching to live requires a separate explicit UI action; process restarts must not change mode.

## 3. Example configurable policy — placeholders, not recommended trade sizes

```yaml
mode: paper                   # paper | demo | live
market_series_allowlist: [KXNFLGAME]
allow_live_games: false
earliest_entry_hours_before_start: 72
latest_entry_minutes_before_start: 30
min_24h_volume_contracts: 1000
max_bid_ask_spread_cents: 3
min_visible_contracts_at_limit: 20
min_net_edge_percentage_points: 5
max_benchmark_age_seconds: 120
max_market_quote_age_seconds: 15
max_cost_per_entry_usd: 10
max_total_open_cost_usd: 100
max_open_cost_per_game_usd: 10
max_daily_new_cost_usd: 30
max_daily_realized_loss_usd: 20
max_concurrent_positions: 8
require_limit_orders: true
allow_partial_fills: true
auto_exit_if_net_edge_below_percentage_points: -2
auto_exit_min_net_profit_usd: 2
auto_exit_min_minutes_before_start: 10
```

Use currency/decimal arithmetic (never binary floating point for prices or quantities). Interpret caps against **all** open positions and resting orders, including manually placed Kalshi orders. Document whether an exit is triggered by revised estimated value, price appreciation, or a hard risk cap; mark-to-market loss alone should not automatically be mistaken for reduced probability.

## 4. Price and decision logic

1. Read eligible open markets and `rules_primary`/`rules_secondary`; map each contract to the exact NFL game and outcome. Do not guess from team abbreviations alone. Reject stale, suspended, changed, unresolved, and incorrectly mapped markets.
2. Read both sides of the order book. For a buy, use the **executable ask** and depth for the intended quantity, not the last trade or rounded percentage. For a sell, use the executable bid and depth. Estimate slippage by walking orderbook levels.
3. Import timestamped probabilities from an independent, licensed feed or a separately tested model. Initial comparison-only baseline: normalize both sides of consensus sportsbook moneylines to remove overround; handle ties and different settlement rules before calling them comparable. A sportsbook consensus is a benchmark, not ground truth.
4. Calculate a conservative lower-bound probability, accounting for model uncertainty. Estimate the all-in entry cost including fees and expected slippage. A simple single-contract decision score is `conservative_probability - executable_ask - per_contract_entry_fee - uncertainty_buffer`. Only place an entry if it exceeds the configured minimum edge **and** all eligibility/risk checks pass. Avoid counting an uncertainty buffer twice if the lower bound already incorporates it.
5. Estimate `EV_per_contract = p × settlement_value_if_yes + (1-p) × settlement_value_if_no - total_entry_cost`; normal winner markets usually have settlement values of $1 and $0, but model special resolutions and ties from the specific rules. Log assumptions rather than silently assuming binary settlement.
6. Before submitting, re-read market status, price, account balance, existing positions, and resting orders. Submit a bounded limit order with a stable client order ID; record actual fills, size, fees, and remaining quantity. Reconcile from exchange state after timeouts before retrying.
7. For an exit, compare the *actual executable bid after exit costs* against a current conservative hold value, any configured profit target, and remaining time. Submit a limit sell only up to the owned quantity. A triggered exit is **not** a guaranteed sale; partial fills and no buyer must be shown honestly.

**Example:** A model says 70% and the Yes ask is 64¢. If fees/slippage total 2¢ and the uncertainty/required-edge margin is 5 points, the margin is `70 - 64 - 2 - 5 = -1` point: no trade. “70% favorite” alone is irrelevant.

## 5. System design

Use TypeScript end to end to simplify handoff to AI coding assistants: Next.js dashboard and server routes, a separate Node.js worker for scheduled scans/order management, PostgreSQL for durable state, and a typed Kalshi adapter. A small Python model service is optional **later**, only if backtesting warrants it. Store API signing material server-side in secrets management; never send private keys to the browser or logs. Keep demo and live credentials distinct.

Interfaces:

```ts
interface MarketDataProvider {
  listEligibleMarkets(): Promise<Market[]>;
  getOrderbook(ticker: string): Promise<Orderbook>;
  getMarketRules(ticker: string): Promise<MarketRules>;
}
interface ProbabilityProvider {
  estimate(game: NflGame, asOf: Date): Promise<ProbabilityEstimate>;
}
interface TradingAdapter {
  getBalance(): Promise<Balance>;
  getPositions(): Promise<Position[]>;
  getOpenOrders(): Promise<Order[]>;
  placeLimitOrder(request: EntryOrExit): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
}
```

Implement `PaperTradingAdapter`, `KalshiDemoAdapter`, and `KalshiLiveAdapter` behind the same interface. Paper mode should simulate realistic bid/ask, partial fills, fees, and refusal to fill stale quotes. The decision engine must not know which adapter is active.

Tables: `markets`, `games`, `market_rules_versions`, `market_snapshots`, `probability_estimates`, `strategy_config_versions`, `decisions`, `orders`, `fills`, `positions`, `account_snapshots`, `risk_events`, and `job_runs`. Store timestamps, source/model version, input snapshot hash, quote depth, expected vs actual fee, and a unique decision/order id. Use idempotent job execution and reconcile exchange state at startup and regularly during operation.

## 6. Risk controls that are enforceable in code

- Hard caps for dollars per order, game, day, and across positions **plus outstanding orders**. Check them atomically before entry to prevent parallel workers from overspending.
- No new entry when any input is stale, the source feed fails, market is suspended, the matchup mapping is uncertain, orderbook depth is insufficient, a known major status update is pending, or the exchange/account state cannot be reconciled.
- Limit orders only, with an expiration appropriate to the quote age; cancel stale resting entries. Handle partial fills, duplicate messages, rate limits, API errors, and retry ambiguity.
- A manual kill switch disables new orders and cancels resting entries; it does **not** assume open positions can be liquidated. Continue monitoring existing positions and notify the user if an exit cannot fill.
- Separate daily loss limits from realized/unrealized P&L. Auto-pause on breached loss cap or repeated reconciliation failure. An exchange-side order group may help bound rapid order bursts, but **its rolling contract limit is not a substitute for dollar exposure and daily loss rules**.
- Log every rejection and trade. No LLM may bypass policy checks or submit raw order parameters.

## 7. Build sequence for an AI coding assistant

### Phase A — Data and decision-only scanner

- Bootstrap Next.js/TypeScript, worker, Postgres migrations, env examples, typed DTOs, and seed fixtures.
- Read-only Kalshi markets/orderbooks, game mapping, rules/status validation, and independent benchmark ingestion.
- Build a dashboard showing executable bid/ask, depth, data age, normalized probability, estimated costs, and explicit no-trade reasons.
- Add historical snapshot storage and backtest runner; quantify missing data and look-ahead bias. **No account credentials needed.**

### Phase B — Paper portfolio

- Add config UI, risk engine, paper trading adapter, idempotent scheduler, entry/exit lifecycle, notifications, and audit history.
- Replay historical or captured orderbooks with realistic fees and liquidity. Compare theoretical signals against fillable opportunities and calculate calibration, ROI after costs, maximum drawdown, trade frequency, and reason for skipped trades.
- Keep paper mode running over multiple NFL slates before deciding that a model merits live use. A backtest alone is insufficient.

### Phase C — Kalshi demo

- Add authenticated API client, separate demo keys, fills/positions polling or WebSocket reconciliation, cancellation, and recovery from interrupted requests.
- Run the identical rules on mock funds in Kalshi's demo environment. Compare actual fills/fees to paper estimates and fix discrepancies.

### Phase D — Optional live mode

- Add a deliberate mode activation flow and narrowly scoped API key/subaccount if available for the account; use small configurable limits.
- Require live-mode acceptance criteria below. Start with limited exposure and monitor audit/alerts. No auto-increase in budget.

## 8. Acceptance criteria and meaningful tests

**Market integrity:** Two real game fixtures map to exactly one NFL matchup and two outcomes; ambiguous abbreviations, rule changes, and postponed/closed markets are excluded. A tie/partial settlement fixture is priced according to the recorded rule version.

**Pricing:** Given a multi-level order book, the scanner computes the correct executable total for a specified quantity, refuses insufficient depth, and accounts for fees. A scenario with a favorable displayed percent but unfavorable ask must produce `NO_TRADE`.

**Risk:** Parallel decisions cannot exceed caps, including resting orders. A loss limit and stale benchmark block new entries. A sell never exceeds owned quantity, and an unfilled exit remains visible as open risk.

**Recovery:** After an order-response timeout, restart and reconcile fills/positions without placing a duplicate. A mid-order pause cancels resting entries but does not misstate open positions. Demo and live credentials cannot cross environments.

**Release gate:** Demo transactions match Kalshi-reported fills, fees, and position counts; an audit record reconstructs every decision. The benchmark has been measured on held-out historical games and shadow-mode slates, with results shown *after* fees and realistic execution. If performance is uncertain or negative, stay in paper/demo mode.

## 9. Recommended first coding prompt

> Implement Phase A from `kalshi-nfl-autopilot-mvp.md`. Start by creating the Next.js dashboard, separate TypeScript worker, Postgres schema/migrations, and read-only Kalshi adapter. Implement eligibility filtering for pregame `KXNFLGAME` winners, orderbook-based executable quotes, source/model timestamps, and a pure deterministic decision function. Use fixtures for normal, tied, postponed, stale, and shallow-book markets. Do not add authenticated trading, account secrets, or live-order code in Phase A. Show the full file tree, run typecheck and tests, and document commands and environment variables.

## 10. Primary documentation and implementation notes

- [Kalshi markets API](https://docs.kalshi.com/api-reference/market/get-markets): market filters, rules, status, bid/ask, and metadata.
- [Orderbook responses](https://docs.kalshi.com/getting_started/orderbook_responses): Yes asks are derived from No bids; calculate executable depth.
- [Create order V2](https://docs.kalshi.com/api-reference/orders/create-order-v2), [order direction](https://docs.kalshi.com/getting_started/order_direction), and [rate limits](https://docs.kalshi.com/getting_started/rate_limits): verify current schema before coding authenticated execution.
- [Kalshi demo environment](https://docs.kalshi.com/getting_started/demo_env), [fees](https://help.kalshi.com/en/articles/13823805-fees), and [order groups](https://docs.kalshi.com/api-reference/order-groups/create-order-group): use the applicable fee and contract rules for each market.
- [Example NFL game market](https://kalshi.com/markets/kxnflgame/professional-football-game/kxnflgame-26aug28wasbal): game-specific rule text includes treatment of ties; never generalize one market's rule without reading the target market.

APIs, fee schedules, eligibility, and event rules change. Treat these links as starting points and verify the current docs/contract text during implementation.
