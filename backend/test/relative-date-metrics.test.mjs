import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPerDayPatches } from "../src/extractMessage.js";

describe("buildPerDayPatches relative-date handling", () => {
  it("does not backfill top-level macros to primary when only non-primary metricsByDate exists", () => {
    const primaryDateKey = "2026-05-09";
    const extracted = {
      sleepHours: null,
      steps: null,
      jobsApplied: null,
      workout: null,
      caloriesBurned: null,
      macros: { protein: 70, carbs: null, fat: null, calories: null },
      dailyScore: null,
      metricsByDate: {
        "2026-05-08": {
          macros: { protein: 70, carbs: null, fat: null, calories: null },
        },
      },
      tasks: [],
    };

    const patches = buildPerDayPatches(extracted, primaryDateKey);
    assert.ok(patches["2026-05-08"]);
    assert.equal(patches["2026-05-08"].macros?.protein, 70);
    assert.ok(patches[primaryDateKey]);
    assert.equal(patches[primaryDateKey].macros?.protein, undefined);
  });

  it("still backfills top-level macros when no explicit non-primary date exists", () => {
    const primaryDateKey = "2026-05-09";
    const extracted = {
      sleepHours: null,
      steps: null,
      jobsApplied: null,
      workout: null,
      caloriesBurned: null,
      macros: { protein: 70, carbs: null, fat: null, calories: null },
      dailyScore: null,
      metricsByDate: {},
      tasks: [],
    };

    const patches = buildPerDayPatches(extracted, primaryDateKey);
    assert.equal(patches[primaryDateKey].macros?.protein, 70);
  });
});

