import { describe, expect, it } from "vitest";

import { memoryStorage } from "../../testing/storage.js";
import { type SnapshotStorage, loadSnapshot, saveSnapshot } from "./persist.js";

const broken: SnapshotStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const isCount = (value: unknown): value is { count: number } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { count?: unknown }).count === "number";

describe("snapshot persistence", () => {
  it("saves as JSON and loads it back", () => {
    const { storage, items } = memoryStorage();
    saveSnapshot({ key: "k", storage }, { count: 3 });
    expect(items.get("k")).toBe('{"count":3}');
    expect(loadSnapshot({ key: "k", storage }, isCount)).toEqual({ count: 3 });
  });

  it("loads nothing when the key is empty, malformed or invalid", () => {
    const { storage } = memoryStorage({ bad: "{", wrong: { count: "3" } });
    expect(loadSnapshot({ key: "missing", storage }, isCount)).toBeNull();
    expect(loadSnapshot({ key: "bad", storage }, isCount)).toBeNull();
    expect(loadSnapshot({ key: "wrong", storage }, isCount)).toBeNull();
  });

  it("carries on when storage throws", () => {
    expect(loadSnapshot({ key: "k", storage: broken }, isCount)).toBeNull();
    expect(() =>
      saveSnapshot({ key: "k", storage: broken }, { count: 1 }),
    ).not.toThrow();
  });
});
