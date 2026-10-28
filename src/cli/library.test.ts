import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { writeListedPaper } from "../catalog/write";
import type { Database } from "../db/database";
import { openTestCatalog, paperRecord } from "../testing/catalog";
import { runTestCli } from "../testing/cli";
import { dumpCatalog } from "../testing/dump";
import { type FakeHttp, fakeHttp } from "../testing/fake-http";

const now = "2026-10-24T08:00:00.000Z";
const old = "2023-01-01T00:00:00.000Z";

const oldPaper = (id: string, title: string) => ({ ...paperRecord(id, title), publishedAt: old });

const libraryJson = z.array(
  z.object({
    paper: z.object({ id: z.string() }),
    library: z.object({
      savedAt: z.string().nullable(),
      note: z.string().nullable(),
      tags: z.array(z.string()),
    }),
  }),
);

const hitIds = z.array(z.object({ paper: z.object({ id: z.string() }) }));

describe("library commands", () => {
  let db: Database;
  let http: FakeHttp;

  beforeEach(async () => {
    db = await openTestCatalog();
    http = fakeHttp(() => undefined);
    await db.batch([
      writeListedPaper(oldPaper("2301.00001", "Diffusion one"), "hf_daily", old),
      writeListedPaper(oldPaper("2301.00002", "Diffusion two"), "hf_daily", old),
      writeListedPaper(oldPaper("2301.00003", "Diffusion three"), "hf_daily", old),
      writeListedPaper(oldPaper("2301.00004", "Diffusion four"), "hf_daily", old),
    ]);
  });

  const run = async (...argv: string[]) => runTestCli(db, http, argv, { now });

  const library = async (...argv: string[]) =>
    libraryJson.parse(JSON.parse((await run("library", "--json", ...argv)).stdout));

  test("saves and unsaves a paper, once each", async () => {
    expect((await run("save", "https://arxiv.org/abs/2301.00001v2")).stdout).toBe(
      "Saved 2301.00001.",
    );

    const saved = await dumpCatalog(db);

    expect((await run("save", "2301.00001")).stdout).toBe("2301.00001 is already saved.");
    expect(await dumpCatalog(db)).toEqual(saved);
    expect(await library()).toEqual([
      {
        paper: { id: "2301.00001" },
        library: { savedAt: now, note: null, tags: [] },
      },
    ]);
    expect((await run("unsave", "2301.00001")).stdout).toBe("Unsaved 2301.00001.");
    expect((await run("unsave", "2301.00001")).stdout).toBe("2301.00001 is not saved.");
    expect(await library()).toEqual([]);
  });

  test("sets and clears a note, and keeps the note when the paper is unsaved", async () => {
    await run("save", "2301.00002");
    expect((await run("note", "2301.00002", "Read", "section", "3")).stdout).toBe(
      "Set the note of 2301.00002.",
    );
    await run("unsave", "2301.00002");

    expect(await library()).toEqual([
      { paper: { id: "2301.00002" }, library: { savedAt: null, note: "Read section 3", tags: [] } },
    ]);
    expect((await run("show", "2301.00002")).stdout).toContain("Note: Read section 3");
    expect((await run("note", "2301.00002", "--clear")).stdout).toBe(
      "Cleared the note of 2301.00002.",
    );
    expect(await library()).toEqual([]);
    expect((await run("note", "2301.00002")).code).toBe(2);
  });

  test("adds and removes tags, and filters the library by tag", async () => {
    expect((await run("tag", "2301.00003", "Vision", "diffusion", "vision")).stdout).toBe(
      "Tagged 2301.00003 with vision, diffusion.",
    );
    await run("tag", "2301.00004", "vision");

    const tagged = await dumpCatalog(db);

    await run("tag", "2301.00003", "vision");
    expect(await dumpCatalog(db)).toEqual(tagged);
    expect((await library("--tag", "VISION")).map(({ paper }) => paper.id)).toEqual([
      "2301.00003",
      "2301.00004",
    ]);
    expect((await library("--tag", "diffusion"))[0]?.library.tags).toEqual(["diffusion", "vision"]);
    expect((await run("show", "2301.00003")).stdout).toContain("Tags: diffusion, vision");

    expect((await run("tag", "2301.00003", "diffusion", "--remove")).stdout).toBe(
      "Removed diffusion from 2301.00003.",
    );
    expect(await library("--tag", "diffusion")).toEqual([]);
    expect((await run("tag", "2301.00003", "bad tag!")).code).toBe(2);
  });

  test("prints the library as text", async () => {
    expect((await run("library")).stdout).toBe("The library is empty.");

    await run("save", "2301.00001");
    await run("tag", "2301.00001", "vision");
    await run("note", "2301.00001", "Good baseline");

    expect((await run("library")).stdout).toBe(
      [
        "2301.00001  2023-01-01",
        "            Diffusion one",
        "            Ada Lovelace",
        "            Saved: 2026-10-24",
        "            Tags: vision",
        "            Note: Good baseline",
      ].join("\n"),
    );
  });

  test("rejects a paper that is not in the catalog", async () => {
    const missing = await run("save", "2610.99999");

    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Run "pwc add 2610.99999" to add it.');
  });

  test("search filters by saved papers and by tag", async () => {
    await run("save", "2301.00001");
    await run("tag", "2301.00002", "vision");

    const search = async (...argv: string[]) =>
      hitIds
        .parse(
          JSON.parse(
            (await run("search", "diffusion", "--mode", "keyword", "--json", ...argv)).stdout,
          ),
        )
        .map(({ paper }) => paper.id);

    expect(await search()).toHaveLength(4);
    expect(await search("--saved")).toEqual(["2301.00001"]);
    expect(await search("--tag", "vision")).toEqual(["2301.00002"]);
    expect(await search("--saved", "--tag", "vision")).toEqual([]);
  });

  test("prune keeps saved, noted, and tagged papers", async () => {
    await run("save", "2301.00001");
    await run("note", "2301.00002", "Keep");
    await run("tag", "2301.00003", "keep");

    expect((await run("prune")).stdout).toBe("Removed 1 papers published before 2025-10-24.");
    expect((await run("show", "2301.00004")).code).toBe(1);

    for (const id of ["2301.00001", "2301.00002", "2301.00003"]) {
      expect((await run("show", id)).code).toBe(0);
    }
  });
});
