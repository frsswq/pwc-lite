# pwc-lite

Lightweight headless paper discovery for personal use.
It takes ideas from [huggingface/paperswithcode](https://github.com/huggingface/paperswithcode), but it has no web UI and no server dependencies.

## Status

The repository contains the toolchain only.
The design is in [issue #1](https://github.com/frsswq/pwc-lite/issues/1).
The planned work is in the [milestones](https://github.com/frsswq/pwc-lite/milestones).

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
