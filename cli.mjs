#!/usr/bin/env node

import { dirname, join } from "node:path";
import { load as loadConfig } from "app-conf";
import { readFile, writeFile } from "fs/promises";
import { readFileSync } from "node:fs";
import execPromise from "exec-promise";
import forEach from "lodash/forEach.js";
import getopts from "getopts";
import Handlebars from "handlebars";
import orderBy from "lodash/orderBy.js";

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

    forEach(lottery, (targetId, sourceId) => {
      console.log(
        "%s → %s",
        players[sourceId].displayName,
        players[targetId].displayName
      );
    });

    await writeFile(lotteryFile, JSON.stringify(lottery, null, 2));
  },

  async dump([gameDir = requireArg("<game directory>")]) {
    const [players, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    if (lottery) {
      forEach(lottery, (targetId, sourceId) => {
        players[sourceId].target = players[targetId].displayName;
      });
    }

    return players;
  },

  async email(args) {
    const {
      force: forceFlag = false,
      _: [
        gameDir = requireArg("<game directory>"),
        mailTemplateFile = requireArg("<mail template>"),
        ...patterns
      ],
    } = getopts(args, {
      boolean: ["force"],
      alias: {
        force: ["f"],
      },
    });

    const [players, mailTemplate, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(mailTemplateFile, "utf8").then(compileMailTemplate),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    const sendMail = await createMailer(this.config.email);
    const isPlayerEnabled = createGlobMatcher(patterns);

    const sortedPlayers = orderBy(players, "displayName");

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
            forceFlag
          );
          console.log(
            "email sent to %s (%s)",
            player.displayName,
            player.email
          );
        } catch (error) {
          console.log(
            "failed sending email to %s (%s)",
            player.displayName,
            player.email,
            error
          );
        }
      })
    );
  },

  async sms(args) {
    const {
      force = false,
      _: [
        gameDir = requireArg("<game directory>"),
        templateFile = requireArg("<mail template>"),
        ...patterns
      ],
    } = getopts(args, {
      boolean: ["force"],
      alias: {
        force: ["f"],
      },
    });

    const [players, template, lottery] = await Promise.all([
      readFile(`${gameDir}/players.json5`, "utf8").then(parsePlayers),
      readFile(templateFile, "utf8").then(Handlebars.compile),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop),
    ]);

    const isPlayerEnabled = createGlobMatcher(
      patterns.map((_) => _.toLowerCase())
    );

    const sortedPlayers = orderBy(players, "displayName");

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
            console.error
          );
        }

        console.log(
          "would have sent the following message to %s (%s)",
          player.displayName,
          player.phone
        );
        console.log("---");
        console.log(message);
        console.log("---");
      })
    );
  },
});

// -------------------------------------------------------------------

const { name: pkgName, version: pkgVersion } = JSON.parse(
  readFileSync(new URL("package.json", import.meta.url))
);

const help = `
Usage: ${pkgName} <command>

${pkgName} v${pkgVersion}
`;

execPromise(async (args) => {
  const { help: helpFlag, _: restArgs } = getopts(args, {
    boolean: ["help"],
    alias: {
      help: ["h"],
    },
    stopEarly: true,
  });

  if (helpFlag) {
    return help;
  }

  const [commandName, ...commandArgs] = restArgs;

  if (!commandName) {
    // eslint-disable-next-line no-throw-literal
    throw `missing <command> (should be one of ${Object.keys(COMMANDS).join(
      ", "
    )})`;
  }

  const command = COMMANDS[commandName];
  if (!command) {
    // eslint-disable-next-line no-throw-literal
    throw `invalid <command>: ${commandName} (should be one of ${Object.keys(
      COMMANDS
    ).join(", ")})`;
  }

  return command.call(
    {
      config: await loadConfig("christmas-tombola", {
        appDir: new URL(".", import.meta.url).pathname,
      }),
    },
    commandArgs
  );
});
