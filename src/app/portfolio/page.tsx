import Link from "next/link";
import { loadPortfolioSummary } from "@/services/portfolio";
import { saveRiskAction, setEntryPauseAction } from "./actions";

const money = (cents: number) => `${(cents / 100).toFixed(2)}`;

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const summary = await loadPortfolioSummary();
  const risk = summary.controls.risk;

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
        <article><span>New entries</span><strong>{summary.controls.newEntriesPaused ? "Paused" : "Active"}</strong></article>
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Entry controls</h2></div>
        <form action={setEntryPauseAction}>
          <input type="hidden" name="paused" value={summary.controls.newEntriesPaused ? "false" : "true"} />
          <button type="submit">{summary.controls.newEntriesPaused ? "Resume new entries" : "Pause new entries"}</button>
        </form>
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
        <form action={saveRiskAction} className="configForm">
          <label>Starting bankroll ($)<input name="startingBankroll" type="number" min="0.01" step="0.01" defaultValue={money(risk.startingBankrollCents)} required /></label>
          <label>Max cost per entry ($)<input name="maxCostPerEntry" type="number" min="0.01" step="0.01" defaultValue={money(risk.maxCostPerEntryCents)} required /></label>
          <label>Max open cost per game ($)<input name="maxOpenCostPerGame" type="number" min="0.01" step="0.01" defaultValue={money(risk.maxOpenCostPerGameCents)} required /></label>
          <label>Max total open cost ($)<input name="maxTotalOpenCost" type="number" min="0.01" step="0.01" defaultValue={money(risk.maxTotalOpenCostCents)} required /></label>
          <label>Max daily new cost ($)<input name="maxDailyNewCost" type="number" min="0.01" step="0.01" defaultValue={money(risk.maxDailyNewCostCents)} required /></label>
          <label>Max concurrent positions<input name="maxConcurrentPositions" type="number" min="1" step="1" defaultValue={risk.maxConcurrentPositions} required /></label>
          <label>Fee per contract (¢)<input name="feeCentsPerContract" type="number" min="0" step="1" defaultValue={risk.feeCentsPerContract} required /></label>
          <button type="submit">Save risk configuration</button>
        </form>
      </section>

      <footer>Paper mode only. No real orders or credentials are used.</footer>
    </main>
  );
}
