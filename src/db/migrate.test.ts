import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { type Database, type SqlRow, sql } from "./database";
import { type Migration, migrate, splitStatements } from "./migrate";
import { openSqliteDatabase } from "./sqlite";

const nameRow = z.object({ name: z.string() });
const decodeName = (row: SqlRow) => nameRow.parse(row).name;

const tableNames = async (db: Database) =>
  db.all(
    sql(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ),
    decodeName,
  );

const appliedNames = async (db: Database) =>
  db.all(sql("SELECT name FROM schema_migrations ORDER BY name"), decodeName);

const first: Migration = {
  name: "0001_items",
  text: `
    CREATE TABLE items (id INTEGER PRIMARY KEY) STRICT;
    --> statement-breakpoint
    CREATE INDEX items_id ON items (id);
  `,
};

const second: Migration = {
  name: "0002_tags",
  text: "CREATE TABLE tags (id INTEGER PRIMARY KEY) STRICT",
};

const broken: Migration = {
  name: "0003_broken",
  text: "CREATE TABLE extra (id INTEGER PRIMARY KEY) STRICT;\n--> statement-breakpoint\nCREATE TABLE nope (",
};

describe("splitStatements", () => {
  test("splits on breakpoint lines and drops empty parts", () => {
    expect(
      splitStatements("\nA;\n  --> statement-breakpoint  \nB;\n--> statement-breakpoint\n\n").map(
        ({ text }) => text,
      ),
    ).toEqual(["A;", "B;"]);
  });

  test("keeps a breakpoint marker that is not on its own line", () => {
    expect(splitStatements("SELECT 1; -- --> statement-breakpoint").length).toBe(1);
  });
});

describe("migrate", () => {
  test("applies pending migrations in order and records them", async () => {
    const db = openSqliteDatabase(":memory:");

    expect(await migrate(db, [first, second])).toEqual(["0001_items", "0002_tags"]);
    expect(await tableNames(db)).toEqual(["items", "schema_migrations", "tags"]);
    expect(await appliedNames(db)).toEqual(["0001_items", "0002_tags"]);
    await db.close();
  });

  test("a second run applies nothing", async () => {
    const db = openSqliteDatabase(":memory:");

    await migrate(db, [first, second]);
    expect(await migrate(db, [first, second])).toEqual([]);
    expect(await appliedNames(db)).toEqual(["0001_items", "0002_tags"]);
    await db.close();
  });

  test("applies only migrations added after the last run", async () => {
    const db = openSqliteDatabase(":memory:");

    await migrate(db, [first]);
    expect(await migrate(db, [first, second])).toEqual(["0002_tags"]);
    await db.close();
  });

  test("a failed run leaves the database unchanged", async () => {
    const db = openSqliteDatabase(":memory:");

    await migrate(db, [first]);
    await expect(migrate(db, [first, second, broken])).rejects.toThrow();
    expect(await tableNames(db)).toEqual(["items", "schema_migrations"]);
    expect(await appliedNames(db)).toEqual(["0001_items"]);
    await db.close();
  });

  test("stops when the database has an unknown migration", async () => {
    const db = openSqliteDatabase(":memory:");

    await migrate(db, [first, second]);
    await expect(migrate(db, [first])).rejects.toThrow(/unknown migration "0002_tags"/);
    await db.close();
  });

  test("rejects migrations that are out of order or badly named", async () => {
    const db = openSqliteDatabase(":memory:");

    await expect(migrate(db, [second, first])).rejects.toThrow(/not after/);
    await expect(migrate(db, [first, first])).rejects.toThrow(/not after/);
    await expect(migrate(db, [{ name: "init", text: "SELECT 1" }])).rejects.toThrow(
      /NNNN_snake_case/,
    );
    await db.close();
  });
});
