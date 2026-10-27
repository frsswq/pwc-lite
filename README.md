# pwc-lite

Lightweight headless paper discovery for personal use.
It takes ideas from [huggingface/paperswithcode](https://github.com/huggingface/paperswithcode), but it has no web UI and no server dependencies.

## Status

The repository contains the toolchain only.
Read `PLAN.md` for the planned work.

## Setup

```sh
bun install
bun run check
bun run pwc
```

## Tooling

- Runtime: Bun
- Language: TypeScript
- Lint: Oxlint with the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) plugin in `tools/oxlint/anti-slop/`
- Format: Oxfmt
