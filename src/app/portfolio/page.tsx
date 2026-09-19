import Link from "next/link";
import { defaultRisk } from "@/domain/config";
import { loadPortfolioSummary } from "@/services/portfolio";

const money = (cents: number) => `${(cents / 100).toFixed(2)}`;

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const summary = await loadPortfolioSummary();

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Phase B · paper</p>
          <h1>Paper Portfolio</h1>
        </div>
        <div className="nav">
          <Link href="/" className="status">← Dashboard</Link>
        </div>
      </header>

      <section className="summary">
        <article><span>Cash</span><strong>${money(summary.cashCents)}</strong></article>
        <article><span>At risk</span><strong>${money(summary.atRiskCents)}</strong></article>
        <article><span>Today&apos;s cost</span><strong>${money(summary.dayCostCents)}</strong></article>
        <article><span>Positions</span><strong>{summary.positions.length}</strong></article>
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Open positions</h2></div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>Ticker</th><th>Quantity</th><th>Avg entry</th><th>Cost basis</th><th>Fees</th></tr>
            </thead>
            <tbody>
              {summary.positions.length === 0 && (
                <tr><td colSpan={5} className="empty">No paper positions yet.</td></tr>
              )}
              {summary.positions.map((p) => (
                <tr key={p.ticker}>
                  <td><strong>{p.ticker}</strong></td>
                  <td>{p.quantity}</td>
                  <td>{(p.costBasisCents / p.quantity).toFixed(2)}¢</td>
                  <td>${money(p.costBasisCents)}</td>
                  <td>${money(p.totalFeesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Risk limits</h2></div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>Limit</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr><td>Mode</td><td>{defaultRisk.mode}</td></tr>
              <tr><td>Starting bankroll</td><td>${money(defaultRisk.startingBankrollCents)}</td></tr>
              <tr><td>Max cost per entry</td><td>${money(defaultRisk.maxCostPerEntryCents)}</td></tr>
              <tr><td>Max open cost per game</td><td>${money(defaultRisk.maxOpenCostPerGameCents)}</td></tr>
              <tr><td>Max total open cost</td><td>${money(defaultRisk.maxTotalOpenCostCents)}</td></tr>
              <tr><td>Max daily new cost</td><td>${money(defaultRisk.maxDailyNewCostCents)}</td></tr>
              <tr><td>Max concurrent positions</td><td>{defaultRisk.maxConcurrentPositions}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <footer>Paper mode only. No real orders or credentials are used.</footer>
    </main>
  );
}
