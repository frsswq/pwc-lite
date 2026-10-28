import { type Context, Hono } from "hono";
import { z } from "zod";

import type { Database } from "../db/database";
import { parseArxivId } from "../domain/arxiv-id";
import { isIsoDate, utcDate } from "../domain/dates";
import type { Embedder } from "../embed/embedder";
import { noFilter } from "../query/filter";
import { getPaper, listRecentPapers } from "../query/papers";
import { rankedSearch, searchModes } from "../query/ranking";
import type { VectorIndex } from "../vectors/vector-index";

export type AppDependencies = {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly index: VectorIndex;
  readonly now: () => Date;
};

const limit = (fallback: number) => z.coerce.number().int().min(1).max(100).default(fallback);

const date = z.string().refine(isIsoDate, "must be a YYYY-MM-DD date");

const searchQuery = z
  .object({
    q: z.string().trim().min(1, "must not be empty"),
    mode: z.enum(searchModes).default("hybrid"),
    limit: limit(20),
    since: date.optional(),
  })
  .strict();

const recentQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(3650).default(7),
    limit: limit(30),
  })
  .strict();

/** Formats each issue of a failed parse as `name: message`. */
const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const keys =
        issue.code === "unrecognized_keys" ? issue.keys.join(", ") : issue.path.join(".");

      return keys === "" ? issue.message : `${keys}: ${issue.message}`;
    })
    .join("; ");

const badRequest = (context: Context, message: string) => context.json({ error: message }, 400);

/**
 * The JSON API. It has the same read operations as the CLI.
 *
 * The app depends only on the database, embedder, and vector index interfaces, so that it can run on Workers.
 */
export const createApp = (dependencies: AppDependencies): Hono => {
  const { db } = dependencies;
  const app = new Hono();

  app.get("/search", async (context) => {
    const query = searchQuery.safeParse(context.req.query());

    if (!query.success) {
      return badRequest(context, describeIssues(query.error));
    }

    const hits = await rankedSearch(
      db,
      { embedder: dependencies.embedder, index: dependencies.index },
      {
        query: query.data.q,
        mode: query.data.mode,
        limit: query.data.limit,
        filter: { ...noFilter, since: query.data.since ?? null },
        now: dependencies.now(),
      },
    );

    return context.json({ hits });
  });

  app.get("/papers/:id{.+}", async (context) => {
    const parsed = parseArxivId(context.req.param("id"));

    if (parsed === null) {
      return badRequest(context, "id: must be an arXiv ID");
    }

    const detail = await getPaper(db, parsed.id);

    return detail === null
      ? context.json({ error: `${parsed.id} is not in the catalog` }, 404)
      : context.json(detail);
  });

  app.get("/recent", async (context) => {
    const query = recentQuery.safeParse(context.req.query());

    if (!query.success) {
      return badRequest(context, describeIssues(query.error));
    }

    const papers = await listRecentPapers(db, {
      days: query.data.days,
      limit: query.data.limit,
      today: utcDate(dependencies.now()),
    });

    return context.json({ papers });
  });

  app.notFound((context) => context.json({ error: "Not found" }, 404));

  app.onError((error, context) => context.json({ error: error.message }, 500));

  return app;
};
