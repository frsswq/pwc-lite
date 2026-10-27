# pwc-lite

Lightweight headless paper discovery for personal use.
It takes ideas from [huggingface/paperswithcode](https://github.com/huggingface/paperswithcode), but it has no web UI and no server dependencies.

## Status

Phase 1 is complete: the catalog, the Daily Papers and arXiv ingest, keyword search, and the CLI.
The design is in [issue #1](https://github.com/frsswq/pwc-lite/issues/1).
The planned work is in the [milestones](https://github.com/frsswq/pwc-lite/milestones).

## Setup

```sh
bun install
bun run check
bun test
```

## Usage

```sh
bun run pwc ingest daily            # Fetch Daily Papers since the last run, then arXiv metadata
bun run pwc search "video diffusion" --since 2026-01-01
bun run pwc show 2610.31329
bun run pwc recent --days 3
bun run pwc add https://arxiv.org/abs/1706.03762
bun run pwc prune --dry-run
```

Read commands accept `--json`.
Run `bun run pwc help <command>` for the options of a command.

## Configuration

| Variable       | Use                                       | Default                      |
| -------------- | ----------------------------------------- | ---------------------------- |
| `PWC_DB_PATH`  | Path of the SQLite catalog                | `data/pwc.db` in the project |
| `PWC_HF_TOKEN` | Hugging Face token for higher rate limits | Not set                      |

## Tooling

- Runtime: Bun
- Language: TypeScript
- Lint: Oxlint with the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) plugin in `tools/oxlint/anti-slop/`
- Format: Oxfmt
