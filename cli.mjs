#!/usr/bin/env node

import { join } from "node:path";
import { load as loadConfig } from "app-conf";
import { readFile, writeFile } from "node:fs/promises";
import pkg from "./package.json" with { type: "json" };
import { parseArgs } from "node:util";

import {
  compileMailTemplate,
  compileTextTemplate,
  createGlobMatcher,
  createMailer,
  draw,
  hideTarget,
  namePattern,
  parsePlayers,
  shellQuote,
  unreachablePlayers,
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

    const unreachable = unreachablePlayers(players);
    if (unreachable.length !== 0) {
      // eslint-disable-next-line no-throw-literal
      throw `neither email nor phone for: ${unreachable
        .map((player) => player.displayName)
        .join(", ")} (set \`inPerson: true\` to tell them in person)`;
    }

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
      command: "email",
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
      command: "sms",
      contact: "phone",
      compile: compileTextTemplate,
      format: (message) => message,
      createSender: () => {
        const config = requireConfig(this.config, "sms");
        return (player, message) => sendSms(config, player.phone, message);
      },
    });
  },

  async "sms-test"(args) {
    const {
      positionals: [
        phone = requireArg("<phone>"),
        message = `${pkg.name} test SMS`,
      ],
    } = parseCommandArgs(args);

    await sendSms(requireConfig(this.config, "sms"), phone, message);
    return `sent to ${phone}`;
  },
});

// Renders the template for every selected player, then, if all succeed
// and `--force`, sends them one at a time; otherwise prints them, with
// targets hidden unless `--show`.
async function sendToPlayers(
  args,
  { command, contact, compile, format, createSender },
) {
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
    readFile(templateFile, "utf8").then((source) => {
      try {
        return compile(source);
      } catch (error) {
        // eslint-disable-next-line no-throw-literal
        throw `${templateFile}: ${error.message}`;
      }
    }),
  ]);

  // `send(player, message)`, created upfront to check the configuration.
  const send = force ? await createSender() : undefined;
  const isSelected = createGlobMatcher(patterns.map((_) => _.toLowerCase()));
  const sortedPlayers = sortByDisplayName(players);
  const hiddenTarget = hideTarget(players);
  const messages = [];
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
    }

    const render = (target) =>
      template({ player, players: sortedPlayers, target });
    try {
      // Rendered with the real target even if hidden: it can fail where
      // the hidden one would not.
      let message = render(target);
      if (target !== undefined && !force && !show) {
        message = render(hiddenTarget);
      }
      messages.push({ player, message });
    } catch (error) {
      // The details could tell which fields the target has.
      console.error(
        "%s: %s",
        name,
        show
          ? `${templateFile}: ${error.message}`
          : "template error, use --show for details",
      );
      failures.push(name);
    }
  }

  if (selected === 0) {
    // eslint-disable-next-line no-throw-literal
    throw "no player selected";
  }

  if (force && failures.length !== 0) {
    // eslint-disable-next-line no-throw-literal
    throw "nothing sent, fix the errors above";
  }

  if (force) {
    for (const { player, message } of messages) {
      const name = player.displayName;
      try {
        await send(player, message);
        console.log("%s: sent to %s", name, player[contact]);
      } catch (error) {
        console.error("%s: failed: %s", name, error.message);
        failures.push(name);
      }
    }
  } else {
    for (const { player, message } of messages) {
      console.log(
        "--- to %s (%s)\n%s\n",
        player.displayName,
        player[contact],
        format(message),
      );
    }
  }

  if (failures.length !== 0) {
    console.error("failed for: %s", failures.join(", "));
    if (force) {
      console.error(
        "to retry them: %s",
        [pkg.name, command, gameDir, templateFile, "--force"]
          .concat(failures.map(namePattern))
          .map(shellQuote)
          .join(" "),
      );
    }
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
  sms-test <phone> [<message>]

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
