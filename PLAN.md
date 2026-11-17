# Plan: process fixes (branch `process-fixes`)

From an end-to-end review of a family game. Deleted before the merge.

## Commits

1. **Warn about patterns matching no player** (`email`, `sms`, `dump`): `carol frnak` silently selected only Carol. A `selectPlayers(players, patterns)` in `cli.mjs` replaces `createPlayerMatcher`, returns the selected players and warns `no player matches: frnak` for each include pattern without match. Kept a warning (not an error): `--force` with a typo still sends to the matched ones — or should it refuse? See open question 2.
2. **Plain message for an impossible draw**: `draw` printed a stack trace (`Error: no valid draw exists at draw (utils.mjs:208)`). `cli.mjs` catches it and throws `no valid draw exists: too few players outside some groups (nobody draws their group or their giver)`. No change to `utils.mjs`.
3. **Warn about ids that left `lottery.json`**: renaming Carol to Carole only showed `dropped 2 pair(s)`. `draw` now warns `not in players.json5 anymore: Carol (renamed? set \`id: "Carol"\` to keep their pairs)`.
4. **Name the SMTP server in connection errors**: `connect ECONNREFUSED 127.0.0.1:9` → `SMTP server: connect ECONNREFUSED 127.0.0.1:9` (wrap `createMailer` in the `email` sender).
5. **Avoid last year's pairs**: copying `games/2026` to `games/2027` keeps `lottery.json`, so `draw` keeps every pair. New `draw --avoid <game directory>` (repeatable): pairs of that game's `lottery.json` are added to the givers' exclusions; pure function in `utils.mjs` (`avoidPairs(players, lottery)`) with tests. See open question 1.
6. **Docs**:
   - README "Next year": new directory with `players.json5` only, then `draw games/2027 --avoid games/2026`; back up `games/` (git-ignored).
   - `examples/announce.txt` (SMS announcement, phone-only players never heard of the game), tested like the others; date/budget placeholder lines in both announcements.
   - Watch the `from` mailbox for bounces: a server often accepts a wrong address and bounces later.
   - Templates: any field works, e.g. `wishes` in `players.json5` → `{{target.wishes}}`.

## Decisions (after review)

- `--avoid` is repeated on every draw, documented (no state file); skips players who left; on failure suggests drawing without it; docs: small games become predictable.
- Patterns: include and `!` patterns matching no player; warn in dry runs and `dump`, refuse with `--force` (`…, nothing sent`).
- Impossible draw: `too few players (…)`, not blaming groups only; the search-limit error gets a plain "retry" message too.
- Gone ids: `left the game or renamed: Carol (…)` (also `participate: false`).
- SMTP error names `email.transport` in the configuration.
- Docs: no Templates bullet; `--avoid` in `--help`; `announce.txt` in First game; bounces under Configuration.

## Out of scope

Sent log / skipping already-sent players, phone format validation, merging email and SMS runs, anonymous questions.
