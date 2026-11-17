#!/usr/bin/env node

import { dirname, join } from "node:path";
import { load as loadConfig } from "app-conf";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import Handlebars from "handlebars";

import {
  compileMailTemplate,
  createGlobMatcher,
  createMailer,
  draw,
  noop,
  parsePlayers,
} from "./utils.mjs";
import { sendSms } from "./_sendSms.mjs";

// ===================================================================

function requireArg(name) {
  const message = `Missing argument: ${name}`;

  throw message;
}

const parseCommandArgs = (args) =>
  parseArgs({
    args,
    allowPositionals: true,
    options: { force: { type: "boolean", short: "f", default: false } },
  });

const sortByDisplayName = (players) =>
  Object.values(players).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

// -------------------------------------------------------------------

const COMMANDS = Object.freeze({
  async draw([playersFile = requireArg("<game directory>"), lotteryFile]) {
    if (lotteryFile === undefined) {
      lotteryFile = join(dirname(playersFile), "lottery.json");
    }

    let lottery = await readFile(lotteryFile)
      .then(JSON.parse)
      .catch((error) => {
        if (error.code !== "ENOENT") {
          console.warn("error reading lottery", error);
        }
      });

    const players = parsePlayers(await readFile(playersFile));
    lottery = draw(players, lottery);

    for (const [sourceId, targetId] of Object.entries(lottery)) {
      console.log(
        "%s → %s",
        players[sourceId].displayName,
        players[targetId].displayName,
      );
    }

    await writeFile(lotteryFile, JSON.stringify(lottery, null, 2));
  },

  async dump([gameDir = requireArg("<game directory>")]) {
    const [players, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    if (lottery) {
      for (const [sourceId, targetId] of Object.entries(lottery)) {
        players[sourceId].target = players[targetId].displayName;
      }
    }

    return players;
  },

  async email(args) {
    const {
      values: { force: forceFlag },
      positionals: [
        gameDir = requireArg("<game directory>"),
        mailTemplateFile = requireArg("<mail template>"),
        ...patterns
      ],
    } = parseCommandArgs(args);

    const [players, mailTemplate, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(mailTemplateFile, "utf8").then(compileMailTemplate),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    const sendMail = await createMailer(this.config.email);
    const isPlayerEnabled = createGlobMatcher(patterns);

    const sortedPlayers = sortByDisplayName(players);

    await Promise.all(
      sortedPlayers.map(async (player) => {
        if (!isPlayerEnabled(player.displayName.toLowerCase())) {
          return;
        }

        if (player.email === undefined) {
          console.warn("email: player %s has no address", player.displayName);
          return;
        }

        try {
          await sendMail(
            mailTemplate({
              player,
              players: sortedPlayers,
              target: lottery && players[lottery[player.id]],
            }),
            forceFlag,
          );
          console.log(
            "email sent to %s (%s)",
            player.displayName,
            player.email,
          );
        } catch (error) {
          console.log(
            "failed sending email to %s (%s)",
            player.displayName,
            player.email,
            error,
          );
        }
      }),
    );
  },

  async sms(args) {
    const {
      values: { force },
      positionals: [
        gameDir = requireArg("<game directory>"),
        templateFile = requireArg("<mail template>"),
        ...patterns
      ],
    } = parseCommandArgs(args);

    const [players, template, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(templateFile, "utf8").then(Handlebars.compile),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    const isPlayerEnabled = createGlobMatcher(
      patterns.map((_) => _.toLowerCase()),
    );

    const sortedPlayers = sortByDisplayName(players);

    await Promise.all(
      sortedPlayers.map(async (player) => {
        if (!isPlayerEnabled(player.displayName.toLowerCase())) {
          return;
        }

        if (player.phone === undefined) {
          console.warn("sms: player %s has no number", player.displayName);
          return;
        }

        const message = template({
          player,
          players: sortedPlayers,
          target: lottery && players[lottery[player.id]],
        });

        if (force) {
          return sendSms(this.config.sms, player.phone, message).then(
            console.log,
            console.error,
          );
        }

        console.log(
          "would have sent the following message to %s (%s)",
          player.displayName,
          player.phone,
        );
        console.log("---");
        console.log(message);
        console.log("---");
      }),
    );
  },
});

// -------------------------------------------------------------------

const { name: pkgName, version: pkgVersion } = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url)),
);

const help = `
Usage: ${pkgName} <command> [arguments]

Commands:
  draw <players file> [<lottery file>]
  dump <game directory>
  email [--force] <game directory> <mail template> [<pattern>...]
  sms [--force] <game directory> <sms template> [<pattern>...]

${pkgName} v${pkgVersion}
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
