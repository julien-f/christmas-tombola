#!/usr/bin/env node

import { join } from "node:path";
import { load as loadConfig } from "app-conf";
import { readFile, writeFile } from "node:fs/promises";
import pkg from "./package.json" with { type: "json" };
import { parseArgs } from "node:util";
import Handlebars from "handlebars";

import {
  compileMailTemplate,
  createGlobMatcher,
  createMailer,
  draw,
  parsePlayers,
} from "./utils.mjs";
import { sendSms } from "./_sendSms.mjs";

// ===================================================================

function requireArg(name) {
  const message = `Missing argument: ${name}`;

  throw message;
}

function requireConfig(config, key) {
  if (config[key] === undefined) {
    // eslint-disable-next-line no-throw-literal
    throw `missing \`${key}\` section in the configuration`;
  }
  return config[key];
}

function parseCommandArgs(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        force: { type: "boolean", short: "f", default: false },
        show: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    // A usage error, not a bug: no stack trace.
    throw error.message;
  }
}

const sortByDisplayName = (players) =>
  Object.values(players).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

const lotteryPath = (gameDir) => join(gameDir, "lottery.json");

// Returns the players and the lottery (undefined if not drawn yet).
const readGame = async (gameDir) => ({
  players: parsePlayers(await readFile(join(gameDir, "players.json5"))),
  lottery: await readFile(lotteryPath(gameDir)).then(JSON.parse, (error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }),
});

// -------------------------------------------------------------------

const COMMANDS = Object.freeze({
  async draw(args) {
    const {
      values: { show },
      positionals: [gameDir = requireArg("<game directory>")],
    } = parseCommandArgs(args);

    const { players, lottery: previous } = await readGame(gameDir);
    const { lottery, dropped, notify } = draw(players, previous);

    if (dropped.length !== 0) {
      console.warn(
        "dropped %d pair(s): player left or rules changed%s",
        dropped.length,
        show ? ": " + dropped.map((pair) => pair.join(" → ")).join(", ") : "",
      );
    }
    if (previous !== undefined) {
      console.log(
        "new or changed targets for: %s",
        notify.map((id) => players[id].displayName).join(", ") || "nobody",
      );
    }

    if (show) {
      for (const [sourceId, targetId] of Object.entries(lottery)) {
        console.log(
          "%s → %s",
          players[sourceId].displayName,
          players[targetId].displayName,
        );
      }
    }

    await writeFile(lotteryPath(gameDir), JSON.stringify(lottery, null, 2));
    console.log(
      "%d players drawn, saved to %s",
      Object.keys(lottery).length,
      lotteryPath(gameDir),
    );
  },

  async dump(args) {
    const {
      values: { show },
      positionals: [gameDir = requireArg("<game directory>")],
    } = parseCommandArgs(args);

    const { players, lottery = {} } = await readGame(gameDir);

    if (show) {
      for (const [sourceId, targetId] of Object.entries(lottery)) {
        if (sourceId in players && targetId in players) {
          players[sourceId].target = players[targetId].displayName;
        }
      }
    }

    return players;
  },

  async email(args) {
    await sendToPlayers(args, {
      contact: "email",
      compile: compileMailTemplate,
      format: ({ subject, text }) => `Subject: ${subject}\n\n${text}`,
      createSender: async () => {
        const sendMail = await createMailer(
          requireConfig(this.config, "email"),
        );
        // Not from the template: a comma in a name would split it.
        return (player, message) =>
          sendMail(
            { name: player.displayName, address: player.email },
            message,
          );
      },
    });
  },

  async sms(args) {
    await sendToPlayers(args, {
      contact: "phone",
      compile: (source) => Handlebars.compile(source, { noEscape: true }),
      format: (message) => message,
      createSender: () => {
        const config = requireConfig(this.config, "sms");
        return (player, message) => sendSms(config, player.phone, message);
      },
    });
  },
});

