"use server";

import { revalidatePath } from "next/cache";
import { updateEntryPause, updateRiskConfig } from "@/services/controls";

const cents = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);

export async function saveRiskAction(formData: FormData) {
  await updateRiskConfig({
    mode: "paper",
    startingBankrollCents: cents(formData.get("startingBankroll")),
    maxCostPerEntryCents: cents(formData.get("maxCostPerEntry")),
    maxOpenCostPerGameCents: cents(formData.get("maxOpenCostPerGame")),
    maxTotalOpenCostCents: cents(formData.get("maxTotalOpenCost")),
    maxDailyNewCostCents: cents(formData.get("maxDailyNewCost")),
    maxConcurrentPositions: formData.get("maxConcurrentPositions"),
    feeCentsPerContract: formData.get("feeCentsPerContract"),
  });
  revalidatePath("/portfolio");
}

export async function setEntryPauseAction(formData: FormData) {
  await updateEntryPause(formData.get("paused") === "true");
  revalidatePath("/portfolio");
}
