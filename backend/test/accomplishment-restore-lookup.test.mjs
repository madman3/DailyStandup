import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAccomplishmentEntry, normalizeRestoredSortOrder } from "../src/todos.js";

describe("findAccomplishmentEntry", () => {
  const state = {
    days: {
      "2026-05-08": {
        accomplishments: [
          { id: "abc-1", title: "Cleanup kitchen", completedAt: "2026-05-08T12:00:00.000Z" },
        ],
      },
      "2026-05-09": {
        accomplishments: [
          { id: "abc-2", title: "HackerNoon article", completedAt: "2026-05-09T01:16:15.000Z" },
          { title: "Legacy no id", completedAt: "2026-05-09T02:00:00.000Z" },
        ],
      },
    },
  };

  it("finds by id with preferred dateKey", () => {
    const hit = findAccomplishmentEntry(state, "abc-2", "2026-05-09", {});
    assert.equal(hit?.dateKey, "2026-05-09");
    assert.equal(hit?.acc.title, "HackerNoon article");
    assert.equal(hit?.index, 0);
  });

  it("finds by id across days when preferred key wrong", () => {
    const hit = findAccomplishmentEntry(state, "abc-1", "2026-05-09", {});
    assert.equal(hit?.dateKey, "2026-05-08");
  });

  it("coerces numeric id in accomplishment to string match", () => {
    const st = {
      days: {
        "2026-01-01": {
          accomplishments: [{ id: 42, title: "Num", completedAt: "2026-01-01T00:00:00.000Z" }],
        },
      },
    };
    const hit = findAccomplishmentEntry(st, "42", "2026-01-01", {});
    assert.ok(hit);
    assert.equal(hit.acc.title, "Num");
  });

  it("falls back to title + completedAt when id missing", () => {
    const hit = findAccomplishmentEntry(state, undefined, "2026-05-09", {
      title: "Legacy no id",
      completedAt: "2026-05-09T02:00:00.000Z",
    });
    assert.ok(hit);
    assert.equal(hit.index, 1);
  });

  it("falls back to title + completedAt when id is wrong", () => {
    const hit = findAccomplishmentEntry(state, "wrong-id", "2026-05-09", {
      title: "HackerNoon article",
      completedAt: "2026-05-09T01:16:15.000Z",
    });
    assert.ok(hit);
    assert.equal(hit.acc.id, "abc-2");
  });

  it("returns null when nothing matches", () => {
    const hit = findAccomplishmentEntry(state, "nope", "2026-05-09", {
      title: "Nope",
      completedAt: "2026-05-09T01:16:15.000Z",
    });
    assert.equal(hit, null);
  });
});

describe("normalizeRestoredSortOrder", () => {
  it("fills missing keys and coerces numbers", () => {
    const o = normalizeRestoredSortOrder({ priority: 2, schedule: "bad" });
    assert.equal(o.priority, 2);
    assert.equal(o.schedule, null);
    assert.equal(o.unsorted, null);
  });
});
