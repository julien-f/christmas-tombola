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
  unmatchedPatterns,
  unreachablePlayers,
} from "./utils.mjs";
import { sendSms, smsSegments } from "./_sendSms.mjs";

// Android's default limit, per 30 minutes.
const SMS_LIMIT = 30;

// ===================================================================

function requireArg(name) {
  // eslint-disable-next-line no-throw-literal
  throw `missing argument: ${name}`;
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

// Case-insensitive, on displayed names. A pattern matching no player is
// a likely typo: someone left out, or not excluded.
const createPlayerMatcher = (players, patterns, { force = false } = {}) => {
  const lowerPatterns = patterns.map((_) => _.toLowerCase());
  const unmatched = unmatchedPatterns(
    lowerPatterns,
    Object.values(players).map((player) => player.displayName.toLowerCase()),
  );
  if (unmatched.length !== 0) {
    const message = `no player matches: ${unmatched.join(", ")} (patterns match displayed names, see dump)`;
    if (force) {
      // eslint-disable-next-line no-throw-literal
      throw `${message}, nothing sent`;
    }
    console.warn(message);
  }

  const matches = createGlobMatcher(lowerPatterns);
  return (player) => matches(player.displayName.toLowerCase());
};

const lotteryPath = (gameDir) => join(gameDir, "lottery.json");

// Returns `parse(content)`; its errors are the user's to fix: no stack
// trace, but the file.
const parseFile = (path, parse) => (content) => {
  try {
    return parse(content);
  } catch (error) {
    // eslint-disable-next-line no-throw-literal
    throw `${path}: ${error.message}`;
  }
};

// Returns the players and the lottery (undefined if not drawn yet).
const readGame = async (gameDir) => {
  const playersPath = join(gameDir, "players.json5");
  return {
    players: await readFile(playersPath).then(
      parseFile(playersPath, parsePlayers),
    ),
    lottery: await readFile(lotteryPath(gameDir)).then(
      parseFile(lotteryPath(gameDir), JSON.parse),
      (error) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      },
    ),
  };
};

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

    let result;
    try {
      result = draw(players, previous);
    } catch (error) {
      // The players' to fix, not a bug: no stack trace.
      throw error.message.startsWith("no valid draw") ? error.message : error;
    }
    const { lottery, dropped, notify } = result;

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
      positionals: [gameDir = requireArg("<game directory>"), ...patterns],
    } = parseCommandArgs(args);

    const { players, lottery = {} } = await readGame(gameDir);

    if (show) {
      for (const [sourceId, targetId] of Object.entries(lottery)) {
        if (sourceId in players && targetId in players) {
          players[sourceId].target = players[targetId].displayName;
        }
      }
    }

    const isSelected = createPlayerMatcher(players, patterns);
    return Object.fromEntries(
      Object.entries(players).filter(([, player]) => isSelected(player)),
    );
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
      format: (message) => {
        const { count, nonGsm } = smsSegments(message);
        return `${message}\n(~${count} SMS${
          nonGsm === undefined ? "" : `, shorter because of "${nonGsm}"`
        })`;
      },
      createSender: (messages) => {
        const config = requireConfig(this.config, "sms");
        const total = messages.reduce(
          (sum, message) => sum + smsSegments(message).count,
          0,
        );
        if (total > SMS_LIMIT) {
          console.warn(
            "%d SMS: past %d in 30 minutes, Android asks on the phone to allow more",
            total,
            SMS_LIMIT,
          );
        }
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

    try {
      await sendSms(requireConfig(this.config, "sms"), phone, message);
    } catch (error) {
      // What this command checks, not a bug: no stack trace.
      throw error.message;
    }
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
    readFile(templateFile, "utf8").then(parseFile(templateFile, compile)),
  ]);

  const isSelected = createPlayerMatcher(players, patterns, { force });
  const sortedPlayers = sortByDisplayName(players);
  const hiddenTarget = hideTarget(players);
  const messages = [];
  const failures = [];
  const inPerson = [];
  let selected = 0;

  for (const player of sortedPlayers) {
    const name = player.displayName;
    if (!isSelected(player)) {
      continue;
    }
    ++selected;

    if (player[contact] === undefined) {
      if (player.inPerson) {
        inPerson.push(player);
      } else {
        console.warn("%s: no %s, skipped", name, contact);
      }
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
    // `send(player, message)`, created before sending any to check the
    // configuration.
    const send = await createSender(messages.map(({ message }) => message));
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

  if (inPerson.length !== 0) {
    // When sending, the organizer is telling everyone: no need to hide.
    const target = (player) =>
      (force || show) && players[lottery?.[player.id]]?.displayName;
    console.log(
      "to tell in person: %s",
      inPerson
        .map((player) =>
          [player.displayName, target(player)].filter(Boolean).join(" → "),
        )
        .join(", "),
    );
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
  dump <game directory> [<pattern>...]
  email <game directory> <mail template> [<pattern>...]
  sms <game directory> <sms template> [<pattern>...]
  sms-test <phone> [<message>]

Options:
  --show       show targets (hidden by default)
  -f, --force  email, sms: really send (only printed by default)
  -h, --help   show this help

${pkg.name} v${pkg.version}
`;

async function main(args) {
  // Before `--`, after which `-h` is a pattern.
  const end = args.indexOf("--");
  const options = end === -1 ? args : args.slice(0, end);
  if (options.includes("-h") || options.includes("--help")) {
    return help;
  }

  const [commandName, ...commandArgs] = args;

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
    // A system error (file not found…) is the user's to fix: no stack trace.
    console.error(error?.syscall === undefined ? error : error.message);
    process.exitCode = 1;
  },
);