// Every field is "[target]", even those the real target lacks, so that
// dry runs reveal nothing about it.
const HIDDEN_TARGET = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive
        ? () => "[target]"
        : typeof key === "string" && key !== "toHTML"
          ? "[target]"
          : undefined,
    // Handlebars only reads own properties.
    getOwnPropertyDescriptor: () => ({
      value: "[target]",
      configurable: true,
      enumerable: true,
    }),
  },
);

// Renders the template for each selected player and sends it, one at a
// time, if `--force`; otherwise prints it, with targets hidden unless
// `--show`.
async function sendToPlayers(args, { contact, compile, format, createSender }) {
  const {
    values: { force, show },
    positionals: [
      gameDir = requireArg("<game directory>"),
      templateFile = requireArg("<template>"),
      ...patterns
    ],
  } = parseCommandArgs(args);

  const [{ players, lottery }, template] = await Promise.all([
    readGame(gameDir),
    readFile(templateFile, "utf8").then(compile),
  ]);

  // `send(player, message)`, created upfront to check the configuration.
  const send = force ? await createSender() : undefined;
  const isSelected = createGlobMatcher(patterns.map((_) => _.toLowerCase()));
  const sortedPlayers = sortByDisplayName(players);
  const failures = [];
  let selected = 0;

  for (const player of sortedPlayers) {
    const name = player.displayName;
    if (!isSelected(name.toLowerCase())) {
      continue;
    }
    ++selected;

    if (player[contact] === undefined) {
      console.warn("%s: no %s, skipped", name, contact);
      continue;
    }

    // Without a lottery, templates are announcements without targets.
    let target;
    if (lottery !== undefined) {
      target = players[lottery[player.id]];
      if (target === undefined) {
        console.error("%s: no valid target in lottery.json, run draw", name);
        failures.push(name);
        continue;
      }
      if (!force && !show) {
        target = HIDDEN_TARGET;
      }
    }

    const message = template({ player, players: sortedPlayers, target });

    if (!force) {
      console.log(
        "--- to %s (%s)\n%s\n",
        name,
        player[contact],
        format(message),
      );
      continue;
    }

    try {
      await send(player, message);
      console.log("%s: sent to %s", name, player[contact]);
    } catch (error) {
      console.error("%s: failed: %s", name, error.message);
      failures.push(name);
    }
  }

  if (selected === 0) {
    // eslint-disable-next-line no-throw-literal
    throw "no player selected";
  }
  if (failures.length !== 0) {
    console.error("not sent to: %s", failures.join(", "));
    process.exitCode = 1;
  } else if (!force) {
    console.log("dry run: nothing sent, use --force to send");
  }
}

// -------------------------------------------------------------------

const help = `
Usage: ${pkg.name} <command> [options] <arguments>

Commands:
  draw <game directory>
  dump <game directory>
  email <game directory> <mail template> [<pattern>...]
  sms <game directory> <sms template> [<pattern>...]

Options:
  --show       show targets (hidden by default)
  -f, --force  email, sms: really send (only printed by default)
  -h, --help   show this help (as <command>)

${pkg.name} v${pkg.version}
`;

async function main([commandName, ...commandArgs]) {
  if (commandName === "-h" || commandName === "--help") {
    return help;
  }

  if (!commandName) {
    // eslint-disable-next-line no-throw-literal
    throw `missing <command> (should be one of ${Object.keys(COMMANDS).join(
      ", ",
    )})`;
  }

  if (!Object.hasOwn(COMMANDS, commandName)) {
    // eslint-disable-next-line no-throw-literal
    throw `invalid <command>: ${commandName} (should be one of ${Object.keys(
      COMMANDS,
    ).join(", ")})`;
  }

  return COMMANDS[commandName].call(
    {
      config: await loadConfig({
        appName: "christmas-tombola",
        appDir: new URL(".", import.meta.url).pathname,
      }),
    },
    commandArgs,
  );
}

main(process.argv.slice(2)).then(
  (result) => {
    if (result !== undefined) {
      console.log(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
