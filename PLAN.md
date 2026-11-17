# Plan: one `send` command for named messages, that remembers (branch `send`)

Deleted before the merge.

## Goal

Any number of messages per game, each sent with one command that reaches every player on their channels and only sends what is missing:

```sh
christmas-tombola send games/2027 announce           # dry run, then again with --force
christmas-tombola draw games/2027                    # ends with "next: christmas-tombola send games/2027 targets"
christmas-tombola send games/2027 targets --force
christmas-tombola send games/2027 reminder --force   # any other message, any time
# players changed: draw, then send targets --force: only those concerned get it
```

## Behavior

- **`send <game directory> <message> [<pattern>...]`** replaces `email` and `sms` (breaking, no compatibility code; `sms-test` stays).
  - A message is a name; its templates are `<message>.email.md` (Markdown + TOML front matter, as now) and `<message>.sms.txt` in the game directory. At least one must exist, else the error lists the messages found (`no target.email.md or target.sms.txt; messages here: announce, targets`). Any other `<message>.*` file is an error naming the expected ones. Every run starts with the channels found: `targets: email and SMS`, `targets: email only (no targets.sms.txt)`.
  - Each selected player gets the message on every channel they have and that has a template (both when they have both, as today). In person only when no channel reaches them (`inPerson: true` and no usable contact). A player reached by no channel is an error naming the fix (`Bob: only a phone, and no targets.sms.txt (add it, or skip with '!Bob')`); nothing sent with `--force`.
  - A template using `target` before the draw fails to render, as now: the error says to run `draw` first.
  - Unchanged: dry run by default, `--force`, `--show`, all-or-nothing rendering, SMS count and 30-SMS warning, SMTP check before sending, failures listed with a retry command naming them (`namePattern`).
- **Depends on the target**: a message depends on it, for a player, if its rendering differs with and without the real target (never `hideTarget`), or fails without it; mail compared on the whole rendered object (fields, text, html). Covers `{{target.x}}` (strict mode throws), `{{#if target}}` and bare `{{target}}`. In-person players: computed with any of the message's templates; their line shows the target only when dependent.
- **`sent.json`** in the game directory, by message, player id, then channel (`email`, `sms`, `inPerson`): `{ "targets": { "alice": { "email": { "contact": "alice@example.com", "target": "bob", "date": "2027-12-01" } } } }` (target **id**, only when dependent).
  - Without patterns, only _pending_ deliveries: no record for this message and channel, changed contact (a reformatted number counts, documented), or, when dependent, a target differing from the record's (a record without target counts as changed: a reminder with `{{#if target}}` sent before the draw is pending after it). A record's target is ignored when not dependent. Template text, other players' fields and the `players` list are not tracked: resend with patterns.
  - **Include** patterns select players and resend even if already sent (`'*'` resends to everyone, e.g. after fixing a template); `!` patterns only filter the pending set.
  - Dry run: each pending delivery with its reason (`new`, `new target`, `new email`, `new phone`, `resend`), then `N already sent, last on <date>` (makes a stale copied `sent.json` obvious), or `nothing to send (to resend: add '*' or names)`.
  - Recorded after each successful sending, never before, written to a temporary file in the game directory then renamed. If recording fails, stop at once, list who was sent (including the delivery just sent, not recorded), exit 1. An unknown outcome (timeout) is not recorded: a duplicate on retry, documented.
  - In-person players recorded once their line is printed under `--force` (last, also when another sending failed); include patterns list them again.
  - A player in the lottery without a valid target is an error, as now (also for messages not using it).
- `draw` ends with `next: christmas-tombola send <dir> targets` (dry run) when some target is new or changed.
- Examples renamed: `announce.email.md`, `announce.sms.txt`, `targets.email.md`, `targets.sms.txt`; tests follow.
- README: the goal block as First game; Templates becomes the Messages section (naming, channels, Handlebars, pending rule, a name resends); Next year gives the exact copy command (`mkdir games/2027 && cp games/2026/{players.json5,*.email.md,*.sms.txt} games/2027/`); `sms --force` → `send --force` in Configuration; Commands block and help; two concurrent `send --force` would send twice.

## Commits

1. `send <dir> <message>` replaces `email`/`sms`, without records: pure, tested `messageTemplates(fileNames, message)` (templates or error, unknown files); every channel, no-channel error; examples renamed; `draw`'s next line; README, help.
2. `sent.json`: pure, tested `pendingDeliveries(…)` taking each player's precomputed dependence (pending set, reasons, pattern rule, record rules, errors: no channel, no valid target) and `recordDelivery(sent, delivery)`; atomic write in `cli.mjs`; README.

## Decisions

- Both email and SMS for a player who has both: same as today; remove the phone to get email only.
- A game notified with the old commands (no `sent.json`): the first `send --force` resends; the dry run shows it. Not documented: old games are over.
- The targets message is named `targets`, not `draw`: `send … draw` would read like the `draw` command.
- No guard against a copied `sent.json` (it missed copies keeping `lottery.json`): the README's exact copy command, the date in the dry run, and the future `new --from`.

## Out of scope

`new` and `status` commands (next steps), per-channel resend, SMS gateway check, phone format validation.
