# pwc-lite plan

## Goal

pwc-lite finds recent machine learning papers and their code, models, datasets, and demos.
It is for personal use from a terminal.
It has no web UI.
It runs locally on one SQLite file.
A later port to Cloudflare Workers and D1 (free tier) must stay possible.

## Scope

### In scope

- A paper catalog keyed by arXiv ID.
- Links from papers to GitHub repositories and Hugging Face models, datasets, and Spaces.
- Keyword search, semantic search, and hybrid ranking.
- A CLI first, then a local HTTP API.
- Personal features: saved papers, notes, tags, and topic watches.

### Out of scope

- Web UI, user accounts, and authentication.
- LaTeX compilation, paper readers, and thumbnails.
- LLM chat and agent curation.
- Full leaderboards.
  A small leaderboard feature can come after phase 3.

## Corpus

The corpus is a rolling window, not a full arXiv mirror.
A paper enters the catalog when one of these conditions is true:

- The paper is in Hugging Face Daily Papers.
- The paper has a linked GitHub repository or Hugging Face artifact.
- The user adds the paper manually.

arXiv supplies metadata for papers in the catalog.
The retention window is configurable.
The default is 365 days.
The prune job never removes a paper that has links, a saved state, notes, or tags.

## Architecture

```text
sources -> adapters -> ingest jobs -> database -> query core -> CLI / HTTP API
```

### Rules

- Each source has one adapter.
  The adapter fetches data, parses it with a schema, and maps it to domain types.
- Ingest jobs are idempotent and resumable.
  Each job stores a cursor in the database.
- The query core uses only the `Database` interface.
  It does not import `bun:sqlite`.
- The `Database` interface is async and uses statement batches instead of interactive transactions.
  D1 supports batches but not interactive transactions.
- SQL uses only features that D1 supports.
  FTS5 is allowed.
  SQLite extensions are not allowed in core tables.
- Vectors are behind a `VectorIndex` interface.
  The local implementation stores vectors in a separate table and uses brute-force cosine similarity.
  The Cloudflare implementation will use Vectorize.
- Embeddings are behind an `Embedder` interface.
  The local implementation uses transformers.js with a small model such as `bge-small-en-v1.5`.
  The Cloudflare implementation will use Workers AI.

### Libraries

- Runtime: Bun.
- Database: `bun:sqlite` locally.
- Schema validation: Zod 4.
- XML parsing for arXiv Atom feeds: `fast-xml-parser`.
- CLI argument parsing: `node:util` `parseArgs`.
- HTTP API (phase 2): Hono, because it runs on Bun and on Workers.

## Data sources

| Source                                     | Data                                            | Phase       |
| ------------------------------------------ | ----------------------------------------------- | ----------- |
| Hugging Face Daily Papers API              | Trending papers, upvotes, and some links        | 1           |
| arXiv API                                  | Title, abstract, authors, dates, and categories | 1           |
| Hugging Face Hub API (`filter=arxiv:<id>`) | Models, datasets, and Spaces for a paper        | 2           |
| GitHub REST API                            | Repository stars and last push date             | 2           |
| paperswithcode.co `/api/v1`                | Curated code links, tasks, and methods          | 3, optional |

### Rate limits

- arXiv: one request every 3 seconds, as the arXiv API terms require.
- GitHub: use the token in `PWC_GITHUB_TOKEN` when it is set.
- Hugging Face: use the token in `PWC_HF_TOKEN` when it is set.

## Data model

All dates are ISO 8601 text in UTC.
JSON columns are text.

- `papers`: `id` (arXiv ID without version), `version`, `title`, `abstract`, `published_at`, `updated_at`, `primary_category`, `categories` (JSON), `doi`, `added_via`, `ingested_at`.
- `authors`: `id`, `name`, `name_key` (normalized name).
- `paper_authors`: `paper_id`, `author_id`, `position`.
- `links`: `paper_id`, `kind` (`github`, `hf_model`, `hf_dataset`, `hf_space`, `project_page`), `external_id`, `url`, `popularity` (stars, likes, or downloads), `last_activity_at`, `fetched_at`.
  The primary key is `paper_id`, `kind`, and `external_id`.
- `signals`: `paper_id`, `source`, `observed_on`, `score`.
  The first source is Hugging Face Daily Papers upvotes.
- `papers_fts`: an FTS5 table with external content for title, abstract, and author names.
- `ingest_cursors`: `source`, `cursor`, `updated_at`.
- `library` (phase 3): `paper_id`, `saved_at`, `note`.
- `tags` and `paper_tags` (phase 3).
- `watches` (phase 3): `id`, `query`, `last_seen_at`.

Migrations are plain numbered SQL files.
A `schema_migrations` table records the applied files.

## Source layout

```text
src/
  cli.ts            CLI entry point and command routing
  config.ts         Environment and paths
  domain/           Domain types such as Paper and Link
  db/               Database interface, bun:sqlite implementation, migrations
  sources/          One adapter for each source, with its response schemas
  ingest/           Ingest jobs and cursors
  query/            Search, ranking, and paper lookup
  http/             Hono API (phase 2)
test/
  fixtures/         Recorded source responses
```

## Phases

### Phase 1: catalog and keyword search

1. Add the `Database` interface, the `bun:sqlite` implementation, and the migration runner.
2. Add the first migration for papers, authors, signals, FTS5, and cursors.
3. Add the Hugging Face Daily Papers adapter and its ingest job.
4. Add the arXiv adapter.
   It fetches metadata for a list of IDs in batches.
5. Add the query core: FTS5 search with BM25, lookup by ID, and a list of recent papers.
6. Add these CLI commands:
   - `pwc ingest daily [--since <date>]`
   - `pwc add <arxiv-id-or-url>`
   - `pwc search <query> [--limit <n>] [--since <date>]`
   - `pwc show <arxiv-id>`
   - `pwc recent [--days <n>]`
   - `pwc prune`
7. Add JSON output (`--json`) for each read command.

Completion evidence:

- Unit tests for each adapter use recorded fixtures and no network.
- Unit tests for the query core use an in-memory database.
- A test shows that a second ingest of the same fixture does not change the database.
- One manual ingest of the real Daily Papers feed, followed by a search, gives relevant results.

### Phase 2: links and hybrid ranking

1. Add the Hugging Face Hub adapter for models, datasets, and Spaces.
2. Add the GitHub adapter for repository popularity.
3. Add the `Embedder` and `VectorIndex` interfaces and their local implementations.
4. Add hybrid ranking.
   It merges BM25 and vector results with reciprocal rank fusion.
   Then it adds small boosts for recency, links, and popularity.
5. Add the Hono HTTP API with the same operations as the CLI.

### Phase 3: personal features and Cloudflare port

1. Add saved papers, notes, and tags.
2. Add topic watches.
   `pwc watch` shows new papers that match each watch since the last run.
3. Add optional task and method tags from paperswithcode.co or simple rules.
4. Add the D1 `Database` implementation, the Vectorize `VectorIndex`, and the Workers AI `Embedder`.
5. Add a scheduled Worker for ingest.

## Open questions

- Confirm the current D1 and Vectorize free tier limits before phase 3.
- Select the default embedding model after a small quality check on real queries.
