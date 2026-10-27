import type { Database } from "../db/database";
import { migrate } from "../db/migrate";
import { migrations } from "../db/migrations/index";
import { openSqliteDatabase } from "../db/sqlite";
import { parseArxivId } from "../domain/arxiv-id";
import type { ArxivId } from "../domain/arxiv-id";
import type { PaperRecord } from "../domain/paper";

/** Opens an in-memory database with every migration applied. */
export const openTestCatalog = async (): Promise<Database> => {
  const db = openSqliteDatabase(":memory:");

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
