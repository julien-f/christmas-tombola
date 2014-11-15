#!/usr/bin/env node

'use strict';

//====================================================================

var Bluebird = require('bluebird');
Bluebird.longStackTraces();

var appConf = require('app-conf');
var camelCase = require('camel-case');
var chalk = require('chalk');
var createReadStream = require('fs').createReadStream;
var isArray = Array.isArray;
var multiline = require('multiline');
var nodemailer = require('nodemailer');
var nodemailerMarkdown = require('nodemailer-markdown').markdown;
var paramCase = require('param-case');
var readStream = Bluebird.promisify(require('./read-stream'));
var Set = require('es6-set');
var stripJsonComments = require('strip-json-comments');

//====================================================================

function identity(val) {
  return val;
}

function mapIterator(it, fn) {
  fn || (fn = identity);

  var res = [];
  var cur;
  while (!(cur = it.next()).done) {
    res.push(fn(cur.value));
  }
  return res;
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
  var transport = nodemailer.createTransport(config.mail.transport);
  transport.use('compile', nodemailerMarkdown());

  sendMail = Bluebird.promisify(transport.sendMail, transport) ;

  return sendMail.apply(this, arguments);
};

//====================================================================

var commands = Object.create(null);

//--------------------------------------------------------------------

function normalizePlayers(players) {
  var normalized = [];

  var inSubArray = false;
  players.forEach(function addPlayer(player, i, array) {
    if (isArray(player)) {
      inSubArray = true;
      player.forEach(addPlayer);
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

commands.generate = function (args) {
  return readStream(
    args.length ? createReadStream(args[0]) : process.stdin
  ).then(function (players) {
    players = JSON.parse(stripJsonComments(String(players)));

    players = normalizePlayers(players);
    players.sort(function (p1, p2) {
      return p1.blacklist.length - p2.blacklist.length;
    });

    var candidates = players.slice();
    shuffle(candidates);

    throw new Error('not implemented');
  });
};

//--------------------------------------------------------------------

commands.sendMail = function () {
  throw new Error('not implemented');
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
