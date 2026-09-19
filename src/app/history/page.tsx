import Link from "next/link";
import { loadHistoryOverview } from "@/services/history";

export const dynamic = "force-dynamic";

const formatTime = (iso: string | null) =>
  (iso ? new Date(iso).toISOString().slice(0, 19).replace("T", " ") : "—");
const badgeClass = (status: string) =>
  `badge ${status === "completed" ? "trade" : status === "duplicate" ? "no_trade" : "no_trade"}`;

export default async function HistoryPage() {
  const result = await loadHistoryOverview();

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Phase A · audit</p>
          <h1>Scan History</h1>
        </div>
        <div className="nav">
          <Link href="/backtest" className="status">Backtest →</Link>
          <Link href="/" className="status">← Dashboard</Link>
        </div>
      </header>

      {result.ok === false ? (
        <section className="panel warningPanel">
          <div className="panelHeading"><h2>History unavailable</h2></div>
          <p className="errorText">{result.error}</p>
        </section>
      ) : (
        <>
          <section className="summary">
            <article><span>Markets tracked</span><strong>{result.data.markets.length}</strong></article>
            <article><span>Recent jobs</span><strong>{result.data.jobRuns.length}</strong></article>
            <article><span>Execution</span><strong>Disabled</strong></article>
          </section>

          <section className="panel">
            <div className="panelHeading"><h2>Recent scan jobs</h2></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Job ID</th><th>Status</th><th>Started</th><th>Completed</th><th>Error</th></tr></thead>
                <tbody>
                  {result.data.jobRuns.map((job) => (
                    <tr key={job.id}>
                      <td><strong>{job.id}</strong></td>
                      <td><span className={badgeClass(job.status)}>{job.status}</span></td>
                      <td>{formatTime(job.startedAt)}</td>
                      <td>{formatTime(job.completedAt)}</td>
                      <td><small className="errorText">{job.error}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panelHeading"><h2>Markets</h2><p>Select a market to view price, benchmark, and decision history.</p></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Matchup</th><th>Ticker</th><th>Last snapshot</th><th>Last decision</th><th>Action</th></tr></thead>
                <tbody>
                  {result.data.markets.map((m) => (
                    <tr key={m.ticker}>
                      <td>
                        <Link href={`/history/${encodeURIComponent(m.ticker)}`}>
                          <strong>{m.awayTeam && m.homeTeam ? `${m.awayTeam} at ${m.homeTeam}` : m.ticker}</strong>
                        </Link>
                        <small>{m.yesOutcome} · {formatTime(m.startsAt)}</small>
                      </td>
                      <td><code>{m.ticker}</code></td>
                      <td>{formatTime(m.lastSnapshotAt)}</td>
                      <td>{formatTime(m.lastDecisionAt)}</td>
                      <td>
                        <span className={`badge ${(m.lastAction ?? "no_trade").toLowerCase()}`}>{m.lastAction ? m.lastAction.replace("_", " ") : "—"}</span>
                        <small>{m.lastReasons.slice(0, 2).join(" · ")}</small>
                      </td>
                    </tr>
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
