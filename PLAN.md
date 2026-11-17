# Plan: review fixes (branch `review-fixes`, from `v3`)

Deleted before merge. One commit per step, each passing `npm test` + lint.

## Verified bugs (scratch script, current code)

- 4 players, no groups: `draw` throws "could not find a suitable candidate" in 75% of runs although valid draws exist (greedy, no backtracking).
- Extending `{A: "B"}` with 6 players: `B → A` in 5.5% of runs (reciprocity ban not restored from existing lottery).
- Extending a complete lottery with a new player always fails (only open target is the new player).
- Nested groups `[[[X, Y], Z]]`: `X._blacklist.size` is 2 instead of 3; and Z may draw X while X may not draw Z.
- Template with `Tom & Jerry`: subject and text body get `Tom &amp; Jerry` (Handlebars HTML-escapes by default).

## Decisions

- SMS TLS: verification on; optional `sms.fingerprint` (SHA-256) pins a self-signed cert.
- Targets hidden by default in `draw`, `dump` and dry-runs; `--show` reveals them.
- New player in a complete lottery: inserted into a pair (A→B becomes A→N, N→B); A must be notified again.
- ESLint 10 flat config + `neostandard({ noStyle: true })` + prettier.
- Nested groups become two-way: a group excludes every player nested anywhere in it (deliberate change).

## Steps

1. **Tooling**: ESLint 10 + neostandard (drop `.eslintrc.js`, eslint-config-standard/prettier, eslint-plugin-import/n/promise), prettier 3 reformat, husky 9 (`prepare: husky`), lint-staged (`--no-warn-ignored`), `.claude/` ignored by ESLint/prettier; `npm test` → `node --test *.test.mjs`.
2. **Runtime deps**: latest marked, nodemailer, front-matter, handlebars, json5, micromatch, app-conf 6 (`load({ appName, appDir })`); drop `@iarna/toml`; `engines.node` `>=22`.
3. **Native replacements + cleanup**: `util.parseArgs` (manual top-level dispatch), native code instead of lodash (`localeCompare` sort), own `main()` keeping exec-promise output (strings as-is, others as JSON, `process.exitCode`); remove `extractProperty`, `map`/`DONE`/`mapInPlace`, `.npmignore`; `package.json` `name`; `--help` lists commands.
4. **Players**: one `Set` of excluded ids per player (self + all players of every enclosing group, both directions), ids as strings. Tests: nested groups both ways, `participate: false` in a group, duplicate ids, ids `size`/`__proto__`/numeric.
5. **Draw**: injectable `random`; uniform rejection sampling (shuffle open targets, keep if valid, bounded tries), then DFS fallback (fewest candidates first, step cap) → error when none found. Reciprocity checked against the assignment, players left untouched. Tests (seeded RNG): invariants over many seeds, 3/4 players, 2 players fails, oversized group fails fast, exhaustive check vs brute force up to 6 players.
6. **Extension**: kept pairs validated against current rules (fail listing invalid ones); pairs with a removed/non-participating player dropped with a warning; open slots drawn; if impossible, new players inserted into existing pairs, then the rest drawn; returns who must be notified again.
7. **CLI `draw`**: takes `<game directory>` like other commands; prints a summary (+ who to notify again); `--show` lists pairs; `dump` hides targets unless `--show`.
8. **Templates**: subject/text compiled with `noEscape`; HTML part rendered by `marked` from an escaped compile; `to` built from the player, not the template.
9. **Email/SMS flow**: shared loader (players, lottery, template, sort, lowercased patterns); sequential sending; failures listed and `process.exitCode = 1`; with a lottery, refuse sending to a player without target; dry-run prints the message with a `[target]` placeholder unless `--show`; log `error.message` only.
10. **SMS**: `node:https` with verification + optional fingerprint pinning; non-2xx is an error; password never logged.
11. **Privacy**: ignore `/config.*` (except `/config.example.json5`) and `/games.tar.xz`.
12. **Docs**: README (install, config, `players.json5` format, templates, workflow, `--force`/`--show`), `config.example.json5` with fake data.
