#!/usr/bin/env node

import execPromise from 'exec-promise'
import forEach from 'lodash.foreach'
import micromatch from 'micromatch'
import minimist from 'minimist'
import { load as loadConfig } from 'app-conf'
import { readFile } from 'fs-promise'

import {
  name as pkgName,
  version as pkgVersion
} from '../package'
import {
  compileMailTemplate,
  parsePlayers
} from './utils'

// ===================================================================

const COMMANDS = Object.freeze({
  async mail (args) {
    const {
      force: forceFlag = false,
      _: [ playersFile, mailTemplateFile ],
      '--': patterns
    } = minimist({
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
      readFile(playersFile).then(parsePlayers),
      readFile(mailTemplateFile).then(compileMailTemplate)
    ])

    const playerIds = patterns.length
      ? micromatch(Object.keys(players), patterns)
      : Object.keys(players)

    forEach(playerIds, id => {
      console.log(id)
    })
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
    _: restArgs
  } = minimist(args, {
    boolean: ['help'],
    alias: {
      help: ['h']
    },
    stopEarly: true
  })

  if (helpFlag) {
    return help
  }

  const [ commandName, commandArgs ] = restArgs

  if (!commandName) {
    throw new Error('missing <command>')
  }

  const command = COMMANDS[commandName]
  if (!COMMANDS) {
    throw new Error(`invalid <command>: ${commandName}`)
  }

  return command(commandArgs)
})
