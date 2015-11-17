import forEach from 'lodash.foreach'
import frontMatter from 'front-matter'
import isArray from 'lodash.isarray'
import isFunction from 'lodash.isfunction'
import isString from 'lodash.isstring'
import nodemailer from 'nodemailer'
import nodemailerStubTransport from 'nodemailer-stub-transport'
import pify from 'pify'
import { compile as handlebars } from 'handlebars'
import { markdown as nodemailerMarkdown } from 'nodemailer-markdown'
import { matcher as createSingleGlobaMatcher } from 'micromatch'
import { parse as parseJson } from 'json5'

// ===================================================================

function compileRecursively (template) {
  if (isString(template)) {
    return handlebars(template)
  }

  return mapInPlace(template, compileRecursively)
}

function evaluateRecursively (value) {
  if (isFunction(value)) {
    return value(this)
  }

  return map(value, evaluateRecursively, this)
}

// Compiles a Handlebars email template with a front matter.
//
// Returns a function which when executed returns an object which can
// be used directly with Nodemailer.
export function compileMailTemplate (source) {
  const {
    attributes: mailTemplate = {},
    body
  } = frontMatter(source)

  mailTemplate.markdown = body

  compileRecursively(mailTemplate)

  return context => context::evaluateRecursively(mailTemplate)
}

// -------------------------------------------------------------------

export function createGlobMatcher (patterns) {
  const noneMustMatch = []
  const anyMustMatch = []

  forEach(patterns, pattern => {
    if (pattern[0] === '!') {
      noneMustMatch.push(createSingleGlobaMatcher(pattern.slice(1)))
    } else {
      anyMustMatch.push(createSingleGlobaMatcher(pattern))
    }
  })

  const n = noneMustMatch.length
  const m = anyMustMatch.length

  return entry => {
    for (let i = 0; i < n; ++i) {
      if (noneMustMatch[i](entry)) {
        return false
      }
    }

    for (let i = 0; i < m; ++i) {
      if (anyMustMatch[i](entry)) {
        return true
      }
    }

    return false
  }
}

// -------------------------------------------------------------------

const markdownCompiler = nodemailerMarkdown({
  useEmbeddedImages: true
})

const sendMailStub = promisify((() => {
  const transport = nodemailer.createTransport(nodemailerStubTransport())
  transport.use('compile', markdownCompiler)

  return ::transport.sendMail
})())

export function createMailer ({ transport: transportConfig, ...config }) {
  const transport = nodemailer.createTransport(transportConfig)
  transport.use('compile', markdownCompiler)

  const sendMail = promisify(::transport.sendMail)

  return (data, noTest = false) => {
    data = { ...config, ...data }

    return noTest
      ? sendMail(data)
      : sendMailStub(data)
  }
}

// -------------------------------------------------------------------

// Returns the value of a property and removes it from the object.
export function extractProperty (obj, prop) {
  const value = obj[prop]
  delete obj[prop]
  return value
}

// -------------------------------------------------------------------

// Special value which can be returned to stop an iteration in map().
export const DONE = {}

// Fill `target` by running each element in `collection` through
// `iteratee`.
//
// If `target` is undefined, it defaults to a new array if
// `collection` is array-like (has a `length` property), otherwise an
// object.
//
// The context of `iteratee` can be specified via `thisArg`.
//
// Note: the Mapping can be interrupted by returning the special value
// `DONE` provided as the fourth argument.
//
// Usage: collection::map(item => item + 1)
export function map (
  collection,
  iteratee,
  thisArg,
  target = 'length' in collection ? [] : {}
) {
  forEach(collection, (item, i) => {
    const value = iteratee.call(thisArg, item, i, collection, DONE)
    if (value === DONE) {
      return false
    }

    target[i] = value
  })

  return target
}

export function mapToArray (
  collection,
  iteratee,
  thisArg
) {
  const target = []

  forEach(collection, (item, i) => {
    const value = iteratee.call(thisArg, item, i, collection, DONE)
    if (value === DONE) {
      return false
    }

    target.push(value)
  })

  return target
}

export const mapInPlace = (
  collection,
  iteratee,
  thisArg
) => map(collection, iteratee, thisArg, collection)

// -------------------------------------------------------------------

export function parsePlayers (json) {
  const data = parseJson(String(json))

  const players = {}
  ;(function loop (player) {
    if (isArray(player)) {
      return forEach(player, loop, this)
    }

    player.displayName = player.disambiguation
      ? `${player.name} (${player.disambiguation})`
      : player.name

    players[player.id] = player
  }).call(this, data)

  return players
}

// -------------------------------------------------------------------

export function promisify (fn) {
  return pify(fn, Promise)
}

// -------------------------------------------------------------------

// Fisher-Yates shuffle.
// http://bost.ocks.org/mike/shuffle/
export function shuffleArray (array) {
  let n = array.length
  let i, tmp

  while (n) {
    i = Math.floor(Math.random() * n--)

    tmp = array[n]
    array[n] = array[i]
    array[i] = tmp
  }
}
