# Kalshi NFL Autopilot — Phase A

A read-only, fixture-first scanner for pregame NFL winner markets. It computes executable Yes asks from both sides of the Kalshi orderbook, applies freshness/liquidity/entry-window checks, compares prices with a timestamped independent benchmark, and emits deterministic `TRADE` or `NO_TRADE` decisions. It cannot authenticate or place orders.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The dashboard uses deterministic scenario fixtures by default, so PostgreSQL and external API access are not needed for local evaluation.

To scan current public Kalshi markets without credentials:

```bash
MARKET_DATA_SOURCE=kalshi npm run worker
MARKET_DATA_SOURCE=kalshi npm run dev
```

Live read-only mode validates each event as exactly two contracts with matching event IDs, start times, matchup rule text, and outcome-specific primary rules. Invalid or incomplete events are excluded. Because no licensed probability feed is configured yet, every live candidate is explicitly blocked as `NO_TRADE`.

## Commands

- `npm run dev` — dashboard development server
- `npm run db:up` — start the local PostgreSQL 17 container and wait for health
- `npm run db:migrate` — apply pending tracked migrations
- `npm run db:down` — stop the local container without deleting its volume
- `npm run worker` — claim an idempotent minute-level job, scan, and persist its audit trail
- `npm test` — unit and acceptance tests; run with `TEST_DATABASE_INTEGRATION=true` and `DATABASE_URL` exported to include PostgreSQL
- `npm run typecheck` — strict TypeScript validation
- `npm run lint` — ESLint
- `npm run build` — production Next.js build

## Environment

- `MARKET_DATA_SOURCE=fixtures` — deterministic local scenarios; set to `kalshi` for public live read-only discovery
- `PROBABILITY_SOURCE=sports-game-odds` — enables the server-side live NFL moneyline benchmark; use `fixtures` for synthetic tests
- `SPORTS_GAME_ODDS_API_KEY` — private SportsGameOdds key; keep it only in `.env.local`
- `KALSHI_API_BASE_URL` — public API base for paginated markets, rules, and fixed-point orderbooks
- `DATABASE_URL` — PostgreSQL connection target for applying `db/migrations`
- `GAME_FILTER` — optional comma-separated team substrings (e.g. `Bills,Dolphins`) to scan only matching KXNFLGAME events
- `GAME_STARTS_WITHIN_HOURS` — optional window (e.g. `6`) to discover only Kalshi markets whose kickoff is within the next N hours
- `SPORTS_GAME_ODDS_STARTS_WITHIN_HOURS` — optional window (e.g. `6`) to query only games starting within the next N hours

The benchmark proportionally removes two-way bookmaker overround, requires at least two comparable books, excludes settlement mismatches, and derives a conservative lower bound from cross-book dispersion with a 200-basis-point minimum uncertainty margin. Live matching requires one NFL event with matching teams and kickoff within five minutes. Provider errors and insufficient book coverage remain explicit `NO_TRADE` reasons. No API keys belong in the repository.

Each worker run claims a stable source-and-minute job ID before making provider requests. Duplicate claims exit without scanning. Successful runs transactionally upsert games, markets, and rule versions; store full market context, orderbooks, and SHA-256 input hashes; save probability estimates and decisions; and mark the job complete. Failed scans retain a failed job record and sanitized error.

## History

The dashboard includes read-only history views built from the persisted scan data:

- `/history` — recent scan jobs and every tracked market with its latest decision
- `/history/[ticker]` — price, benchmark, lower-bound, and decision timeline for one market
- `/backtest` — replay stored snapshots through the decision engine with an editable strategy JSON; see trade count, average net edge, and rejection reason frequency

Open `/history` from the dashboard, or navigate directly to a market detail page to see executable ask movement, benchmark probability movement, and how decision reasons have changed across scans. Use `/backtest` to test how different thresholds would have affected historical signals. All values are recomputed from stored orderbooks, probability estimates, and the exact market state captured at each snapshot; no orders or balances are shown.
