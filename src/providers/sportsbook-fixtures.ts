import type { NflGame, ProbabilityEstimate, ProbabilityProvider } from "@/domain/types";
import { consensusProbability, normalizeTwoWayMoneyline, type SportsbookMoneyline } from "@/domain/sportsbook";

export class SportsbookFixtureProbabilityProvider implements ProbabilityProvider {
  constructor(private readonly quotes: SportsbookMoneyline[]) {}

  async estimate(game: NflGame, outcome: string, asOf: Date): Promise<ProbabilityEstimate> {
    void asOf;
    const matching = this.quotes.filter((quote) =>
      quote.awayTeam === game.awayTeam &&
      quote.homeTeam === game.homeTeam &&
      Math.abs(new Date(quote.startsAt).getTime() - new Date(game.startsAt).getTime()) <= 5 * 60_000 &&
      quote.settlement === "kalshi-compatible"
    );
    const normalized = matching.map(normalizeTwoWayMoneyline);
    const side = outcome === game.awayTeam ? "away" : outcome === game.homeTeam ? "home" : null;
    if (!side) throw new Error("Outcome does not exactly match either mapped team");
    const values = normalized.map((quote) => side === "away" ? quote.awayProbabilityBps : quote.homeProbabilityBps);
    const consensus = consensusProbability(values);
    const oldestTimestamp = matching.reduce((oldest, quote) => quote.asOf < oldest ? quote.asOf : oldest, matching[0]?.asOf ?? "");
    return {
      gameId: game.id,
      outcome,
      probabilityBps: consensus.probabilityBps,
      lowerBoundBps: consensus.lowerBoundBps,
      source: `sportsbook-consensus-fixture:${matching.map(({ bookmaker }) => bookmaker).sort().join(",")}`,
      modelVersion: `two-way-proportional-devig-v1:uncertainty-${consensus.uncertaintyBps}bps`,
      asOf: oldestTimestamp,
    };
  }
}

export function buildSportsbookFixtures(game: NflGame, now = new Date()): SportsbookMoneyline[] {
  return [
    { bookmaker: "book-a", awayTeam: game.awayTeam, homeTeam: game.homeTeam, startsAt: game.startsAt, awayAmerican: -150, homeAmerican: 135, asOf: now.toISOString(), settlement: "kalshi-compatible" },
    { bookmaker: "book-b", awayTeam: game.awayTeam, homeTeam: game.homeTeam, startsAt: game.startsAt, awayAmerican: -145, homeAmerican: 130, asOf: now.toISOString(), settlement: "kalshi-compatible" },
    { bookmaker: "incompatible-book", awayTeam: game.awayTeam, homeTeam: game.homeTeam, startsAt: game.startsAt, awayAmerican: -155, homeAmerican: 140, asOf: now.toISOString(), settlement: "different" },
  ];
}
