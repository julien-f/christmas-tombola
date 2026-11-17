# Plan: user-facing fixes (branch `user-review`)

Deleted before the merge. Reviewed by two agents (templating/secrecy, CLI/SMS); their changes are folded in.

## Wrong messages

1. Strict templates: compile with Handlebars `strict: true` (email fields, text, html; SMS), parsed at load so a syntax error is reported once, with the file. A missing field throws instead of rendering empty; `{{#if x}}` still works. `target` before the draw then throws too; README: optional fields and `target` in announcements go in `{{#if}}`.
2. Every run renders each message with the real target first and nothing is sent if any fails (exit 1). With hidden targets the error says only `<player>: template error, use --show for details` (the detail would reveal the target's fields).
3. Hidden target for printing: a plain object with every top-level field any player has, each `"[target]"` (`toString` too), replacing the Proxy that hid typos.
4. `draw` refuses players without `email` and `phone`, listing them, unless `inPerson: true` (told in person): per player, so the decision is recorded and a forgotten contact elsewhere still fails. The `parsePlayers` warning (repeated on every command) goes.

## Recovery

5. After send failures, print the command resending to them only: names single-quoted, characters outside letters, digits, space, `.'_-` replaced by `?`.
6. SMS dry run: estimated segments per message (GSM-7 160/153, extension chars count 2; otherwise UCS-2 70/67 in UTF-16 units), naming the first non-GSM character (e.g. `ç`).
7. `sms --force` over 30 segments in total: warn up front that Android will ask on the phone to allow more.

## Errors and help

8. Errors with `syscall` (file not found…) print the message only; `players.json5` syntax errors are prefixed with its path; SMS gateway network errors show `error.cause`.
9. `-h`/`--help` after the command (before `--`) prints the help, before loading the config.
10. Lowercase `missing argument`; `neither … nor` goes with item 4.

## Getting started

11. `examples/`: `players.json5` (moved from README), `email.md`, `sms.txt`, `announce.md`; README links them. A test parses the example players, draws, and renders the templates (announcement without a draw).

## Out of scope (to propose)

- Front-matter dates become `{}` in `mapLeaves` (pre-existing).

## Tests

- `utils.test.mjs`: strict compilation, hidden target, contact check, segment count, resend quoting, examples.
- CLI checked by running it on a scratch game.
