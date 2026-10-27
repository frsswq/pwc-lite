# Upstream provenance

- Source repository: https://github.com/dmmulroy/anti-slop
- Source commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- Source path: `skills/install-anti-slop/assets/anti-slop/`
- Plugin version at that commit: `0.1.2`
- Install method: `node skills/install-anti-slop/scripts/install.mjs tools/oxlint/anti-slop`
- Installed on: 2026-10-27

## Installed plugin paths

- Generic plugin: `tools/oxlint/anti-slop/index.ts` (registered as `anti-slop`).
- Effect plugin: `tools/oxlint/anti-slop/effect/index.ts` (copied, not registered, because the project does not depend on `effect`).

## Verification

- `diff -r` of the source bundle and this directory showed no differences.
- Upstream `node scripts/sync-skill-assets.mjs --check` reported that the skill assets match `src/` at the source commit.

## Intentional deviations

- None.

## Dependencies

- `oxlint` and `@oxlint/plugins` are pinned to the same exact version (`1.90.0`).
  Upgrade both packages together.
