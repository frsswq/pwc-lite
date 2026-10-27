import { readCursor } from "../catalog/read-cursor";
import { advanceCursor, writeListedLink, writeListedPaper, writeSignal } from "../catalog/write";
import type { Database, Statement } from "../db/database";
import { addDays, dateRange, isIsoDate } from "../domain/dates";
import { fetchDailyPapers } from "../sources/hf-daily";
import type { HttpClient } from "../sources/http";

export const dailyCursorSource = "hf_daily";

export type DailyIngestOptions = {
  /** First date to fetch. When null, the job continues after the stored cursor. */
  readonly since: string | null;
  /** Current UTC date. The job fetches it, but does not mark it complete, because the list still grows. */
  readonly today: string;
  /** Days before `today` to fetch when there is no cursor and no `since`. */
  readonly lookbackDays: number;
  readonly token: string | null;
  /** Current instant as ISO 8601 text. */
  readonly now: string;
};

export type DailyIngestResult = {
  readonly dates: readonly string[];
  readonly papers: number;
  /** Rows that the job inserted or changed. Zero means that the job changed nothing. */
  readonly changes: number;
  readonly skippedIds: readonly string[];
};

const startDate = async (db: Database, options: DailyIngestOptions): Promise<string> => {
  if (options.since !== null) {
    return options.since;
  }

  const cursor = await readCursor(db, dailyCursorSource);

  return cursor === null ? addDays(options.today, -options.lookbackDays) : addDays(cursor, 1);
};

/**
 * Ingests Hugging Face Daily Papers, one date per batch.
 *
 * Each batch stores the date's papers, links, and upvotes with the cursor, so a stopped run continues after the last complete date.
 */
export const ingestDaily = async (
  db: Database,
  client: HttpClient,
  options: DailyIngestOptions,
): Promise<DailyIngestResult> => {
  for (const date of [options.since, options.today]) {
    if (date !== null && !isIsoDate(date)) {
      throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}"`);
    }
  }

  const start = await startDate(db, options);
  const dates = start <= options.today ? dateRange(start, options.today) : [options.today];
  const skippedIds: string[] = [];
  let papers = 0;
  let changes = 0;

  for (const date of dates) {
    const page = await fetchDailyPapers(client, date, options.token);
    const statements: Statement[] = [];

    for (const entry of page.entries) {
      statements.push(writeListedPaper(entry.paper, "hf_daily", options.now));
      statements.push(...entry.links.map(writeListedLink));
      statements.push(writeSignal(entry.signal));
    }

    if (date < options.today) {
      statements.push(advanceCursor(dailyCursorSource, date, options.now));
    }

    if (statements.length > 0) {
      const results = await db.batch(statements);

      changes += results.reduce((sum, result) => sum + result.changes, 0);
    }

    papers += page.entries.length;
    skippedIds.push(...page.skippedIds);
  }

  return { dates, papers, changes, skippedIds };
};
