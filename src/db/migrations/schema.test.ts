import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { type Database, type SqlRow, sql } from "../database";
import { migrate } from "../migrate";
import { openSqliteDatabase } from "../sqlite";
import { migrations } from "./index";

const objectRow = z.object({ type: z.string(), name: z.string() });

const decodeObject = (row: SqlRow) => {
  const { type, name } = objectRow.parse(row);

  return `${type}:${name}`;
};

const idRow = z.object({ id: z.string() });
const decodeId = (row: SqlRow) => idRow.parse(row).id;

const insertPaper = (id: string, title: string, abstract: string, author: string) =>
  sql(
    `INSERT INTO papers (id, title, abstract, authors, added_via, ingested_at)
     VALUES (?, ?, ?, json_array(?), 'manual', '2026-10-27T00:00:00.000Z')`,
    [id, title, abstract, author],
  );

const search = async (db: Database, query: string) =>
  db.all(
    sql(
      `SELECT papers.id AS id FROM papers_fts
       JOIN papers ON papers.pk = papers_fts.rowid
       WHERE papers_fts MATCH ? ORDER BY papers.id`,
      [query],
    ),
    decodeId,
  );

describe("schema", () => {
  let db: Database;

  beforeEach(async () => {
    db = openSqliteDatabase(":memory:");
    await migrate(db, migrations);
  });

  test("creates every table, index, and trigger", async () => {
    const objects = await db.all(
      sql(
        `SELECT type, name FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'papers_fts_%' OR name LIKE 'papers_fts_after_%'
         ORDER BY type, name`,
      ),
      decodeObject,
    );

    expect(objects).toEqual([
      "index:embeddings_model",
      "index:links_kind_external_id",
      "index:paper_tags_tag_id",
      "index:papers_hub_fetched_at",
      "index:papers_ingested_at",
      "index:papers_published_at",
      "index:signals_observed_on",
      "index:vectors_model",
      "table:embeddings",
      "table:ingest_cursors",
      "table:library",
      "table:links",
      "table:paper_tags",
      "table:papers",
      "table:papers_fts",
      "table:schema_migrations",
      "table:signals",
      "table:tags",
      "table:vectors",
      "table:watches",
      "trigger:papers_embedding_stale",
      "trigger:papers_fts_after_delete",
      "trigger:papers_fts_after_insert",
      "trigger:papers_fts_after_update",
    ]);
  });

  test("finds a paper by a word in its title, abstract, or author names", async () => {
    await db.batch([
      insertPaper(
        "2610.00001",
        "Diffusion distillation",
        "We make sampling faster.",
        "Ada Lovelace",
      ),
      insertPaper("2610.00002", "Sparse attention", "Long context transformers.", "Alan Turing"),
    ]);

    expect(await search(db, "distillation")).toEqual(["2610.00001"]);
    expect(await search(db, "transformer")).toEqual(["2610.00002"]);
    expect(await search(db, "turing")).toEqual(["2610.00002"]);
    expect(await search(db, "authors:lovelace")).toEqual(["2610.00001"]);
  });

  test("keeps the index current after an update or a delete", async () => {
    await db.run(
      insertPaper("2610.00001", "Diffusion distillation", "Old abstract.", "Ada Lovelace"),
    );
    await db.run(
      sql("UPDATE papers SET abstract = ? WHERE id = ?", ["New retrieval method.", "2610.00001"]),
    );

    expect(await search(db, "old")).toEqual([]);
    expect(await search(db, "retrieval")).toEqual(["2610.00001"]);

    await db.run(sql("DELETE FROM papers WHERE id = ?", ["2610.00001"]));

    expect(await search(db, "diffusion")).toEqual([]);
    await db.run(sql("INSERT INTO papers_fts (papers_fts) VALUES ('integrity-check')"));
  });

  test("deletes dependent rows with the paper", async () => {
    await db.batch([
      insertPaper("2610.00001", "A", "B", "C"),
      sql(
        "INSERT INTO links (paper_id, kind, external_id, url) VALUES ('2610.00001', 'github', 'a/b', 'https://github.com/a/b')",
      ),
      sql(
        "INSERT INTO signals (paper_id, source, observed_on, score) VALUES ('2610.00001', 'hf_daily_upvotes', '2026-10-23', 5)",
      ),
    ]);
    await db.run(sql("DELETE FROM papers WHERE id = '2610.00001'"));

    const remaining = await db.first(
      sql("SELECT (SELECT count(*) FROM links) + (SELECT count(*) FROM signals) AS count"),
      (row) => z.object({ count: z.number() }).parse(row).count,
    );

    expect(remaining).toBe(0);
  });

  test("rejects values outside the allowed sets", async () => {
    await db.run(insertPaper("2610.00001", "A", "B", "C"));

    await expect(
      db.run(
        sql(
          "INSERT INTO links (paper_id, kind, external_id, url) VALUES ('2610.00001', 'gitlab', 'x', 'y')",
        ),
      ),
    ).rejects.toThrow(/CHECK/);
    await expect(db.run(sql("UPDATE papers SET categories = '{}'"))).rejects.toThrow(/CHECK/);
    await expect(db.run(sql("UPDATE papers SET added_via = 'crawler'"))).rejects.toThrow(/CHECK/);
    await expect(db.run(sql("UPDATE papers SET authors = 'Ada'"))).rejects.toThrow(/CHECK|JSON/);
  });
});
