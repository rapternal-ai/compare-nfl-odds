import { z } from "zod";
import { defaultRisk } from "@/domain/config";
import type { RiskConfig } from "@/domain/types";
import { createDatabase } from "@/db/client";
import { getPaperControlState, saveRiskConfig, setNewEntriesPaused } from "@/db/repository";

const riskSchema = z.object({
  mode: z.literal("paper"),
  startingBankrollCents: z.coerce.number().int().positive(),
  maxCostPerEntryCents: z.coerce.number().int().positive(),
  maxOpenCostPerGameCents: z.coerce.number().int().positive(),
  maxTotalOpenCostCents: z.coerce.number().int().positive(),
  maxDailyNewCostCents: z.coerce.number().int().positive(),
  maxConcurrentPositions: z.coerce.number().int().positive(),
  feeCentsPerContract: z.coerce.number().int().nonnegative(),
});

export function parseRiskConfig(input: unknown): RiskConfig {
  const risk = riskSchema.parse(input);
  if (risk.maxCostPerEntryCents > risk.maxOpenCostPerGameCents) throw new Error("Max entry cost cannot exceed the per-game limit");
  if (risk.maxOpenCostPerGameCents > risk.maxTotalOpenCostCents) throw new Error("Per-game limit cannot exceed total open cost");
  if (risk.maxDailyNewCostCents > risk.startingBankrollCents) throw new Error("Daily new cost cannot exceed starting bankroll");
  return risk;
}

export async function loadPaperControls() {
  const sql = createDatabase();
  try {
    return await getPaperControlState(sql, defaultRisk);
  } finally {
    await sql.end();
  }
}

export async function updateRiskConfig(config: unknown) {
  const parsed = parseRiskConfig(config);
  const sql = createDatabase();
  try {
    await saveRiskConfig(sql, parsed);
  } finally {
    await sql.end();
  }
}

export async function updateEntryPause(paused: boolean) {
  const sql = createDatabase();
  try {
    await setNewEntriesPaused(sql, paused);
  } finally {
    await sql.end();
  }
}
