#!/usr/bin/env node

import '../.mocha'

import execPromise from 'exec-promise'
import forEach from 'lodash.foreach'
import minimist from 'minimist'
import sortBy from 'lodash.sortby'
import { load as loadConfig } from 'app-conf'
import { readFile } from 'fs-promise'

import {
  name as pkgName,
  version as pkgVersion
} from '../package'
import {
  compileMailTemplate,
  createGlobMatcher,
  createMailer,
  mapToArray,
  parsePlayers
} from './utils'

// ===================================================================

const COMMANDS = Object.freeze({
  async mail (args) {
    const {
      force: forceFlag = false,
      _: [ playersFile, mailTemplateFile ],
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
      mailTemplate
    ] = await Promise.all([
      readFile(playersFile, 'utf8').then(parsePlayers),
      readFile(mailTemplateFile, 'utf8').then(compileMailTemplate)
    ])

    const sendMail = createMailer(this.config.mail)
    const isPlayerEnabled = patterns.length
      ? createGlobMatcher(patterns)
      : () => true

    const sortedPlayers = sortBy(players, 'displayName')

    await Promise.all(mapToArray(players, player => {
      if (!isPlayerEnabled(player.email)) {
        return
      }

      return sendMail(mailTemplate({
        player,
        players: sortedPlayers
      }), forceFlag).then(
        ::console.log,
        ::console.error
      )
    }))
  },

  async test (args) {
    const players = parsePlayers(await readFile(args[0]))

    return players
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
