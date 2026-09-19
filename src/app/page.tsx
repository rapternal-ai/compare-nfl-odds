import Link from "next/link";
import { loadCandidates } from "@/services/source";

const money = (cents: number | null) => cents === null ? "—" : `${cents.toFixed(2)}¢`;
const percent = (bps: number | null) => bps === null ? "—" : `${(bps / 100).toFixed(2)}%`;

export const dynamic = "force-dynamic";

export default async function Home() {
  const { candidates, source, warning } = await loadCandidates();
  const tradeCount = candidates.filter(({ action }) => action === "TRADE").length;

  return (
    <main>
      <header>
        <div><p className="eyebrow">Phase B · paper</p><h1>NFL Market Scanner</h1></div>
        <div className="nav">
          <div className="status"><span /> {source === "kalshi" ? "LIVE READ-ONLY" : "PAPER FIXTURES"}</div>
          <Link href="/portfolio" className="status">Portfolio →</Link>
          <Link href="/history" className="status">History →</Link>
          <Link href="/backtest" className="status">Backtest →</Link>
        </div>
      </header>
      {warning && <aside className="warning">{warning}</aside>}
      <section className="summary">
        <article><span>Markets scanned</span><strong>{candidates.length}</strong></article>
        <article><span>Eligible trades</span><strong>{tradeCount}</strong></article>
        <article><span>Execution</span><strong>Disabled</strong></article>
      </section>
      <section className="panel">
        <div className="panelHeading"><div><h2>Candidate decisions</h2><p>Executable asks, conservative probabilities, and explicit rejection reasons.</p></div><span>Updated {new Date().toISOString().slice(0, 19).replace("T", " ")}</span></div>
        <div className="tableWrap"><table>
          <thead><tr><th>Matchup</th><th>Ask / size</th><th>Benchmark</th><th>Net edge</th><th>Decision</th></tr></thead>
          <tbody>{candidates.map((candidate) => (
            <tr key={candidate.ticker}>
              <td><strong>{candidate.matchup}</strong><small>{candidate.ticker}<br />{candidate.startsAt ? new Date(candidate.startsAt).toISOString().slice(0, 19).replace("T", " ") : "Unmapped"}</small></td>
              <td>{money(candidate.quote?.averagePriceCents ?? null)}<small>{candidate.quote ? `${candidate.quote.quantity} contracts · limit ${candidate.quote.limitPriceCents}¢` : "Insufficient depth"}</small></td>
              <td>{percent(candidate.probability?.probabilityBps ?? null)}<small>{candidate.probability?.source ?? "Unavailable"}</small></td>
              <td className={(candidate.netEdgeBps ?? -1) >= 500 ? "positive" : "negative"}>{percent(candidate.netEdgeBps)}</td>
              <td><span className={`badge ${candidate.action.toLowerCase()}`}>{candidate.action.replace("_", " ")}</span><small>{candidate.reasons.join(" · ")}</small></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <footer>Read-only scanner. No credentials or order submission paths are enabled.</footer>
    </main>
  );
}
