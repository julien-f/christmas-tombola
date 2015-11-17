Error.stackTraceLimit = Infinity

try { require('trace') } catch (_) {}
try { require('clarify') } catch (_) {}

try {
  var RE = /\b(?:babel-runtime|bluebird|core-js)\b/

  require('stack-chain').filter.attach(function (_, frames) {
    var filtered = frames.filter(function (frame) {
      var name = frame && frame.getFileName()

      return (
        name &&

        !RE.test(name)
      )
    })

    // depd (used amongst other by express requires at least 3 frames
    // in the stack.
    return filtered.length > 2
      ? filtered
      : frames
  })
} catch (_) {}

try { require('source-map-support/register') } catch (_) {}
