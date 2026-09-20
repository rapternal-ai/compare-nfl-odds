import { z } from "zod";
import type { NflGame, ProbabilityEstimate, ProbabilityProvider } from "@/domain/types";
import { consensusProbability, normalizeTwoWayMoneyline, type SportsbookMoneyline } from "@/domain/sportsbook";

const bookmakerOddSchema = z.object({
  odds: z.string().regex(/^[+-]\d+$/),
  lastUpdatedAt: z.string().datetime(),
  available: z.boolean(),
});

const oddSchema = z.object({ byBookmaker: z.record(z.string(), bookmakerOddSchema) });
const teamSchema = z.object({ names: z.object({ long: z.string(), medium: z.string(), short: z.string() }) });
const eventSchema = z.object({
  eventID: z.string(),
  leagueID: z.literal("NFL"),
  teams: z.object({ home: teamSchema, away: teamSchema }),
  status: z.object({ startsAt: z.string().datetime(), started: z.boolean(), cancelled: z.boolean() }),
  odds: z.object({
    "points-home-game-ml-home": oddSchema.optional(),
    "points-away-game-ml-away": oddSchema.optional(),
  }),
});
const responseSchema = z.object({ success: z.literal(true), data: z.array(eventSchema), nextCursor: z.string().optional().nullable() });

type Event = z.infer<typeof eventSchema>;
type TeamNames = z.infer<typeof teamSchema>["names"];
type Fetch = typeof fetch;

const sharedEvents = new Map<string, { expiresAt: number; promise: Promise<Event[]> }>();

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
const retryDelayMs = (headers: Headers, attempt: number) => {
  const header = headers.get("retry-after");
  if (!header) return Math.min(250 * 2 ** attempt, 2_000);
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 30_000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30_000);
  return Math.min(250 * 2 ** attempt, 2_000);
};

const normalized = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

function matchesTeam(value: string, names: TeamNames) {
  const candidate = normalized(value);
  const aliases = [names.long, names.medium, names.short].map(normalized);
  return aliases.some((alias) => alias === candidate || alias.startsWith(candidate) || candidate.startsWith(alias));
}

function matchesGame(game: NflGame, event: Event) {
  return matchesTeam(game.awayTeam, event.teams.away.names) &&
    matchesTeam(game.homeTeam, event.teams.home.names) &&
    Math.abs(new Date(game.startsAt).getTime() - new Date(event.status.startsAt).getTime()) <= 5 * 60_000;
}

