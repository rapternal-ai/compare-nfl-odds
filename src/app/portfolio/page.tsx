import Link from "next/link";
import { loadPortfolioSummary } from "@/services/portfolio";
import { saveRiskAction, setEntryPauseAction, settlePaperAction } from "./actions";

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
        <article><span>Reserved</span><strong>${money(summary.reservedCents)}</strong></article>
        <article><span>Realized P&amp;L</span><strong>${money(summary.realizedPnlCents)}</strong></article>
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
              <tr><th>Ticker</th><th>Quantity</th><th>Avg entry</th><th>Market value</th><th>Unrealized P&amp;L</th><th>Settlement</th></tr>
            </thead>
            <tbody>
              {summary.positions.length === 0 && (
                <tr><td colSpan={6} className="empty">No paper positions yet.</td></tr>
              )}
              {summary.positions.map((p) => (
                <tr key={p.ticker}>
                  <td><strong>{p.ticker}</strong></td>
                  <td>{p.quantity}</td>
                  <td>{(p.costBasisCents / p.quantity).toFixed(2)}¢</td>
                  <td>{p.marketValueCents === null ? "Insufficient bid depth" : `$${money(p.marketValueCents)}`}</td>
                  <td>{p.unrealizedPnlCents === null ? "—" : `$${money(p.unrealizedPnlCents)}`}</td>
                  <td>
                    <form action={settlePaperAction}>
                      <input type="hidden" name="ticker" value={p.ticker} />
                      <button name="settlementValueCents" value="100">Settle Yes</button>
                      <button name="settlementValueCents" value="0">Settle No</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Paper orders</h2></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Ticker</th><th>Status</th><th>Filled</th><th>Limit</th><th>Expires</th></tr></thead>
            <tbody>
              {summary.orders.length === 0 && <tr><td colSpan={5}>No paper orders yet.</td></tr>}
              {summary.orders.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.ticker}</strong><small>{order.id}</small></td>
                  <td><span className={`badge ${order.status === "filled" ? "trade" : "no_trade"}`}>{order.status}</span></td>
                  <td>{order.filledQuantity} / {order.requestedQuantity}</td>
                  <td>{order.limitPriceCents}¢</td>
                  <td>{order.expiresAt ? new Date(order.expiresAt).toISOString().slice(0, 19).replace("T", " ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Recent fills</h2></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Ticker</th><th>Quantity</th><th>Price</th><th>Fee</th><th>Filled</th></tr></thead>
            <tbody>
              {summary.fills.length === 0 && <tr><td colSpan={5}>No paper fills yet.</td></tr>}
              {summary.fills.map((fill, index) => (
                <tr key={`${fill.orderId}-${fill.filledAt}-${index}`}>
                  <td><strong>{fill.ticker}</strong></td>
                  <td>{fill.quantity}</td>
                  <td>{fill.priceCents.toFixed(2)}¢</td>
                  <td>{fill.feeCents}¢</td>
                  <td>{new Date(fill.filledAt).toISOString().slice(0, 19).replace("T", " ")}</td>
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
          <label>Max daily realized loss ($)<input name="maxDailyRealizedLoss" type="number" min="0.01" step="0.01" defaultValue={money(risk.maxDailyRealizedLossCents)} required /></label>
          <label>Exit edge threshold (percentage points)<input name="autoExitIfNetEdgeBelow" type="number" step="0.01" defaultValue={risk.autoExitIfNetEdgeBelowBps / 100} required /></label>
          <label>Minimum exit profit ($)<input name="autoExitMinNetProfit" type="number" min="0" step="0.01" defaultValue={money(risk.autoExitMinNetProfitCents)} required /></label>
          <label>Minimum minutes before start<input name="autoExitMinMinutesBeforeStart" type="number" min="0" step="1" defaultValue={risk.autoExitMinMinutesBeforeStart} required /></label>
          <label>Fee per contract (¢)<input name="feeCentsPerContract" type="number" min="0" step="1" defaultValue={risk.feeCentsPerContract} required /></label>
          <button type="submit">Save risk configuration</button>
        </form>
      </section>

      <footer>Paper mode only. No real orders or credentials are used.</footer>
    </main>
  );
}
