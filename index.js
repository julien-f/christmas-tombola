#!/usr/bin/env node

'use strict';

//====================================================================

var Bluebird = require('bluebird');
Bluebird.longStackTraces();

var appConf = require('app-conf');
var camelCase = require('camel-case');
var chalk = require('chalk');
var createReadStream = require('fs').createReadStream;
var forEach = require('lodash.foreach');
var isArray = Array.isArray;
var isString = require('lodash.isstring');
var map = require('lodash.map');
var minimist = require('minimist');
var multiline = require('multiline');
var nodemailer = require('nodemailer');
var nodemailerMarkdown = require('nodemailer-markdown').markdown;
var paramCase = require('param-case');
var streamToBuffer = Bluebird.promisify(require('stream-to-buffer'));
var stripJsonComments = require('strip-json-comments');

var parseMessage = require('./parse-message');

//====================================================================

function parseJson(data) {
  return JSON.parse(stripJsonComments(String(data)));
}

// Fisher-Yates shuffle.
// http://bost.ocks.org/mike/shuffle/
function shuffle(array) {
  var n = array.length;
  var i, tmp;

  while (n) {
    i = Math.floor(Math.random() * n--);
    tmp = array[n];
    array[n] = array[i];
    array[i] = tmp;
  }
}

//====================================================================

var config;

var sendMail = function initSendMail() {
  var mailConfig = config.mail;

  var transport = nodemailer.createTransport(mailConfig.transport);
  transport.use('compile', nodemailerMarkdown());

  sendMail = function sendMail(data, test) {
    return new Bluebird(function (resolve, reject) {
      data.from || (data.from = mailConfig.from);
      data.bcc || (data.bcc = mailConfig.bcc);

      if (test) {
        return resolve(data);
      }

      transport.sendMail(data, function (error, result) {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  };

  return sendMail.apply(this, arguments);
};

//====================================================================

var commands = Object.create(null);

//--------------------------------------------------------------------

function normalizePlayers(players) {
  var normalized = [];

  var inSubArray = false;
  forEach(players, function addPlayer(player, i, array) {
    if (isArray(player)) {
      inSubArray = true;
      forEach(player, addPlayer);
      inSubArray = false;
      return;
    }

    if (inSubArray) {
      player.blacklist = new Set(array);
    } else {
      player.blacklist = new Set([player]);
    }

    normalized.push(player);
  });

  return normalized;
}

// FIXME: the algorithm used is broken, players should be ordered by
// number of candidates, not the size of the blacklist.
//
// FIXME: using maps of identifiers would be much better that sets of
// objects.
commands.draw = function (args) {
  return streamToBuffer(
    args.length ? createReadStream(args[0]) : process.stdin
  ).then(parseJson).then(function (players) {
    players = normalizePlayers(players);

    var todo = players.slice();

    var candidates = players.slice();
    shuffle(candidates);

    var player, target;
    var i;
    while (todo.length) {
      // Select the player with the largest blacklist.
      todo.sort(function (p1, p2) {
        return p1.blacklist.length - p2.blacklist.length;
      });
      player = todo.shift();

      // Select the first player which is not in the blacklist.
      i = candidates.length - 1;
      do {
        target = candidates[i];
      } while (player.blacklist.has(target) && i--);

      if (i < 0) {
        throw new Error('no candidate found');
      }

      // Create & insert identifier.
      target.id = target.name;
      target.disambiguation && (
        target.id += ' (' + target.disambiguation + ')'
      );

      candidates.splice(i, 1);
      player.target = target.id;
      target.blacklist && target.blacklist.add(player);

      // This player does not need a blacklist.
      delete player.blacklist;
    }

    var draw = {};
    forEach(players, function (player) {
      draw[player.id] = player;
      delete player.id;
    });

    return draw;
  });
};

//--------------------------------------------------------------------

function prettyFormat(value) {
  // Extract real error from Bluebird's wrapper.
  if (value instanceof Bluebird.OperationalError) {
    value = value.cause;
  }

  if (isString(value)) {
    return value;
  }

  if (value instanceof Error) {
    return value.message +'\n'+ value.stack;
  }

  return JSON.stringify(value, null, 2);
}

var successStyle = chalk.green;
function printSuccess(val) {
  console.log(successStyle(prettyFormat(val)));
}

var failureStyle = chalk.bold.red;
function printFailure(val) {
  console.log(failureStyle(prettyFormat(val)));
}

commands.mail = function (args) {
  args = minimist(args, {
    boolean: 'force',

    alias: {
      force: 'f',
    },
    default: {
      force: false,
    },

    // Names are to be specified after --.
    '--': true,
  });
  var testMode = !args.force;
  var playerEnabled = args['--'].length ?
    function filterPlayer(player) {
      return args['--'].indexOf(player.id) !== -1;
    } :
    function () { return true; }
  ;

  return Bluebird.join(
    streamToBuffer(createReadStream(args._[0])).then(parseJson),
    streamToBuffer(createReadStream(args._[1])).then(parseMessage),
    function (draw, message) {
      var players = Object.keys(draw).sort(function (a, b) {
        // FIXME: does not work as expected in Node.
        return a.localeCompare(b);
      });

      return map(draw, function (player, id) {
        player.id = id;
        if (!playerEnabled(player)) {
          return;
        }

        var target = draw[player.target];

        // Evaluate the message for this player.
        return sendMail(message({
          player: player,
          target: target,
          players: players,
        }), testMode).then(printSuccess, printFailure);
      });
    }
  ).all().return();
};

//--------------------------------------------------------------------

commands.help = (function (pkg, commands) {
  var commandStyle = chalk.magenta.bold;
  var nameStyle = chalk.bold;
  var paramStyle = chalk.yellow;

  commands = commands.sort().map(function (val) {
    return commandStyle(val);
  }).join(', ');

  var str = multiline.stripIndent(function () {/*
    Usage: $name <command>

    Where command can be: $commands

    $name v$version
  */}).replace(/<([^>]+)>|\$(\w+)/g, function (_, arg, key) {
    if (arg) {
      return '<'+ paramStyle(arg) +'>';
    }

    if ('name' === key) {
      return nameStyle(pkg.name);
    }

    if ('commands' === key) {
      return commands;
    }

    return pkg[key];
  });

  return function () {
    return str;
  };
})(require('./package'), Object.keys(commands).map(paramCase));

//====================================================================

function main(args) {
  var command = 'help';

  if (args.length) {
    command = args[0];
    args.shift();
  }

  var fn = commands[camelCase(command)];
  if (!fn) {
    throw new Error('no such command: ' + command);
  }

  return appConf.load('christmas-tombola').then(function (cfg) {
    config = cfg;

    return fn(args);
  });
}
require('exec-promise')(main);
