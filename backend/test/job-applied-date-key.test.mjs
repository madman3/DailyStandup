import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAppliedDateKey } from "../src/lifeosDb.js";

describe("resolveAppliedDateKey", () => {
  it("uses explicit year when present", () => {
    const k = resolveAppliedDateKey("2026-05-08", 10);
    assert.equal(k, "2026-05-08");
  });

  it("pins year by sheet row cohort for ambiguous MM/DD", () => {
    const k2026 = resolveAppliedDateKey("5/8", 4000);
    const k2025 = resolveAppliedDateKey("5/8", 3000);
    const k2024 = resolveAppliedDateKey("5/8", 1000);
    assert.equal(k2026, "2026-05-08");
    assert.equal(k2025, "2025-05-08");
    assert.equal(k2024, "2024-05-08");
  });

  it("pins year by sheet row cohort for month-name format", () => {
    const k = resolveAppliedDateKey("May 8", 4000);
    assert.equal(k, "2026-05-08");
  });
});

