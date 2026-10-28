import { beforeEach, describe, expect, test } from "bun:test";

import type { Database } from "../db/database";
import { openTestCatalog } from "../testing/catalog";
import { createTableVectorIndex } from "./table-index";

const vector = (...values: number[]) => Float32Array.from(values);

describe("createTableVectorIndex", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
  });

  test("returns the nearest vectors by cosine similarity, most similar first", async () => {
    const index = createTableVectorIndex(db, "m");

    await index.upsert([
      { id: "east", vector: vector(1, 0) },
      { id: "north", vector: vector(0, 5) },
      { id: "north-east", vector: vector(2, 2) },
      { id: "west", vector: vector(-1, 0) },
    ]);

    const matches = await index.query(vector(3, 1), 3);

    expect(matches.map(({ id }) => id)).toEqual(["east", "north-east", "north"]);
    expect(matches[0]?.score).toBeCloseTo(3 / Math.sqrt(10), 5);
  });

  test("replaces the vector of an existing ID and removes deleted IDs", async () => {
    const index = createTableVectorIndex(db, "m");

    await index.upsert([
      { id: "a", vector: vector(1, 0) },
      { id: "b", vector: vector(0, 1) },
    ]);
    await index.upsert([{ id: "a", vector: vector(0, 1) }]);
    await index.delete(["b", "missing"]);

    expect(await index.query(vector(0, 1), 10)).toEqual([{ id: "a", score: 1 }]);
  });

  test("ignores vectors of another model", async () => {
    await createTableVectorIndex(db, "old").upsert([{ id: "a", vector: vector(1, 0, 0) }]);

    const index = createTableVectorIndex(db, "new");

    await index.upsert([{ id: "b", vector: vector(1, 0) }]);

    expect(await index.query(vector(1, 0), 10)).toEqual([{ id: "b", score: 1 }]);
  });

  test("rejects a zero vector", async () => {
    const index = createTableVectorIndex(db, "m");

    await expect(index.upsert([{ id: "a", vector: vector(0, 0) }])).rejects.toThrow(
      "Cannot normalize a zero vector",
    );
  });
});
