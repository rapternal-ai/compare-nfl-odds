import { FixtureMarketDataProvider, FixtureProbabilityProvider } from "@/providers/fixtures";
import { scanMarkets } from "./scanner";

export function loadDemoCandidates(now = new Date()) {
  return scanMarkets({
    marketData: new FixtureMarketDataProvider(now),
    probabilities: new FixtureProbabilityProvider(now),
    now,
  });
}
