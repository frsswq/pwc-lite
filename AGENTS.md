# pwc-lite agent instructions

## Project

pwc-lite is a lightweight headless paper discovery tool for personal use.
It uses Bun, TypeScript, and SQLite.
GitHub issues track the design and the work.
Read the design in issue #1 (https://github.com/frsswq/pwc-lite/issues/1).
Each task is an issue in a phase milestone.
Read the task issue and its acceptance criteria before you start the task.
Record changed design decisions in issue #1.

## Commands

- Run the CLI: `bun run pwc -- <command>`
- Format: `bun run fmt`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- All static checks: `bun run check`
- Unit tests: `bun test <path>`

## Rules

- Keep the query core free of `bun:sqlite` imports.
  Use the database interface in `src/db/` so that a Cloudflare D1 port stays possible.
- Keep vectors behind the `VectorIndex` interface.
- Parse all external API data with a schema at the adapter boundary.
  Use domain types after the boundary.
- Do not weaken or disable anti-slop rules to make lint pass.
- Do not edit `tools/oxlint/anti-slop/` except through the update procedure of the upstream `install-anti-slop` skill.
  Record each change in `tools/oxlint/anti-slop/UPSTREAM.md`.
- Ingest jobs must be idempotent.
  A second run with the same input must not change the database.
- Network calls must respect the rate limits of each source.
  Tests must not call the network.
