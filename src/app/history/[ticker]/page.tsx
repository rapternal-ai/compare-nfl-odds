import Link from "next/link";
import { executableYesQuote } from "@/domain/pricing";
import { defaultStrategy } from "@/domain/config";
import { loadMarketHistory } from "@/services/history";
import type { ExecutableQuote } from "@/domain/types";

export const dynamic = "force-dynamic";

const formatTime = (iso: string) =>
  new Date(iso).toISOString().slice(0, 19).replace("T", " ");
const money = (cents: number) => `${cents.toFixed(2)}¢`;
interface ChartPoint { asOf: string; value: number; }
interface BenchmarkPoint { asOf: string; probabilityCents: number; lowerBoundCents: number; }

function buildChart(pricePoints: ChartPoint[], benchmarkPoints: BenchmarkPoint[], decisions: { createdAt: string; action: string; reasons: string[] }[]) {
  const width = 800;
  const height = 320;
  const pad = 50;

  const allTimes = [
    ...pricePoints.map((p) => new Date(p.asOf).getTime()),
    ...benchmarkPoints.map((p) => new Date(p.asOf).getTime()),
    ...decisions.map((d) => new Date(d.createdAt).getTime()),
  ].sort((a, b) => a - b);

  if (allTimes.length === 0) return null;

  const minTime = allTimes[0];
  const maxTime = allTimes[allTimes.length - 1];
  const timeSpan = Math.max(maxTime - minTime, 1);

  const allValues = [
    ...pricePoints.map((p) => p.value),
    ...benchmarkPoints.map((p) => p.probabilityCents),
    ...benchmarkPoints.map((p) => p.lowerBoundCents),
  ];

  let minY = allValues.length ? Math.min(...allValues) : 0;
  let maxY = allValues.length ? Math.max(...allValues) : 100;
  const range = maxY - minY;
  const yPadding = Math.max(5, range * 0.1);
  minY = Math.max(0, minY - yPadding);
  maxY = Math.min(100, maxY + yPadding);
  if (minY === maxY) { minY = Math.max(0, minY - 5); maxY = Math.min(100, maxY + 5); }

  const xFor = (t: number) => pad + ((t - minTime) / timeSpan) * (width - 2 * pad);
  const yFor = (v: number) => height - pad - ((v - minY) / (maxY - minY)) * (height - 2 * pad);

  const pathFor = (points: { x: number; y: number }[]) =>
    points.length === 0 ? "" : `M ${points[0].x} ${points[0].y} ` + points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(" ");

  const pricePath = pathFor(pricePoints.map((p) => ({ x: xFor(new Date(p.asOf).getTime()), y: yFor(p.value) })));
  const benchmarkPath = pathFor(benchmarkPoints.map((p) => ({ x: xFor(new Date(p.asOf).getTime()), y: yFor(p.probabilityCents) })));
  const lowerBoundPath = pathFor(benchmarkPoints.map((p) => ({ x: xFor(new Date(p.asOf).getTime()), y: yFor(p.lowerBoundCents) })));

  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = minY + (i / 4) * (maxY - minY);
    return { y: yFor(v), label: money(v) };
  });

  const xTickCount = Math.min(4, allTimes.length);
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const t = minTime + (i / Math.max(1, xTickCount - 1)) * timeSpan;
    return { x: xFor(t), label: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
  });

  const decisionMarkers = decisions.map((d) => ({
    x: xFor(new Date(d.createdAt).getTime()),
    action: d.action,
    reasons: d.reasons,
    createdAt: d.createdAt,
  }));

  return { width, height, pad, pricePath, benchmarkPath, lowerBoundPath, yTicks, xTicks, decisionMarkers, xFor, yFor };
}

