import type { Database } from "../db/database";
import { createD1Database } from "../db/d1";
import { migrate } from "../db/migrate";
import { migrations } from "../db/migrations/index";
import { openSqliteDatabase } from "../db/sqlite";
import { parseArxivId } from "../domain/arxiv-id";
import type { ArxivId } from "../domain/arxiv-id";
import type { PaperRecord } from "../domain/paper";
import { fakeD1 } from "./fake-d1";

/**
 * Opens an in-memory database with every migration applied.
 *
 * With `PWC_TEST_DB=d1`, the database goes through the D1 implementation and a fake D1 binding,
 * so that the same tests check both implementations.
 */
export const openTestCatalog = async (): Promise<Database> => {
  const sqlite = openSqliteDatabase(":memory:");
  const db = Bun.env.PWC_TEST_DB === "d1" ? createD1Database(fakeD1(sqlite)) : sqlite;

  await migrate(db, migrations);

  return db;
};

export const arxivId = (text: string): ArxivId => {
  const parsed = parseArxivId(text);

  if (parsed === null) {
    throw new Error(`Test ID "${text}" is not an arXiv ID`);
  }

  return parsed.id;
};

export const paperRecord = (id: string, title: string): PaperRecord => ({
  id: arxivId(id),
  version: null,
  title,
  abstract: `Abstract of ${title}.`,
  authors: ["Ada Lovelace"],
  publishedAt: "2026-10-20T00:00:00.000Z",
  updatedAt: null,
  primaryCategory: null,
  categories: [],
  doi: null,
});
