import Link from "next/link";
import { defaultStrategy } from "@/domain/config";
import { loadHistoryOverview, loadMarketHistory } from "@/services/history";
import { runBacktest } from "@/services/backtest";

export const dynamic = "force-dynamic";

const money = (cents: number | null) => cents === null ? "—" : `${cents.toFixed(2)}¢`;
const percent = (bps: number | null) => bps === null ? "—" : `${(bps / 100).toFixed(2)}%`;
const formatTime = (iso: string) =>
  new Date(iso).toISOString().slice(0, 19).replace("T", " ");
const defaultConfig = JSON.stringify(defaultStrategy, null, 2);

export default async function BacktestPage({ searchParams }: { searchParams: Promise<{ ticker?: string; config?: string }> }) {
  const { ticker, config } = await searchParams;
  const overview = await loadHistoryOverview();
  const tickers = overview.ok ? overview.data.markets.map((m) => m.ticker) : [];

  const formConfig = config ? (() => {
    try {
      return JSON.stringify(JSON.parse(decodeURIComponent(config)), null, 2);
    } catch {
      return config;
    }
  })() : defaultConfig;

  let result = null;
  let error = null;
  if (ticker) {
    const loaded = await loadMarketHistory(ticker);
    if (!loaded.ok) {
      error = loaded.error;
    } else {
      result = runBacktest(loaded.data, config);
    }
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Phase A · backtest</p>
          <h1>Backtest Runner</h1>
          <p>Replay captured market snapshots through the decision engine with any strategy config.</p>
        </div>
        <Link href="/history" className="status">← History</Link>
      </header>

      {!overview.ok && (
        <section className="panel warningPanel">
          <p className="errorText">{overview.error}</p>
        </section>
      )}

      <section className="panel">
        <div className="panelHeading"><h2>Strategy &amp; market</h2><p>Paste a complete or partial strategy JSON to override defaults.</p></div>
        <form className="backtestForm" method="get" action="/backtest">
          <label>
            <span>Market ticker</span>
            <select name="ticker" required defaultValue={ticker ?? ""}>
              <option value="" disabled={!ticker}>Select a market</option>
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span>Strategy config (JSON)</span>
            <textarea name="config" rows={12} defaultValue={formConfig} />
          </label>
          <button type="submit" className="status">Run backtest</button>
        </form>
      </section>

      {error && (
        <section className="panel warningPanel">
          <p className="errorText">{error}</p>
        </section>
      )}

      {result && (
        <>
          <section className="summary">
            <article><span>Snapshots</span><strong>{result.points.length}</strong></article>
            <article><span>Trade signals</span><strong>{result.tradeCount}</strong></article>
            <article><span>Avg net edge</span><strong>{percent(result.avgNetEdgeBps)}</strong></article>
          </section>

          {result.error && (
            <section className="panel warningPanel">
              <p className="errorText">Config parse warning: {result.error}. Defaults were used for invalid fields.</p>
            </section>
          )}

          <section className="panel">
            <div className="panelHeading"><h2>Decision timeline</h2><p>Each row is a stored orderbook replayed through the current strategy.</p></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Snapshot time</th><th>Ask</th><th>Benchmark</th><th>Lower bound</th><th>Net edge</th><th>Action</th><th>Reasons</th></tr></thead>
                <tbody>
                  {result.points.map(({ asOf, decision, probability }) => (
                    <tr key={asOf}>
                      <td>{formatTime(asOf)}</td>
                      <td>{money(decision.quote?.averagePriceCents ?? null)}</td>
                      <td>{percent(probability?.probabilityBps ?? null)}</td>
                      <td>{percent(probability?.lowerBoundBps ?? null)}</td>
                      <td>{percent(decision.netEdgeBps)}</td>
                      <td><span className={`badge ${decision.action.toLowerCase()}`}>{decision.action.replace("_", " ")}</span></td>
                      <td><small>{decision.reasons.join(" · ")}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeading"><h2>Rejection reason frequency</h2></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Reason</th><th>Count</th></tr></thead>
                <tbody>
                  {Object.entries(result.reasonCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([reason, count]) => (
                      <tr key={reason}><td><small>{reason}</small></td><td><strong>{count}</strong></td></tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <footer>Read-only scanner. No credentials or order submission paths are enabled.</footer>
    </main>
  );
}