export class SportsGameOddsProbabilityProvider implements ProbabilityProvider {
  private eventsPromise: Promise<Event[]> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly request: Fetch = fetch,
    private readonly baseUrl = "https://api.sportsgameodds.com/v2",
    private readonly maxRetries = 3,
    private readonly startsWithinHours = 72,
    private readonly cacheTtlMs = request === fetch ? 10 * 60_000 : 0,
  ) {
    if (!apiKey) throw new Error("SPORTS_GAME_ODDS_API_KEY is required");
  }

  private async events(asOf: Date) {
    if (this.eventsPromise) return this.eventsPromise;
    const bucket = Math.floor(asOf.getTime() / Math.max(this.cacheTtlMs, 1));
    const key = `${this.baseUrl}:${this.startsWithinHours}:${bucket}`;
    const cached = sharedEvents.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.eventsPromise = cached.promise;
      return this.eventsPromise;
    }
    this.eventsPromise = this.fetchEvents(asOf);
    if (this.cacheTtlMs > 0) {
      sharedEvents.set(key, { expiresAt: Date.now() + this.cacheTtlMs, promise: this.eventsPromise });
      this.eventsPromise.catch(() => {
        const current = sharedEvents.get(key);
        if (current?.promise === this.eventsPromise) current.expiresAt = Date.now() + 60_000;
      });
    }
    return this.eventsPromise;
  }

  private async getJson(url: string) {
    let lastError = "";
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      const response = await this.request(url, {
        headers: { "x-api-key": this.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return response.json();
      const retryAfter = response.headers.get("retry-after");
      lastError = response.status === 429
        ? `SportsGameOdds request failed: 429${retryAfter ? `; retry after ${retryAfter}` : "; request cooldown active"}`
        : `SportsGameOdds request failed: ${response.status}`;
      const retryable = response.status >= 500 || (response.status === 429 && Boolean(retryAfter));
      if (retryable && attempt < this.maxRetries - 1) {
        await delay(retryDelayMs(response.headers, attempt));
        continue;
      }
      throw new Error(lastError);
    }
    throw new Error(lastError);
  }

  private async fetchEvents(asOf: Date) {
    const events: Event[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page += 1) {
      const query = new URLSearchParams({
        leagueID: "NFL",
        oddsAvailable: "true",
        live: "false",
        started: "false",
        startsAfter: asOf.toISOString(),
        startsBefore: new Date(asOf.getTime() + this.startsWithinHours * 60 * 60_000).toISOString(),
        oddID: "points-home-game-ml-home,points-away-game-ml-away",
        includeOpposingOdds: "true",
        limit: "100",
      });
      if (cursor) query.set("cursor", cursor);
      const parsed = responseSchema.parse(await this.getJson(`${this.baseUrl}/events?${query}`));
      events.push(...parsed.data);
      cursor = parsed.nextCursor ?? "";
      if (!cursor) return events.filter(({ status }) => !status.started && !status.cancelled);
    }
    throw new Error("SportsGameOdds pagination exceeded the configured page limit");
  }

  async estimate(game: NflGame, outcome: string, asOf: Date): Promise<ProbabilityEstimate> {
    const events = await this.events(asOf);
    const matches = events.filter((event) => matchesGame(game, event));
    if (matches.length !== 1) {
      const teamMatches = events.filter((event) => matchesTeam(game.awayTeam, event.teams.away.names) && matchesTeam(game.homeTeam, event.teams.home.names));
      const detail = teamMatches.length ? `; matching teams start at ${teamMatches.map(({ status }) => status.startsAt).join(", ")}` : `; ${events.length} NFL events returned`;
      throw new Error(`Expected exactly one SportsGameOdds event, found ${matches.length}${detail}`);
    }
    const event = matches[0];
    const outcomeSides = [
      matchesTeam(outcome, event.teams.away.names) ? "away" : null,
      matchesTeam(outcome, event.teams.home.names) ? "home" : null,
    ].filter(Boolean);
    if (outcomeSides.length !== 1) throw new Error("Outcome does not map to exactly one SportsGameOdds team");

    const home = event.odds["points-home-game-ml-home"]?.byBookmaker ?? {};
    const away = event.odds["points-away-game-ml-away"]?.byBookmaker ?? {};
    const quotes: SportsbookMoneyline[] = Object.keys(home).filter((bookmaker) => away[bookmaker]?.available && home[bookmaker].available).map((bookmaker) => ({
      bookmaker,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      startsAt: event.status.startsAt,
      awayAmerican: Number(away[bookmaker].odds),
      homeAmerican: Number(home[bookmaker].odds),
      asOf: away[bookmaker].lastUpdatedAt < home[bookmaker].lastUpdatedAt ? away[bookmaker].lastUpdatedAt : home[bookmaker].lastUpdatedAt,
      settlement: "kalshi-compatible",
    }));
    const normalizedQuotes = quotes.map(normalizeTwoWayMoneyline);
    const side = outcomeSides[0];
    const consensus = consensusProbability(normalizedQuotes.map((quote) => side === "away" ? quote.awayProbabilityBps : quote.homeProbabilityBps));
    const oldest = quotes.reduce((value, quote) => quote.asOf < value ? quote.asOf : value, quotes[0]?.asOf ?? "");
    return {
      gameId: game.id,
      outcome,
      probabilityBps: consensus.probabilityBps,
      lowerBoundBps: consensus.lowerBoundBps,
      source: `sports-game-odds:${quotes.map(({ bookmaker }) => bookmaker).sort().join(",")}`,
      modelVersion: `two-way-proportional-devig-v1:uncertainty-${consensus.uncertaintyBps}bps`,
      asOf: oldest,
    };
  }
}
