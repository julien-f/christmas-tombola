import frontMatter from 'front-matter'
import nodemailer from 'nodemailer'
import nodemailerStubTransport from 'nodemailer-stub-transport'
import { compile as handlebars } from 'handlebars'
import { markdown as nodemailerMarkdown } from 'nodemailer-markdown'
import { matcher as createSingleGlobaMatcher } from 'micromatch'
import { parse as parseJson } from 'json5'
import { promisify } from 'promise-toolbox'
import {
  forEach,
  isArray,
  isFunction,
  isString
} from 'lodash'

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

  return context => evaluateRecursively.call(context, mailTemplate)
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

    if (m === 0) {
      return true
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

const sendMailStub = (() => {
  const transport = nodemailer.createTransport(nodemailerStubTransport())
  transport.use('compile', markdownCompiler)

  return promisify(transport.sendMail, transport)
})()

export function createMailer ({ transport: transportConfig, ...config }) {
  const transport = nodemailer.createTransport(transportConfig)
  transport.use('compile', markdownCompiler)

  const sendMail = promisify(transport.sendMail, transport)

  return (data, noTest = false) => {
    data = { ...config, ...data }

    return noTest
      ? sendMail(data)
      : sendMailStub(data)
  }
}

// -------------------------------------------------------------------

export function draw (_items) {
  const todo = []
  const candidates = []
  forEach(_items, item => {
    todo.push(item)
    candidates.push(item)
  })

  shuffleArray(candidates)

  function drawItem (blacklist) {
    const { length } = candidates

    for (let i = 0; i < length; ++i) {
      const candidate = candidates[i]

      if (!blacklist.has(candidate.id)) {
        // Remove the selected candidate.
        const newLength = length - 1
        candidates[i] = candidates[newLength]
        candidates.length = newLength

        return candidate
      }
    }

    throw new Error('could not find a suitable candidate')
  }

  const lottery = { __proto__: null }

  while (todo.length) {
    // Sort by ascending blacklist size.
    todo.sort((a, b) => a._blacklist.size - b._blacklist.size)

    // Take the last one.
    const item = todo.pop()

    // The target cannot draw item.
    const target = drawItem(item._blacklist)
    target._blacklist.add(item.id)

    lottery[item.id] = target.id
  }

  return lottery
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

export const noop = () => {}

// -------------------------------------------------------------------

const _makeBlacklist = (parent = null) => ({
  __proto__: parent,
  _size: 0,

  get size () {
    return parent
      ? this._size + parent._size
      : this._size
  },

  add (id) {
    this[id] = true
    ++this._size
  },

  has (id) {
    return (id in this)
  }
})

function _parsePlayer (player) {
  if (isArray(player)) {
    return forEach(player, _parsePlayer, {
      __proto__: this,
      blacklist: _makeBlacklist(this.blacklist)
    })
  }

  if (player.participate === false) {
    return
  }

  Object.defineProperty(player, '_blacklist', {
    value: _makeBlacklist(this.blacklist)
  })
  player.displayName = player.disambiguation
    ? `${player.name} (${player.disambiguation})`
    : player.name

  const { id } = player

  // Registers the player
  this.players[id] = player

  // Update the common blacklist if any otherwise just the player one.
  if (this.blacklist) {
    this.blacklist.add(id)
  } else {
    player._blacklist.add(id)
  }
}

export const parsePlayers = json => {
  const players = { __proto__: null }

  forEach(parseJson(String(json)), _parsePlayer, {
    blacklist: null,
    players
  })

  return players
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
