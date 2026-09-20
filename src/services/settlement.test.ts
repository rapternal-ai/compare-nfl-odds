import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settlePaper } from "./settlement";

describe("settlePaper", () => {
  it("rejects invalid values before opening a database connection", async () => {
    await assert.rejects(() => settlePaper("TEST", -1), /integer from 0 to 100/);
    await assert.rejects(() => settlePaper("TEST", 101), /integer from 0 to 100/);
    await assert.rejects(() => settlePaper("TEST", 50.5), /integer from 0 to 100/);
    await assert.rejects(() => settlePaper("", 100), /Ticker is required/);
  });
});
