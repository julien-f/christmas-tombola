'use strict';

//====================================================================

// Faster `Function.bind()`.
function bind(fn, ctx) {
  return function bindedFunction() {
    return fn.apply(ctx, arguments);
  };
}

function noop() {}

//====================================================================

module.exports = function readStream(stream, cb) {
  var bufs = [];
  var len = 0;

  var removeListener = stream.removeListener ?
    bind(stream.removeListener, stream) :
    noop
  ;

  function clean() {
    removeListener('data', onData);
    removeListener('end', onEnd);
    removeListener('error', onError);
  }

  function onData(chunk) {
    bufs.push(chunk);
    len += chunk.length;
  }
  stream.on('data', onData);

  function onEnd() {
    clean();

    cb(null, Buffer.concat(bufs, len));
  }
  stream.on('end', onEnd);

  function onError(error) {
    clean();

    cb(error);
  }
  stream.on('error', onError);
};
