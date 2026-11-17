# christmas-tombola

Draws who gives a gift to whom, then tells each player by email or SMS.

## Install

Node 24+:

```sh
npm ci
npm link # optional: puts `christmas-tombola` on the PATH, otherwise use ./cli.mjs
```

Configuration (SMTP, SMS gateway): copy [`example-config.json5`](example-config.json5) to `~/.config/christmas-tombola/config.json5`.

SMS are sent by an Android phone running [SMS Gate](https://sms-gate.app) in Local Server mode, on the same network:

- disable battery optimization for the app (Samsung: _Unrestricted_), else the server stops when the screen is off;
- phone numbers in international format (`+33612345678`);
- past 30 SMS in 30 minutes, Android asks on the phone to allow more.

## Game directory

One directory per game, e.g. `games/2026/`:

- `players.json5`: the players, written by hand;
- `lottery.json`: the draw (giver id → receiver id), written by `draw`.

```json5
[
  // A group: its members never draw each other.
  [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", phone: "+15550001" },
    // Groups can be nested: members of the outer group never draw
    // anyone of the inner one, and the other way around.
    [
      { name: "Carol", email: "carol@example.com" },
      { name: "Dan", email: "dan@example.com" },
    ],
  ],
  // Same names are told apart: displayed as "Alice (junior)".
  { name: "Alice", disambiguation: "junior", email: "alice.jr@example.com" },
  { name: "Frank", email: "frank@example.com" },
  { name: "Grace", email: "grace@example.com" },
  { name: "Heidi", email: "heidi@example.com" },
  // Kept in the file but not in the draw.
  { name: "Eve", email: "eve@example.com", participate: false },
]
```

- `draw` refuses a player with neither `email` nor `phone`, unless `inPerson: true` (the organizer tells them).
- `id` defaults to the displayed name; set it to rename a player without breaking `lottery.json`.
- Nobody draws themselves, someone of their groups, or the player who draws them.

## Commands

```sh
christmas-tombola draw <game directory>
christmas-tombola dump <game directory>
christmas-tombola email <game directory> <template> [<pattern>...]
christmas-tombola sms <game directory> <template> [<pattern>...]
christmas-tombola sms-test <phone> [<message>]
```

- Targets stay hidden, so the organizer can play too; `--show` reveals them (`draw`, `dump`, dry runs).
- `draw` again after editing players: pairs of players who left or breaking new groups are redrawn, new players are inserted, and it lists who has a new target (send to them again).
- `email` and `sms` only print the messages; `--force` (`-f`) sends them, unless a message fails to render: then nothing is sent. Failed players are listed and the exit code is 1.
- `sms-test` sends one SMS right away, to check the gateway configuration.
- Patterns (case-insensitive globs on displayed names) select players: `'a*' '!alice'`.
- Before the draw (no `lottery.json`), templates can announce the game without `target`.

## Templates

[Handlebars](https://handlebarsjs.com/) with `player`, `target` (the player to give to) and `players` (all, sorted by name).

A missing field is an error, not an empty string: put optional fields in `{{#if player.phone}}…{{/if}}`, and `target` in `{{#if target}}…{{/if}}` in templates also sent before the draw.

Email: Markdown body (sent as text and HTML), Nodemailer fields in the front matter; the recipient is always the player.

```md
---
subject: Your Christmas draw
---

Hi {{player.name}}, this year you give a gift to **{{target.displayName}}**.
```

SMS: plain text.

## License

ISC © [Julien Fontanet](https://github.com/julien-f)
