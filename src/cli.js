#!/usr/bin/env node

import '../.mocha'

import execPromise from 'exec-promise'
import minimist from 'minimist'
import { load as loadConfig } from 'app-conf'
import { readFile, writeFile } from 'fs-promise'
import {
  forEach,
  orderBy
} from 'lodash'

import {
  name as pkgName,
  version as pkgVersion
} from '../package'
import {
  compileMailTemplate,
  createGlobMatcher,
  createMailer,
  draw,
  mapToArray,
  noop,
  parsePlayers
} from './utils'

// ===================================================================

function requireArg (name) {
  const message = `Missing argument: ${name}`

  throw message
}

// -------------------------------------------------------------------

const COMMANDS = Object.freeze({
  async draw ([ gameDir = requireArg('<game directory>') ]) {
    const players = parsePlayers(await readFile(`${gameDir}/players.json`))
    const lottery = draw(players)

    forEach(lottery, (targetId, sourceId) => {
      console.log(
        '%s → %s',
        players[sourceId].displayName,
        players[targetId].displayName
      )
    })

    // TODO: prompt to overwrite if necessary.
    await writeFile(
      `${gameDir}/lottery.json`,
      JSON.stringify(lottery, null, 2),
      { flag: 'wx' }
    )
  },

  async dump ([ gameDir = requireArg('<game directory>') ]) {
    const [
      players,
      lottery
    ] = await Promise.all([
      readFile(`${gameDir}/players.json`, 'utf8').then(parsePlayers),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop)
    ])

    if (lottery) {
      forEach(lottery, (targetId, sourceId) => {
        players[sourceId].target = players[targetId].displayName
      })
    }

    return players
  },

  async mail (args) {
    const {
      force: forceFlag = false,
      _: [
        gameDir = requireArg('<game directory>'),
        mailTemplateFile = requireArg('<mail template>')
      ],
      '--': patterns
    } = minimist(args, {
      boolean: ['force'],
      alias: {
        force: ['f']
      },
      '--': true
    })

    const [
      players,
      mailTemplate,
      lottery
    ] = await Promise.all([
      readFile(`${gameDir}/players.json`, 'utf8').then(parsePlayers),
      readFile(mailTemplateFile, 'utf8').then(compileMailTemplate),
      readFile(`${gameDir}/lottery.json`).then(JSON.parse, noop)
    ])

    const sendMail = createMailer(this.config.mail)
    const isPlayerEnabled = patterns.length
      ? createGlobMatcher(patterns)
      : () => true

    const sortedPlayers = orderBy(players, 'displayName')

    await Promise.all(mapToArray(players, player => {
      if (!isPlayerEnabled(player.email)) {
        return
      }

      return sendMail(mailTemplate({
        player,
        players: sortedPlayers,
        target: lottery && players[lottery[player.id]]
      }), forceFlag).then(
        console.log,
        console.error
      )
    }))
  }
})

// -------------------------------------------------------------------

const help = `
Usage: ${pkgName} <command>

${pkgName} v${pkgVersion}
`

execPromise(async args => {
  const {
    help: helpFlag,
    _: restArgs,
    '--': restRestArgs
  } = minimist(args, {
    boolean: ['help'],
    alias: {
      help: ['h']
    },
    stopEarly: true,
    '--': true
  })

  if (helpFlag) {
    return help
  }

  // Work around https://github.com/substack/minimist/issues/71
  restArgs.push('--')
  ;[].push.apply(restArgs, restRestArgs)

  const [ commandName, ...commandArgs ] = restArgs

  if (!commandName) {
    throw new Error('missing <command>')
  }

  const command = COMMANDS[commandName]
  if (!COMMANDS) {
    throw new Error(`invalid <command>: ${commandName}`)
  }

  return command.call(
    {
      config: await loadConfig('christmas-tombola')
    },
    commandArgs
  )
})
