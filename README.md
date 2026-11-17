# christmas-tombola

Draws who gives a gift to whom, then tells each player by email or SMS.

## Install

Node 24+:

```sh
npm ci
npm link # optional: puts `christmas-tombola` on the PATH, otherwise use ./cli.mjs
```

## Configuration

Only needed to send: copy [`example-config.json5`](example-config.json5) to `~/.config/christmas-tombola/config.json5` and fill in the SMTP server and the SMS gateway.

An SMTP server often accepts a wrong address and bounces the email later: watch the `from` mailbox after sending.

SMS messages are sent through an Android phone running [SMS Gate](https://sms-gate.app) in Local Server mode, on the same network:

- Disable battery optimization for the app (Samsung: _Unrestricted_), else the server stops when the screen is off.
- Past 30 SMS in 30 minutes, Android asks for approval on the phone; `send --force` warns beforehand.
- A character outside the GSM alphabet (e.g. `ç`, `ê`, emoji) cuts each SMS from 160 to 70 characters: the dry run shows the estimated count.

## First game

1. `cp -r examples games/2026` (`games/` is git-ignored: back it up), then edit `games/2026/players.json5`.
2. Optionally, announce the game: `christmas-tombola send games/2026 announce` shows the messages (dry run); add `--force` to send them.
3. `christmas-tombola draw games/2026`.
4. `christmas-tombola send games/2026 targets`, then with `--force`; it ends with the in-person players to tell and their targets.
5. After editing the players, `draw` again, then `send games/2026 targets` (dry run, then `--force`): only the new players and those whose target changed get it.
6. Any other message, any time: e.g. `reminder.email.md` and `reminder.sms.txt`, then `send games/2026 reminder`.

## Next year

1. A new directory with the players and messages, without `lottery.json` (`draw` would keep last year's pairs) nor `sent.json` (nothing would be sent): `mkdir games/2027 && cp games/2026/{players.json5,*.email.md,*.sms.txt} games/2027/`.
2. `christmas-tombola draw games/2027 --avoid games/2026`: nobody gets last year's target. Pass `--avoid` on every `draw` of that game; in a small game, it leaves few draws (3 players: only the reverse of last year).

## Players

`players.json5`, written by hand, see [`examples/players.json5`](examples/players.json5):

- Players nested in an array form a _group_ (e.g. a couple); groups can be nested.
- Nobody draws themselves, a member of one of their groups, or the player who drew them.
- `email` and `phone` (international format: `+33612345678`) are where the messages go; `draw` refuses a player with neither, unless `inPerson: true` (the organizer tells them).
- `disambiguation` tells same names apart: the _displayed name_ becomes `Alice (junior)`.
- `id` defaults to the displayed name; set it to rename a player without breaking `lottery.json`.
- `participate: false` keeps a player in the file but out of the draw.

`draw` writes the draw to `lottery.json` (player id → target id).

## Commands

```sh
christmas-tombola draw <game directory> [--avoid <previous game directory>...]
christmas-tombola dump <game directory> [<pattern>...]
christmas-tombola send <game directory> <message> [<pattern>...]
christmas-tombola sms-test <phone> [<message>]
```

- Patterns (case-insensitive globs on displayed names) select players, `!` excludes: `'a*' '!alice'`. A pattern matching no player is likely a typo: a warning, and nothing sent with `--force`.
- Targets stay hidden, so the organizer can play too; `--show` reveals them (`draw`, `dump`, dry runs).
- Rerunning `draw` keeps existing pairs: it redraws only pairs that involve a removed player or break a new group, inserts new players, and lists the players whose target changed.
- `dump` prints the players as read from `players.json5`, with their targets under `--show`: `dump games/2026 heidi --show` shows only Heidi's.
- `send` sends a message (see [Messages](#messages)) to each selected player, on every channel they have:
  - only what is not sent yet (see [Sent messages](#sent-messages)), or to the players named by include patterns even if already sent (`'*'`: everyone);
  - without `--force` (`-f`), it does a _dry run_: prints the messages and why each is sent, sends nothing;
  - a player no channel reaches is an error, unless `inPerson`: then listed as to tell in person, with their target when sending or under `--show`;
  - it sends nothing if any message fails to render;
  - it lists the players whose sending failed with the command to retry them, and exits with code 1.
- `sms-test` sends one SMS right away, to check the gateway configuration.

## Messages

A message is a name, e.g. `announce`, `targets`, `reminder`: its templates are `<message>.email.md` and `<message>.sms.txt` in the game directory; at least one of them. A player with both email and phone gets both.

Templates are [Handlebars](https://handlebarsjs.com/) with:

- `player` and `target` (the player to give to): `name`, `displayName`, `id` and any field set in `players.json5`;
- `players`: all of them, sorted by displayed name.

A missing field is an error, not an empty string: put optional fields in `{{#if player.phone}}…{{/if}}`. Before the draw (no `lottery.json`), `target` is undefined: an announcement doesn't use it, and a template sent both before and after the draw wraps it in `{{#if target}}…{{/if}}`.

- Email: Markdown body, sent as text and HTML. Nodemailer fields go in a [TOML](https://toml.io/) front matter between `+++` lines. The recipient is always the player. See [`examples/targets.email.md`](examples/targets.email.md), and [`examples/announce.email.md`](examples/announce.email.md) for before the draw.
- SMS: plain text, see [`examples/targets.sms.txt`](examples/targets.sms.txt) and [`examples/announce.sms.txt`](examples/announce.sms.txt).

## Sent messages

`send --force` records each message sent, and each in-person player listed, in `sent.json`. A message is sent again only:

- to a new player, or to a new email or phone (reformatting it counts);
- after a new target, if the message depends on it (renders differently without it): a reminder doesn't, the targets message does;
- to players named by include patterns, e.g. after fixing a template: editing it, or the other players' details, resends nothing by itself.

A sending whose outcome is unknown (timeout) is not recorded: the next run may send it twice, as would two `send --force` at once.

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
