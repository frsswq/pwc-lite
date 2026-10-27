import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { type Database, type SqlRow, sql } from "../db/database";
import type { Link } from "../domain/paper";
import { arxivId, openTestCatalog, paperRecord } from "../testing/catalog";
import { readCursor } from "./read-cursor";
import {
  advanceCursor,
  writeArxivPaper,
  writeListedLink,
  writeListedPaper,
  writeSignal,
} from "./write";

const now = "2026-10-27T00:00:00.000Z";
const later = "2026-10-28T00:00:00.000Z";

const titleRow = z.object({ title: z.string(), added_via: z.string(), ingested_at: z.string() });
const decodeTitle = (row: SqlRow) => titleRow.parse(row);

const readPaper = async (db: Database) =>
  db.first(
    sql("SELECT title, added_via, ingested_at FROM papers WHERE id = '2610.00001'"),
    decodeTitle,
  );

const popularityRow = z.object({ popularity: z.number().nullable() });

const readPopularity = async (db: Database) =>
  db.first(sql("SELECT popularity FROM links"), (row) => popularityRow.parse(row).popularity);

const link = (popularity: number): Link => ({
  paperId: arxivId("2610.00001"),
  kind: "github",
  externalId: "a/b",
  url: "https://github.com/a/b",
  popularity,
  lastActivityAt: null,
});

describe("catalog writes", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
  });

  test("a repeated listed paper writes nothing", async () => {
    const paper = paperRecord("2610.00001", "First");

    expect((await db.run(writeListedPaper(paper, "hf_daily", now))).changes).toBe(1);
    expect((await db.run(writeListedPaper(paper, "manual", later))).changes).toBe(0);
    expect(await readPaper(db)).toEqual({
      title: "First",
      added_via: "hf_daily",
      ingested_at: now,
    });
  });

  test("a listed paper with new metadata updates the row and keeps its origin", async () => {
    await db.run(writeListedPaper(paperRecord("2610.00001", "First"), "hf_daily", now));

    expect(
      (await db.run(writeListedPaper(paperRecord("2610.00001", "Second"), "manual", later)))
        .changes,
    ).toBe(1);
    expect(await readPaper(db)).toEqual({
      title: "Second",
      added_via: "hf_daily",
      ingested_at: now,
    });
  });

  test("listed metadata does not replace arXiv metadata", async () => {
    await db.run(writeListedPaper(paperRecord("2610.00001", "Listed"), "hf_daily", now));
    await db.run(writeArxivPaper(paperRecord("2610.00001", "From arXiv"), "manual", later));

    expect(
      (await db.run(writeListedPaper(paperRecord("2610.00001", "Listed again"), "hf_daily", later)))
        .changes,
    ).toBe(0);
    expect(await readPaper(db)).toEqual({
      title: "From arXiv",
      added_via: "hf_daily",
      ingested_at: now,
    });
  });

  test("listed popularity does not replace a directly fetched value", async () => {
    await db.run(writeListedPaper(paperRecord("2610.00001", "First"), "hf_daily", now));
    await db.run(writeListedLink(link(10)));
    expect((await db.run(writeListedLink(link(10)))).changes).toBe(0);
    expect((await db.run(writeListedLink(link(11)))).changes).toBe(1);
    await db.run(sql("UPDATE links SET popularity = 50, fetched_at = ?", [now]));

    expect((await db.run(writeListedLink(link(12)))).changes).toBe(0);
    expect(await readPopularity(db)).toBe(50);
  });

  test("a signal updates only when the score changes", async () => {
    await db.run(writeListedPaper(paperRecord("2610.00001", "First"), "hf_daily", now));

    const signal = {
      paperId: arxivId("2610.00001"),
      source: "hf_daily_upvotes",
      observedOn: "2026-10-23",
    } as const;

    expect((await db.run(writeSignal({ ...signal, score: 3 }))).changes).toBe(1);
    expect((await db.run(writeSignal({ ...signal, score: 3 }))).changes).toBe(0);
    expect((await db.run(writeSignal({ ...signal, score: 4 }))).changes).toBe(1);
  });

  test("a cursor never moves back", async () => {
    await db.run(advanceCursor("hf_daily", "2026-10-23", now));
    expect((await db.run(advanceCursor("hf_daily", "2026-10-20", later))).changes).toBe(0);
    expect((await db.run(advanceCursor("hf_daily", "2026-10-23", later))).changes).toBe(0);
    expect(await readCursor(db, "hf_daily")).toBe("2026-10-23");
    await db.run(advanceCursor("hf_daily", "2026-10-24", later));
    expect(await readCursor(db, "hf_daily")).toBe("2026-10-24");
  });
});
