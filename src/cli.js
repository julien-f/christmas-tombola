#!/usr/bin/env node

import execPromise from 'exec-promise'
import minimist from 'minimist'
import { readFile } from 'fs-promise'

import {
  name as pkgName,
  version as pkgVersion
} from '../package'

// ===================================================================

const COMMANDS = Object.freeze({

})

// ===================================================================

const help = `
Usage: ${pkgName}

${pkgName} v${pkgVersion}
`

execPromise(async (args) => {
  const flags = minimist(args, {
    boolean: ['help'],
    alias: {
      help: ['h']
    }
  })

  if (flags.help) {
    return help
  }
})
