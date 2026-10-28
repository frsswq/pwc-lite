# pwc-lite

Lightweight headless paper discovery for personal use.
It takes ideas from [huggingface/paperswithcode](https://github.com/huggingface/paperswithcode), but it has no web UI and no server dependencies.

## Status

Phase 1 is complete: the catalog, the Daily Papers and arXiv ingest, keyword search, and the CLI.
The design is in [issue #1](https://github.com/frsswq/pwc-lite/issues/1).
The planned work is in the [milestones](https://github.com/frsswq/pwc-lite/milestones).

## Setup

```sh
bun install                         # The onnxruntime-node postinstall is not necessary for CPU use
bun run check
bun test
```

## Usage

```sh
bun run pwc ingest daily            # Fetch Daily Papers since the last run, then arXiv metadata
bun run pwc ingest hub              # Fetch Hub models, datasets, and Spaces that cite papers
bun run pwc ingest github           # Refresh GitHub stars for linked repositories
bun run pwc ingest pwc              # Fetch tasks and methods from Papers with Code
bun run pwc ingest all              # Run the daily, hub, github, and pwc sources in sequence
bun run pwc embed                   # Embed new papers for semantic search
bun run pwc search "video diffusion" --since 2026-01-01
bun run pwc search "making LLM inference faster" --mode semantic --explain
bun run pwc show 2610.31329
bun run pwc recent --days 3
bun run pwc add https://arxiv.org/abs/1706.03762
bun run pwc save 2610.31329
bun run pwc note 2610.31329 "Compare with the baseline in section 4"
bun run pwc tag 2610.31329 vision multimodal
bun run pwc library --tag vision
bun run pwc search "pixel perception" --saved
bun run pwc search "detection" --task "Object Detection" --method dropout
bun run pwc watch add "speculative decoding"
bun run pwc watch                   # New papers for each watch since the last run
bun run pwc prune --dry-run         # Never removes saved, noted, or tagged papers
bun run pwc serve --port 8787      # JSON API on 127.0.0.1
```

The API has these routes:

- `GET /search?q=<query>&mode=hybrid&limit=20&since=YYYY-MM-DD`
- `GET /papers/<arxiv-id-or-url>`
- `GET /recent?days=7&limit=30`

A bad parameter gives a 400 response with an `error` message.

Read commands accept `--json`.
Search uses `--mode hybrid` by default.
Hybrid mode merges the keyword and semantic results with reciprocal rank fusion, then adds small boosts for recency, links, and popularity.
The weights are in `src/query/ranking.ts`.
Run `bun run pwc help <command>` for the options of a command.

## Cloudflare

The same query core and JSON API run on a Cloudflare Worker with D1, Vectorize, and Workers AI.
The Worker entry is `src/worker.ts`, and the bindings are in `wrangler.jsonc`.

1. Create the D1 database and the Vectorize index, and put the database ID in `wrangler.jsonc`:

   ```sh
   wrangler d1 create pwc-lite
   wrangler vectorize create pwc-lite-bge-small --dimensions 384 --metric cosine
   ```

2. Apply the migrations. Wrangler reads the same files in `src/db/migrations/`:

   ```sh
   wrangler d1 migrations apply pwc-lite --remote
   ```

3. Copy the local catalog. Run each SQL file on a separate day if the catalog is large, because the free plan allows 100,000 rows written each day:

   ```sh
   bun run pwc export cloudflare --out data/cloudflare
   wrangler d1 execute pwc-lite --remote --file data/cloudflare/catalog-001.sql
   wrangler vectorize insert pwc-lite-bge-small --file data/cloudflare/vectors.ndjson
   ```

4. Deploy with `wrangler deploy`.

The cloud catalog keeps vectors only for papers of the last 270 days, because Vectorize on the free plan stores about 13,000 vectors of 384 dimensions.
Issue [#17](https://github.com/frsswq/pwc-lite/issues/17) has the free plan limits.

`bun run test:d1` runs the unit tests through the D1 implementation with a fake D1 binding on SQLite.

## Configuration

| Variable              | Use                                                                                      | Default                      |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------- |
| `PWC_DB_PATH`         | Path of the SQLite catalog                                                               | `data/pwc.db` in the project |
| `PWC_HF_TOKEN`        | Hugging Face token for higher rate limits                                                | Not set                      |
| `PWC_EMBED_MODEL`     | Embedding model: `bge-small-en-v1.5`, `all-MiniLM-L6-v2`, or `snowflake-arctic-embed-xs` | `bge-small-en-v1.5`          |
| `PWC_MODEL_CACHE_DIR` | Directory for downloaded model files                                                     | `data/models` in the project |
| `PWC_GITHUB_TOKEN`    | GitHub token for 5000 requests in each hour instead of 60                                | Not set                      |

## Tooling

- Runtime: Bun
- Language: TypeScript
- Lint: Oxlint with the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) plugin in `tools/oxlint/anti-slop/`
- Format: Oxfmt
