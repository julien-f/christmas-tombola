import assign from 'lodash.assign'
import forEach from 'lodash.foreach'
import frontMatter from 'front-matter'
import isFunction from 'lodash.isfunction'
import isString from 'lodash.isstring'
import nodemailer from 'nodemailer'
import nodemailerStubTransport from 'nodemailer-stub-transport'
import pify from 'pify'
import { compile as handlebars } from 'handlebars'

// ===================================================================

function compileRecursively (template) {
  if (isString(template)) {
    return handlebars(template)
  }

  return template::map(compileRecursively, null, template)
}

function evaluateRecursively (value) {
  if (!isFunction(value)) {
    return value
  }

  return value::map(evaluateRecursively, this)
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

  return context => context::evaluate(mailTemplate)
}

// -------------------------------------------------------------------

const sendMailStub = promisify(::nodemailerStubTransport().sendMail)

export function createMailer (config) {
  const sendMail = promisify(
    ::nodemailer.createTransport(
      extractProperty(config, 'transport')
    ).sendMail
  )

  return (data, noTest = false) => {
    data = assign({}, config, data)

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

// Fill `target` by running each element in `this` through
// `iteratee`.
//
// If `target` is undefined, it defaults to a new array if
// `this` is array-like (has a `length` property), otherwise an
// object.
//
// The context of `iteratee` can be specified via `thisArg`.
//
// Note: the Mapping can be interrupted by returning the special value
// `DONE` provided as the fourth argument.
//
// Usage: collection::map(item => item + 1)
export function map (
  iteratee,
  thisArg,
  target = 'length' in this ? [] : {}
) {
  forEach(this, (item, i) => {
    const value = iteratee.call(thisArg, item, i, this, DONE)
    if (value === DONE) {
      return false
    }

    target[i] = value
  })

  return target
}

// -------------------------------------------------------------------

export function parsePlayers (json) {
  throw new Error('TODO')
}

// -------------------------------------------------------------------

export function promisify (fn) {
  return pify(fn, Promise)
}
