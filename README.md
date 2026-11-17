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

SMS messages are sent through an Android phone running [SMS Gate](https://sms-gate.app) in Local Server mode, on the same network:

- Disable battery optimization for the app (Samsung: _Unrestricted_), else the server stops when the screen is off.
- Past 30 SMS in 30 minutes, Android asks for approval on the phone; `sms --force` warns beforehand.
- A character outside the GSM alphabet (e.g. `ç`, `ê`, emoji) cuts each SMS from 160 to 70 characters: the dry run shows the estimated count.

## First game

1. `cp -r examples games/2026` (`games/` is git-ignored), then edit `games/2026/players.json5`.
2. Optionally, announce the game: `christmas-tombola email games/2026 games/2026/announce.md`.
3. `christmas-tombola draw games/2026`.
4. Check the messages with a dry run: `christmas-tombola email games/2026 games/2026/email.md`, and the same with `sms` and `sms.txt`.
5. Send them: the same commands with `--force`; they end with the in-person players to tell and their targets.
6. After editing the players, `draw` again and send to the players it lists: `christmas-tombola email games/2026 games/2026/email.md 'alice' 'grace' --force`.

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
christmas-tombola draw <game directory>
christmas-tombola dump <game directory> [<pattern>...]
christmas-tombola email <game directory> <template> [<pattern>...]
christmas-tombola sms <game directory> <template> [<pattern>...]
christmas-tombola sms-test <phone> [<message>]
```

- `<template>` is a path from the current directory, e.g. `games/2026/email.md`.
- Patterns (case-insensitive globs on displayed names) select players, `!` excludes: `'a*' '!alice'`. A pattern matching no player is likely a typo: a warning, and nothing sent with `--force`.
- Targets stay hidden, so the organizer can play too; `--show` reveals them (`draw`, `dump`, dry runs).
- Rerunning `draw` keeps existing pairs: it redraws only pairs that involve a removed player or break a new group, inserts new players, and lists the players whose target changed.
- `dump` prints the players as read from `players.json5`, with their targets under `--show`: `dump games/2026 heidi --show` shows only Heidi's.
- `email` and `sms`:
  - without `--force` (`-f`), do a _dry run_: print the messages, send nothing;
  - skip players without `email` (resp. `phone`), with a warning, or listed as to tell in person if `inPerson`, with their targets when sending or under `--show`;
  - send nothing if any message fails to render;
  - list the players whose sending failed with the command to retry them, and exit with code 1.
- `sms-test` sends one SMS right away, to check the gateway configuration.

## Templates

[Handlebars](https://handlebarsjs.com/) with:

- `player` and `target` (the player to give to): `name`, `displayName`, `id` and any field set in `players.json5`;
- `players`: all of them, sorted by displayed name.

A missing field is an error, not an empty string: put optional fields in `{{#if player.phone}}…{{/if}}`. Before the draw (no `lottery.json`), `target` is undefined: an announcement doesn't use it, and a template sent both before and after the draw wraps it in `{{#if target}}…{{/if}}`.

- Email: Markdown body, sent as text and HTML. Nodemailer fields go in a [TOML](https://toml.io/) front matter between `+++` lines. The recipient is always the player. See [`examples/email.md`](examples/email.md), and [`examples/announce.md`](examples/announce.md) for before the draw.
- SMS: plain text, see [`examples/sms.txt`](examples/sms.txt).

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
