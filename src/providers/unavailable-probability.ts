import type { NflGame, ProbabilityEstimate, ProbabilityProvider } from "@/domain/types";

export class UnavailableProbabilityProvider implements ProbabilityProvider {
  async estimate(game: NflGame, outcome: string, asOf: Date): Promise<ProbabilityEstimate> {
    void [game, outcome, asOf];
    throw new Error("No licensed probability feed is configured");
  }
}
