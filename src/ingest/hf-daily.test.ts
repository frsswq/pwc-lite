import { beforeEach, describe, expect, test } from "bun:test";

import { readCursor } from "../catalog/read-cursor";
import type { Database } from "../db/database";
import { openTestCatalog } from "../testing/catalog";
import { dumpCatalog } from "../testing/dump";
import { fakeHttp, jsonResponse, readFixture } from "../testing/fake-http";
import { type DailyIngestOptions, dailyCursorSource, ingestDaily } from "./hf-daily";

const fixture = await readFixture("hf-daily-2026-10-23.json");
const base = "https://huggingface.co/api/daily_papers?date=";

const options: DailyIngestOptions = {
  since: "2026-10-22",
  today: "2026-10-24",
  lookbackDays: 7,
  maxDates: null,
  token: null,
  now: "2026-10-24T08:00:00.000Z",
};

const serveFixture = (failOn: string | null = null) =>
  fakeHttp((url) => {
    if (failOn !== null && url === `${base}${failOn}`) {
      return new Response("", { status: 404 });
    }

    return url === `${base}2026-10-23` ? jsonResponse(fixture) : jsonResponse("[]");
  });

describe("ingestDaily", () => {
  let db: Database;

  beforeEach(async () => {
    db = await openTestCatalog();
  });

  test("stores papers, links, and signals, and marks only past dates complete", async () => {
    const result = await ingestDaily(db, serveFixture().client, options);
    const dump = await dumpCatalog(db);

    expect(result.dates).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(result.papers).toBe(5);
    expect(dump.papers.length).toBe(5);
    expect(dump.links.length).toBe(5);
    expect(dump.signals.length).toBe(5);
    expect(await readCursor(db, dailyCursorSource)).toBe("2026-10-23");
  });

  test("a second ingest of the same data does not change the database", async () => {
    await ingestDaily(db, serveFixture().client, options);

    const before = await dumpCatalog(db);

    const second = await ingestDaily(db, serveFixture().client, {
      ...options,
      now: "2026-10-24T09:00:00.000Z",
    });

    expect(second.changes).toBe(0);
    expect(await dumpCatalog(db)).toEqual(before);
  });

  test("a stopped ingest continues after the stored cursor", async () => {
    const stopped = { ...options, since: "2026-10-23", today: "2026-10-25" };

    await expect(ingestDaily(db, serveFixture("2026-10-24").client, stopped)).rejects.toThrow(
      "HTTP 404",
    );
    expect(await readCursor(db, dailyCursorSource)).toBe("2026-10-23");
    expect((await dumpCatalog(db)).papers.length).toBe(5);

    const http = serveFixture();
    const resumed = await ingestDaily(db, http.client, { ...stopped, since: null });

    expect(resumed.dates).toEqual(["2026-10-24", "2026-10-25"]);
    expect(http.requests.map(({ url }) => url)).toEqual([`${base}2026-10-24`, `${base}2026-10-25`]);
    expect(await readCursor(db, dailyCursorSource)).toBe("2026-10-24");
  });

  test("looks back from today when there is no cursor", async () => {
    const result = await ingestDaily(db, serveFixture().client, {
      ...options,
      since: null,
      lookbackDays: 2,
    });

    expect(result.dates).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
  });

  test("fetches only today when the cursor is already at yesterday", async () => {
    await ingestDaily(db, serveFixture().client, options);

    const result = await ingestDaily(db, serveFixture().client, { ...options, since: null });

    expect(result.dates).toEqual(["2026-10-24"]);
  });

  test("fetches at most maxDates dates, and the next run continues after them", async () => {
    const limited = { ...options, since: null, lookbackDays: 2, maxDates: 2 };
    const first = await ingestDaily(db, serveFixture().client, limited);
    const second = await ingestDaily(db, serveFixture().client, limited);

    expect(first.dates).toEqual(["2026-10-22", "2026-10-23"]);
    expect(second.dates).toEqual(["2026-10-24"]);
  });

  test("rejects a bad since date", async () => {
    await expect(
      ingestDaily(db, serveFixture().client, { ...options, since: "yesterday" }),
    ).rejects.toThrow(RangeError);
  });
});