export default async function MarketHistoryPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const result = await loadMarketHistory(ticker);

  if (result.ok === false) {
    return (
      <main>
        <header>
          <div><p className="eyebrow">Phase A · audit</p><h1>Market History</h1></div>
          <Link href="/history" className="status">← History</Link>
        </header>
        <section className="panel warningPanel">
          <div className="panelHeading"><h2>{ticker}</h2></div>
          <p className="errorText">{result.error}</p>
        </section>
      </main>
    );
  }

  const history = result.data;
  const matchup = history.awayTeam && history.homeTeam ? `${history.awayTeam} at ${history.homeTeam}` : history.ticker;
  const pricePoints = history.snapshots
    .map((s) => ({ asOf: s.asOf, quote: executableYesQuote(s.orderbook, defaultStrategy.quantity) }))
    .filter((p): p is { asOf: string; quote: ExecutableQuote } => p.quote !== null)
    .map((p) => ({ asOf: p.asOf, value: p.quote.averagePriceCents }));

  const benchmarkPoints = history.probabilities.map((p) => ({
    asOf: p.asOf,
    probabilityCents: p.probabilityBps / 100,
    lowerBoundCents: p.lowerBoundBps / 100,
  }));

  const chart = buildChart(pricePoints, benchmarkPoints, history.decisions);

  const sortedDecisions = [...history.decisions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Phase A · audit</p>
          <h1>{matchup}</h1>
          <p>{history.ticker} · {history.yesOutcome} · {history.startsAt ? formatTime(history.startsAt) : "—"}</p>
        </div>
        <Link href="/history" className="status">← History</Link>
      </header>

      <section className="panel">
        <div className="panelHeading"><h2>Price & benchmark movement</h2><p>Executable ask vs. independent probability estimate over time.</p></div>
        {chart ? (
          <div className="chartWrap">
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="xMidYMid meet" width="100%" height="300">
              <rect x={0} y={0} width={chart.width} height={chart.height} fill="transparent" />
              {chart.yTicks.map((t, i) => (
                <g key={`y-${i}`}>
                  <line x1={chart.pad} y1={t.y} x2={chart.width - chart.pad} y2={t.y} className="chartGrid" />
                  <text x={chart.pad - 8} y={t.y + 4} className="chartLabel" textAnchor="end">{t.label}</text>
                </g>
              ))}
              {chart.xTicks.map((t, i) => (
                <g key={`x-${i}`}>
                  <line x1={t.x} y1={chart.pad} x2={t.x} y2={chart.height - chart.pad} className="chartGrid" />
                  <text x={t.x} y={chart.height - chart.pad + 20} className="chartLabel" textAnchor="middle">{t.label}</text>
                </g>
              ))}
              {chart.lowerBoundPath && (
                <path d={chart.lowerBoundPath} className="chartLine lower" fill="none" strokeDasharray="4 4" />
              )}
              {chart.benchmarkPath && (
                <path d={chart.benchmarkPath} className="chartLine benchmark" fill="none" />
              )}
              {chart.pricePath && (
                <path d={chart.pricePath} className="chartLine price" fill="none" />
              )}
              {pricePoints.map((p, i) => <circle key={`p-${i}`} cx={chart.xFor(new Date(p.asOf).getTime())} cy={chart.yFor(p.value)} r={3} className="chartDot price" />)}
              {benchmarkPoints.map((p, i) => (
                <circle key={`b-${i}`} cx={chart.xFor(new Date(p.asOf).getTime())} cy={chart.yFor(p.probabilityCents)} r={3} className="chartDot benchmark" />
              ))}
              {chart.decisionMarkers.map((d, i) => (
                <g key={`d-${i}`}>
                  <circle cx={d.x} cy={chart.height - chart.pad + 12} r={5} className={`chartDot ${d.action.toLowerCase()}`} />
                  <title>{formatTime(d.createdAt)} — {d.action.replace("_", " ")}{d.reasons.length ? `\n${d.reasons.join("\n")}` : ""}</title>
                </g>
              ))}
            </svg>
            <div className="chartLegend">
              <span><i className="dot price" />Executable ask</span>
              <span><i className="dot benchmark" />Benchmark</span>
              <span><i className="dot lower" />Lower bound</span>
              <span><i className="dot trade" />TRADE</span>
              <span><i className="dot no_trade" />NO TRADE</span>
            </div>
          </div>
        ) : (
          <p className="empty">No price or benchmark data has been captured for this market yet.</p>
        )}
      </section>

      <section className="panel">
        <div className="panelHeading"><h2>Decision reason changes</h2><p>Most recent decisions first. Rows are highlighted when the action or reasons changed.</p></div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Time</th><th>Action</th><th>Reasons</th></tr></thead>
            <tbody>
              {sortedDecisions.map((decision, index) => {
                const previous = sortedDecisions[index + 1];
                const changed = !previous || previous.action !== decision.action || previous.reasons[0] !== decision.reasons[0] || previous.reasons.length !== decision.reasons.length;
                return (
                  <tr key={`${decision.createdAt}-${index}`} className={changed ? "highlight" : ""}>
                    <td>{formatTime(decision.createdAt)}</td>
                    <td><span className={`badge ${decision.action.toLowerCase()}`}>{decision.action.replace("_", " ")}</span></td>
                    <td><small>{decision.reasons.join(" · ")}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
