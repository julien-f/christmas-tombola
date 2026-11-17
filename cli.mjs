#!/usr/bin/env node

import { join } from "node:path";
import { load as loadConfig } from "app-conf";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import pkg from "./package.json" with { type: "json" };
import { parseArgs } from "node:util";

import {
  CHANNEL_SUFFIXES,
  compileMailTemplate,
  compileTextTemplate,
  createGlobMatcher,
  createMailer,
  deliveryReason,
  dependsOnTarget,
  draw,
  excludePairs,
  hideTarget,
  messageTemplates,
  namePattern,
  parsePlayers,
  recordDelivery,
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
        avoid: { type: "string", multiple: true, default: [] },
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

// Undefined if the file does not exist.
const readOptionalJson = (path) =>
  readFile(path).then(parseFile(path, JSON.parse), (error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });

// Through a temporary file in the same directory (a rename across file
// systems fails): an interruption cannot leave it truncated.
const writeJson = async (path, value) => {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
};

const sentPath = (gameDir) => join(gameDir, "sent.json");

// Returns the players and the lottery (undefined if not drawn yet).
const readGame = async (gameDir) => {
  const playersPath = join(gameDir, "players.json5");
  return {
    players: await readFile(playersPath).then(
      parseFile(playersPath, parsePlayers),
    ),
    lottery: await readOptionalJson(lotteryPath(gameDir)),
  };
};

// -------------------------------------------------------------------

const COMMANDS = Object.freeze({
  async draw(args) {
    const {
      values: { avoid, show },
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

    for (const avoidDir of avoid) {
      const path = lotteryPath(avoidDir);
      const count = excludePairs(
        players,
        await readFile(path).then(parseFile(path, JSON.parse)),
      );
      console.log("avoiding %d pair(s) from %s", count, path);
    }

    let result;
    try {
      result = draw(players, previous);
    } catch (error) {
      if (!error.message.startsWith("no valid draw")) {
        throw error;
      }
      // The players' to fix, not a bug: no stack trace.
      throw avoid.length === 0
        ? error.message
        : `${error.message}; try without --avoid`;
    }
    const { lottery, dropped, notify } = result;

    if (dropped.length !== 0) {
      console.warn(
        "dropped %d pair(s): player left or rules changed%s",
        dropped.length,
        show ? ": " + dropped.map((pair) => pair.join(" → ")).join(", ") : "",
      );
      const gone = [
        ...new Set(dropped.flat().filter((id) => !(id in players))),
      ];
      if (gone.length !== 0) {
        console.warn(
          "left the game or renamed: %s (to rename without redrawing, keep the old id: `id: %s`)",
          gone.join(", "),
          JSON.stringify(gone[0]),
        );
      }
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
    if (notify.length !== 0) {
      console.log(
        "next: %s",
        [pkg.name, "send", gameDir, "targets"].map(shellQuote).join(" "),
      );
    }
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

  send(args) {
    return send(this.config, args);
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

// How each channel reaches a player.
const CHANNELS = {
  email: {
    label: "email",
    contact: "email",
    compile: compileMailTemplate,
    format: ({ subject, text }) => `Subject: ${subject}\n\n${text}`,
    // Returns `send(player, content)`, created before sending any to
    // check the configuration.
    async createSender(config) {
      const sendMail = await createMailer(requireConfig(config, "email")).catch(
        (error) => {
          // eslint-disable-next-line no-throw-literal
          throw `SMTP server (\`email.transport\` in the configuration): ${error.message}`;
        },
      );
      // Not from the template: a comma in a name would split it.
      return (player, content) =>
        sendMail({ name: player.displayName, address: player.email }, content);
    },
  },
  sms: {
    label: "SMS",
    contact: "phone",
    compile: compileTextTemplate,
    format: (content) => {
      const { count, nonGsm } = smsSegments(content);
      return `${content}\n(~${count} SMS${
        nonGsm === undefined ? "" : `, shorter because of "${nonGsm}"`
      })`;
    },
    createSender(config, contents) {
      const smsConfig = requireConfig(config, "sms");
      const total = contents.reduce(
        (sum, content) => sum + smsSegments(content).count,
        0,
      );
      if (total > SMS_LIMIT) {
        console.warn(
          "%d SMS: past %d in 30 minutes, Android asks on the phone to allow more",
          total,
          SMS_LIMIT,
        );
      }
      return (player, content) => sendSms(smsConfig, player.phone, content);
    },
  },
};

// Why no channel reaches `player`, and how to fix it.
function unreachableReason(player, message) {
  const contacts = Object.keys(CHANNELS).filter(
    (channel) => player[CHANNELS[channel].contact] !== undefined,
  );
  if (contacts.length === 0) {
    return "neither email nor phone (set `inPerson: true` to tell them in person)";
  }
  return `no ${contacts
    .map((channel) => message + CHANNEL_SUFFIXES[channel])
    .join(" or ")} for their ${contacts
    .map((channel) => CHANNELS[channel].contact)
    .join(" and ")} (add it, or skip with ${shellQuote(
    "!" + namePattern(player.displayName),
  )})`;
}

// Renders the message for every selected player on each of their
// channels, then, if all succeed and `--force`, sends them one at a
// time; otherwise prints them, with targets hidden unless `--show`.
async function send(config, args) {
  const {
    values: { force, show },
    positionals: [
      gameDir = requireArg("<game directory>"),
      message = requireArg("<message>"),
      ...patterns
    ],
  } = parseCommandArgs(args);

  const fileNames = await readdir(gameDir);
  let files;
  try {
    files = messageTemplates(fileNames, message);
  } catch (error) {
    // The user's to fix, not a bug: no stack trace.
    throw error.message;
  }
  const channels = Object.keys(files);
  console.log(
    "%s: %s",
    message,
    channels.length === Object.keys(CHANNELS).length
      ? channels.map((channel) => CHANNELS[channel].label).join(" and ")
      : `${CHANNELS[channels[0]].label} only (no ${Object.keys(CHANNELS)
          .filter((channel) => !channels.includes(channel))
          .map((channel) => message + CHANNEL_SUFFIXES[channel])
          .join(", ")})`,
  );

  const [{ players, lottery }, sent, templates] = await Promise.all([
    readGame(gameDir),
    readOptionalJson(sentPath(gameDir)).then((sent = {}) => sent),
    Promise.all(
      channels.map(async (channel) => {
        const path = join(gameDir, files[channel]);
        const template = await readFile(path, "utf8").then(
          parseFile(path, CHANNELS[channel].compile),
        );
        return [channel, template];
      }),
    ).then(Object.fromEntries),
  ]);

  const isSelected = createPlayerMatcher(players, patterns, { force });
  // Include patterns name players to send to even if already sent; `!`
  // patterns only filter.
  const includes = patterns
    .filter((pattern) => pattern[0] !== "!")
    .map((pattern) => pattern.toLowerCase());
  const matchesInclude = createGlobMatcher(includes);
  const isResent = (player) =>
    includes.length !== 0 && matchesInclude(player.displayName.toLowerCase());

  const sortedPlayers = sortByDisplayName(players);
  const hiddenTarget = hideTarget(players);
  const messageSent = sent[message] ?? {};
  const deliveries = [];
  const inPerson = [];
  const failures = new Set();
  let selected = 0;
  let alreadySent = 0;
  let lastSent = "";

  // Adds `delivery` to `list` if pending, else counts it as already sent.
  const addIfPending = (list, delivery) => {
    const reason = deliveryReason(messageSent, delivery, {
      resend: isResent(delivery.player),
    });
    if (reason === undefined) {
      ++alreadySent;
      const { date } = messageSent[delivery.playerId][delivery.channel];
      if (date > lastSent) {
        lastSent = date;
      }
    } else {
      list.push({ ...delivery, reason });
    }
  };

  for (const player of sortedPlayers) {
    const name = player.displayName;
    if (!isSelected(player)) {
      continue;
    }
    ++selected;

    // Without a lottery, messages are announcements without targets.
    let target;
    if (lottery !== undefined) {
      target = players[lottery[player.id]];
      if (target === undefined) {
        console.error("%s: no valid target in lottery.json, run draw", name);
        failures.add(name);
        continue;
      }
    }
    const renderer = (channel) => (target) =>
      templates[channel]({ player, players: sortedPlayers, target });
    const delivery = (channel, dependent) => ({
      player,
      playerId: player.id,
      channel,
      contact: player[CHANNELS[channel]?.contact],
      target: dependent ? target.id : undefined,
    });

    const reachable = channels.filter(
      (channel) => player[CHANNELS[channel].contact] !== undefined,
    );
    if (reachable.length === 0) {
      if (player.inPerson) {
        // Any template tells whether the message is about the target.
        const dependent = (() => {
          try {
            return dependsOnTarget(renderer(channels[0]), target);
          } catch {
            return true;
          }
        })();
        addIfPending(inPerson, delivery("inPerson", dependent));
      } else {
        console.error("%s: %s", name, unreachableReason(player, message));
        failures.add(name);
      }
      continue;
    }

    for (const channel of reachable) {
      const render = renderer(channel);
      try {
        // Rendered with the real target even if hidden: it can fail where
        // the hidden one would not.
        let content = render(target);
        const dependent = dependsOnTarget(render, target);
        if (target !== undefined && !force && !show) {
          content = render(hiddenTarget);
        }
        addIfPending(deliveries, { ...delivery(channel, dependent), content });
      } catch (error) {
        // The details could tell which fields the target has.
        console.error(
          "%s: %s",
          name,
          show || target === undefined
            ? `${files[channel]}: ${error.message}${
                lottery === undefined ? " (before the draw, no target)" : ""
              }`
            : "template error, use --show for details",
        );
        failures.add(name);
      }
    }
  }

  if (selected === 0) {
    // eslint-disable-next-line no-throw-literal
    throw "no player selected";
  }

  if (force && failures.size !== 0) {
    // eslint-disable-next-line no-throw-literal
    throw "nothing sent, fix the errors above";
  }

  // Recorded after each sending, so that a failure or an interruption
  // keeps the others.
  let records = sent;
  const record = async (delivery) => {
    records = {
      ...records,
      [message]: recordDelivery(
        records[message] ?? {},
        delivery,
        new Date().toISOString().slice(0, 10),
      ),
    };
    try {
      await writeJson(sentPath(gameDir), records);
    } catch (error) {
      // eslint-disable-next-line no-throw-literal
      throw `${delivery.player.displayName}: sent but not recorded in sent.json (${error.message}): stopped, else the next run sends it again`;
    }
  };

  if (force) {
    const senders = {};
    for (const channel of channels) {
      const contents = deliveries
        .filter((delivery) => delivery.channel === channel)
        .map((delivery) => delivery.content);
      if (contents.length !== 0) {
        senders[channel] = await CHANNELS[channel].createSender(
          config,
          contents,
        );
      }
    }
    for (const delivery of deliveries) {
      const name = delivery.player.displayName;
      try {
        await senders[delivery.channel](delivery.player, delivery.content);
      } catch (error) {
        console.error("%s: failed: %s", name, error.message);
        failures.add(name);
        continue;
      }
      console.log("%s: sent to %s", name, delivery.contact);
      await record(delivery);
    }
  } else {
    for (const { player, channel, contact, content, reason } of deliveries) {
      console.log(
        "--- %s to %s (%s) [%s]\n%s\n",
        CHANNELS[channel].label,
        player.displayName,
        contact,
        reason,
        CHANNELS[channel].format(content),
      );
    }
  }

  if (inPerson.length !== 0) {
    // When sending, the organizer is telling everyone: no need to hide.
    console.log(
      "to tell in person: %s",
      inPerson
        .map(({ player, target }) =>
          force || show
            ? [player.displayName, players[target]?.displayName]
                .filter(Boolean)
                .join(" → ")
            : player.displayName,
        )
        .join(", "),
    );
    if (force) {
      for (const delivery of inPerson) {
        await record(delivery);
      }
    }
  }

  if (alreadySent !== 0) {
    console.log("%d already sent, last on %s", alreadySent, lastSent);
  }
  if (deliveries.length === 0 && inPerson.length === 0 && failures.size === 0) {
    console.log("nothing to send (to resend: add '*' or names)");
    return;
  }

  if (failures.size !== 0) {
    console.error("failed for: %s", [...failures].join(", "));
    if (force) {
      console.error(
        "to retry them: %s",
        [pkg.name, "send", gameDir, message, "--force"]
          .concat([...failures].map(namePattern))
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
  draw <game directory> [--avoid <previous game directory>...]
  dump <game directory> [<pattern>...]
  send <game directory> <message> [<pattern>...]
      <message>.email.md and <message>.sms.txt in the game directory
  sms-test <phone> [<message>]

Options:
  --avoid      draw: no pair of that game (e.g. last year's)
  --show       show targets (hidden by default)
  -f, --force  send: really send (only printed by default)
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
