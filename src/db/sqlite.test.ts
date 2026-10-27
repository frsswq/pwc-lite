import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { type Database, type SqlRow, sql } from "./database";
import { openSqliteDatabase } from "./sqlite";

const itemRow = z.object({ id: z.number(), label: z.string() });
const decodeItem = (row: SqlRow) => itemRow.parse(row);
const countRow = z.object({ count: z.number() });
const decodeCount = (row: SqlRow) => countRow.parse(row).count;
const textRow = z.object({ value: z.string() });
const decodeText = (row: SqlRow) => textRow.parse(row).value;

const countItems = async (db: Database) =>
  db.first(sql("SELECT count(*) AS count FROM items"), decodeCount);

const openWithItems = async () => {
  const db = openSqliteDatabase(":memory:");

  await db.run(
    sql("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL UNIQUE) STRICT"),
  );

  return db;
};

describe("openSqliteDatabase", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  test("runs statements and decodes rows", async () => {
    const db = await openWithItems();
    const inserted = await db.run(sql("INSERT INTO items (label) VALUES (?), (?)", ["a", "b"]));

    expect(inserted.changes).toBe(2);
    expect(await db.all(sql("SELECT id, label FROM items ORDER BY id"), decodeItem)).toEqual([
      { id: 1, label: "a" },
      { id: 2, label: "b" },
    ]);
    expect(
      await db.first(sql("SELECT id, label FROM items WHERE label = ?", ["b"]), decodeItem),
    ).toEqual({
      id: 2,
      label: "b",
    });
    await db.close();
  });

  test("returns undefined from first when no row matches", async () => {
    const db = await openWithItems();

    expect(
      await db.first(sql("SELECT id, label FROM items WHERE id = ?", [99]), decodeItem),
    ).toBeUndefined();
    await db.close();
  });

  test("propagates decoder errors", async () => {
    const db = await openWithItems();

    await db.run(sql("INSERT INTO items (label) VALUES (?)", ["a"]));
    await expect(db.all(sql("SELECT id FROM items"), decodeItem)).rejects.toThrow();
    await db.close();
  });

  test("batch applies every statement and reports changes", async () => {
    const db = await openWithItems();

    const results = await db.batch([
      sql("INSERT INTO items (label) VALUES (?)", ["a"]),
      sql("INSERT INTO items (label) VALUES (?), (?)", ["b", "c"]),
      sql("DELETE FROM items WHERE label = ?", ["missing"]),
    ]);

    expect(results).toEqual([{ changes: 1 }, { changes: 2 }, { changes: 0 }]);
    expect(await countItems(db)).toBe(3);
    await db.close();
  });

  test("batch with one failing statement applies no statements", async () => {
    const db = await openWithItems();

    await db.run(sql("INSERT INTO items (label) VALUES (?)", ["existing"]));

    const batch = db.batch([
      sql("INSERT INTO items (label) VALUES (?)", ["new"]),
      sql("UPDATE items SET label = ? WHERE label = ?", ["changed", "existing"]),
      sql("INSERT INTO items (label) VALUES (?)", ["new"]),
    ]);

    await expect(batch).rejects.toThrow(/UNIQUE/);
    expect(await db.all(sql("SELECT id, label FROM items"), decodeItem)).toEqual([
      { id: 1, label: "existing" },
    ]);
    await db.close();
  });

  test("enforces foreign keys", async () => {
    const db = await openWithItems();

    await db.run(sql("CREATE TABLE notes (item_id INTEGER NOT NULL REFERENCES items (id)) STRICT"));
    await expect(db.run(sql("INSERT INTO notes (item_id) VALUES (?)", [42]))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await db.close();
  });

  test("creates the parent directory and uses WAL mode for a file", async () => {
    const root = mkdtempSync(join(tmpdir(), "pwc-sqlite-"));

    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const db = openSqliteDatabase(join(root, "nested", "pwc.db"));

    expect(
      await db.first(sql("SELECT journal_mode AS value FROM pragma_journal_mode"), decodeText),
    ).toBe("wal");
    await db.close();
  });
});
