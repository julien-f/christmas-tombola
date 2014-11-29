'use strict';

//====================================================================

var forEach = require('lodash.foreach');
var frontMatter = require('front-matter');
var handlebars = require('handlebars');
var isFunction = require('lodash.isfunction');
var isString = require('lodash.isstring');
var mapValues = require('lodash.mapvalues');

//====================================================================

function evaluateEntry(entry) {
  /* jshint validthis: true */

  return isFunction(entry) ?
    entry(this) :
    mapValues(entry, evaluateEntry, this)
  ;
}

function parseMessage(data) {
  data = frontMatter(String(data));

  // Change to expected format.
  if (data.attributes) {
    if (data.attributes.markdown === false) {
      data.attributes.text = data.body;
      delete data.attributes.markdown;
    } else {
      data.attributes.markdown = data.body;
    }
    data = data.attributes;
  } else {
    data = { markdown: data.body };
  }

  forEach(data, function compileTemplate(tpl, key, col) {
    if (!isString(tpl)) {
      forEach(tpl, compileTemplate);
    } else {
      col[key] = handlebars.compile(tpl);
    }
  });

  return function (context) {
    /* jshint validthis: true */

    return evaluateEntry.call(context, data);
  };
}
exports = module.exports = parseMessage;
