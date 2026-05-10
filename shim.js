/* global __DEV__, localStorage */
import 'text-encoding';
if (typeof Buffer === 'undefined') global.Buffer = require('buffer').Buffer;

// Hermes lacks the Node-Buffer extras that some libs rely on. Add the minimal
// surface our deps reach for so PQ signing in `@neuraiproject/neurai-sign-transaction`
// works (it compares prevout commitments via `Uint8Array.equals(...)`, which
// only exists on Node Buffers, not on plain typed arrays).
{
  const NodeBuffer = global.Buffer;
  const PATCHED = Symbol.for('NeuraiWallet.uint8ArrayPolyfilled');
  if (typeof Uint8Array !== 'undefined' && !Uint8Array.prototype[PATCHED]) {
    if (typeof Uint8Array.prototype.equals !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'equals', {
        configurable: true,
        writable: true,
        value: function equalsPolyfill(other) {
          if (this === other) return true;
          if (!other || other.length !== this.length) return false;
          for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
          return true;
        },
      });
    }
    Uint8Array.prototype[PATCHED] = true;
  }
  if (NodeBuffer && NodeBuffer.prototype) {
    const baseSubarray = Uint8Array.prototype.subarray;
    NodeBuffer.prototype.subarray = function patchedSubarray(begin, end) {
      const slice = baseSubarray.call(this, begin, end);
      return NodeBuffer.from(slice.buffer, slice.byteOffset, slice.byteLength);
    };
  }
}
if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
if (typeof process === 'undefined') {
  global.process = {};
}

process.browser = false;
process.version = '0.0.0';

// Minimalistic process.nextTick implementation
process.nextTick = function (callback, ...args) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }

  // Use setImmediate if available (better than setTimeout), otherwise fallback to setTimeout
  if (typeof setImmediate !== 'undefined') {
    setImmediate(() => callback(...args));
  } else {
    setTimeout(() => callback(...args), 0);
  }
};

// global.location = global.location || { port: 80 }
const isDev = typeof __DEV__ === 'boolean' && __DEV__;
process.env.NODE_ENV = isDev ? 'development' : 'production';
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}

// If using the crypto shim, uncomment the following line to ensure
// crypto is loaded first, so it can populate global.crypto
require('crypto');
