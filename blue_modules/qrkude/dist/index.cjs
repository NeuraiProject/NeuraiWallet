/*! @kudelink/qrkude 0.1.0 | Copyright 2026 The QRKude Authors | SPDX-License-Identifier: Apache-2.0 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CanvasPathSink: () => CanvasPathSink,
  ECC_LEVELS: () => ECC_LEVELS,
  EYE_SHAPES: () => EYE_SHAPES,
  LAYERS: () => LAYERS,
  LINT_FLAGS: () => LINT_FLAGS,
  LINT_MESSAGES: () => LINT_MESSAGES,
  LOGO_SHAPES: () => LOGO_SHAPES,
  MAX_LENGTH: () => MAX_LENGTH,
  MODULE_SHAPES: () => MODULE_SHAPES,
  QRCode: () => QRCode,
  QRKudeError: () => QRKudeError,
  SvgPathWriter: () => SvgPathWriter,
  TRANSPARENT: () => TRANSPARENT,
  VERSION: () => VERSION,
  alignmentPositions: () => alignmentPositions,
  ballShape: () => ballShape,
  cloneStyle: () => cloneStyle,
  colorAlpha: () => colorAlpha,
  colorHex: () => colorHex,
  cssColor: () => cssColor,
  defaultStyle: () => defaultStyle,
  email: () => email,
  emitLayer: () => emitLayer,
  encode: () => encode,
  encodeForStyle: () => encodeForStyle,
  escapeXml: () => escapeXml,
  event: () => event,
  formatColor: () => formatColor,
  formatNumber: () => formatNumber,
  generate: () => generate,
  geo: () => geo,
  getLayout: () => getLayout,
  gradientGeometry: () => gradientGeometry,
  isGradient: () => isGradient,
  layerPaint: () => layerPaint,
  layerToCanvasPath: () => layerToCanvasPath,
  layerVisible: () => layerVisible,
  linearPaint: () => linearPaint,
  lint: () => lint,
  loadImage: () => loadImage,
  logoDamage: () => logoDamage,
  parseColor: () => parseColor,
  parseDocument: () => parseDocument,
  parseStyle: () => parseStyle,
  radialPaint: () => radialPaint,
  recommendedEcc: () => recommendedEcc,
  renderToCanvas: () => renderToCanvas,
  rgba: () => rgba,
  sanitizeIdPrefix: () => sanitizeIdPrefix,
  sms: () => sms,
  solidPaint: () => solidPaint,
  styleToJson: () => styleToJson,
  svg: () => svg,
  tel: () => tel,
  toBlob: () => toBlob,
  toDataURL: () => toDataURL,
  toSvg: () => toSvg,
  utf8: () => utf8,
  vcard: () => vcard,
  wifi: () => wifi
});
module.exports = __toCommonJS(index_exports);

// src/encode.ts
var KINDS = {
  parse: "parse error",
  "invalid-argument": "invalid argument",
  "data-too-long": "data too long"
};
var QRKudeError = class _QRKudeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QRKudeError";
    this.code = code;
    this.kind = KINDS[code];
    Object.setPrototypeOf(this, _QRKudeError.prototype);
  }
};
var MAX_PAYLOAD_CHARS = 7089;
var ECC_LEVELS = ["L", "M", "Q", "H"];
var MODE_BITS = { numeric: 1, alphanumeric: 2, byte: 4 };
var ECC_CODEWORDS_PER_BLOCK = [
  [
    -1,
    7,
    10,
    15,
    20,
    26,
    18,
    20,
    24,
    30,
    18,
    20,
    24,
    26,
    30,
    22,
    24,
    28,
    30,
    28,
    28,
    28,
    28,
    30,
    30,
    26,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ],
  [
    -1,
    10,
    16,
    26,
    18,
    24,
    16,
    18,
    22,
    22,
    26,
    30,
    22,
    22,
    24,
    24,
    28,
    28,
    26,
    26,
    26,
    26,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28,
    28
  ],
  [
    -1,
    13,
    22,
    18,
    26,
    18,
    24,
    18,
    22,
    20,
    24,
    28,
    26,
    24,
    20,
    30,
    24,
    28,
    28,
    26,
    30,
    28,
    30,
    30,
    30,
    30,
    28,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ],
  [
    -1,
    17,
    28,
    22,
    16,
    22,
    28,
    26,
    26,
    24,
    28,
    24,
    28,
    22,
    24,
    24,
    30,
    28,
    28,
    26,
    28,
    30,
    24,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30,
    30
  ]
];
var NUM_ECC_BLOCKS = [
  [
    -1,
    1,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    4,
    4,
    4,
    4,
    4,
    6,
    6,
    6,
    6,
    7,
    8,
    8,
    9,
    9,
    10,
    12,
    12,
    12,
    13,
    14,
    15,
    16,
    17,
    18,
    19,
    19,
    20,
    21,
    22,
    24,
    25
  ],
  [
    -1,
    1,
    1,
    1,
    2,
    2,
    4,
    4,
    4,
    5,
    5,
    5,
    8,
    9,
    9,
    10,
    10,
    11,
    13,
    14,
    16,
    17,
    17,
    18,
    20,
    21,
    23,
    25,
    26,
    28,
    29,
    31,
    33,
    35,
    37,
    38,
    40,
    43,
    45,
    47,
    49
  ],
  [
    -1,
    1,
    1,
    2,
    2,
    4,
    4,
    6,
    6,
    8,
    8,
    8,
    10,
    12,
    16,
    12,
    17,
    16,
    18,
    21,
    20,
    23,
    23,
    25,
    27,
    29,
    34,
    34,
    35,
    38,
    40,
    43,
    45,
    48,
    51,
    53,
    56,
    59,
    62,
    65,
    68
  ],
  [
    -1,
    1,
    1,
    2,
    4,
    4,
    4,
    5,
    6,
    8,
    8,
    11,
    11,
    16,
    16,
    18,
    16,
    19,
    21,
    25,
    25,
    25,
    34,
    30,
    32,
    35,
    37,
    40,
    42,
    45,
    48,
    51,
    54,
    57,
    60,
    63,
    66,
    70,
    74,
    77,
    81
  ]
];
var ECC_FORMAT_BITS = [1, 0, 3, 2];
var ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
var QRCode = class {
  constructor(version, ecc, mask, mode, modules) {
    this.version = version;
    this.size = version * 4 + 17;
    this.ecc = ecc;
    this.mask = mask;
    this.mode = mode;
    this.modules = modules;
  }
  /** true = dark module. Out-of-range coordinates return false. */
  isDark(x, y) {
    const n = this.size;
    if (x < 0 || y < 0 || x >= n || y >= n) return false;
    return this.modules[y * n + x] === 1;
  }
  /** Rows of booleans (true = dark). */
  toMatrix() {
    const rows = [];
    for (let y = 0; y < this.size; y++) {
      const row = [];
      for (let x = 0; x < this.size; x++) row.push(this.modules[y * this.size + x] === 1);
      rows.push(row);
    }
    return rows;
  }
};
function eccIndex(ecc) {
  return ECC_LEVELS.indexOf(ecc);
}
function eccCodewordsPerBlock(ecc, version) {
  return ECC_CODEWORDS_PER_BLOCK[ecc][version];
}
function numEccBlocks(ecc, version) {
  return NUM_ECC_BLOCKS[ecc][version];
}
function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
function rawCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}
function dataCodewords(ver, ecc) {
  return rawCodewords(ver) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ECC_BLOCKS[ecc][ver];
}
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const out = new Array(numAlign);
  for (let i = numAlign - 1, pos = ver * 4 + 10; i >= 1; i--, pos -= step) out[i] = pos;
  out[0] = 6;
  return out;
}
function isFunctionModuleSlow(ver, x, y, align) {
  const size = ver * 4 + 17;
  if (x <= 8 && y <= 8) return true;
  if (x >= size - 8 && y <= 8) return true;
  if (x <= 8 && y >= size - 8) return true;
  if (x === 6 || y === 6) return true;
  if (ver >= 7) {
    if (x >= size - 11 && x < size - 8 && y < 6) return true;
    if (y >= size - 11 && y < size - 8 && x < 6) return true;
  }
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0) continue;
      const dx = x - align[j];
      const dy = y - align[i];
      if (dx >= -2 && dx <= 2 && dy >= -2 && dy <= 2) return true;
    }
  }
  return false;
}
var functionMaps = [];
function functionMap(ver) {
  let map = functionMaps[ver];
  if (!map) {
    const size = ver * 4 + 17;
    const align = alignmentPositions(ver);
    map = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) map[y * size + x] = isFunctionModuleSlow(ver, x, y, align) ? 1 : 0;
    functionMaps[ver] = map;
  }
  return map;
}
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1 ^ (z >>> 7) * 285) & 511;
    z ^= (y >>> i & 1) * x;
  }
  return z & 255;
}
function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}
function rsRemainder(data, start, len, divisor) {
  const degree = divisor.length;
  const result = new Uint8Array(degree);
  for (let i = 0; i < len; i++) {
    const factor = data[start + i] ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let j = 0; j < degree; j++) result[j] ^= gfMul(divisor[j], factor);
  }
  return result;
}
function alnumIndex(c) {
  return c ? ALPHANUMERIC_CHARSET.indexOf(String.fromCharCode(c)) : -1;
}
function detectMode(data) {
  let numeric = true;
  let alnum = true;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c < 48 || c > 57) numeric = false;
    if (c >= 128 || alnumIndex(c) < 0) alnum = false;
  }
  if (numeric) return "numeric";
  if (alnum) return "alphanumeric";
  return "byte";
}
function charCountBits(mode, ver) {
  const i = Math.floor((ver + 7) / 17);
  if (mode === "numeric") return [10, 12, 14][i];
  if (mode === "alphanumeric") return [9, 11, 13][i];
  return [8, 16, 16][i];
}
function payloadBits(mode, len) {
  if (mode === "numeric") return Math.floor(len / 3) * 10 + [0, 4, 7][len % 3];
  if (mode === "alphanumeric") return Math.floor(len / 2) * 11 + len % 2 * 6;
  return len * 8;
}
function totalBits(mode, len, eci, ver) {
  let bits = eci ? 12 : 0;
  if (len > 0) {
    const ccb = charCountBits(mode, ver);
    if (len >= 1 << ccb) return -1;
    bits += 4 + ccb + payloadBits(mode, len);
  }
  return bits;
}
var BitBuffer = class {
  constructor(buf) {
    this.buf = buf;
    this.bits = 0;
  }
  append(value, n) {
    for (let i = n - 1; i >= 0; i--, this.bits++) {
      if (value >>> i & 1) this.buf[this.bits >> 3] |= 128 >> (this.bits & 7);
    }
  }
};
var Matrix = class {
  constructor(size) {
    this.size = size;
    this.m = new Uint8Array(size * size);
  }
  set(x, y, dark) {
    this.m[y * this.size + x] = dark ? 1 : 0;
  }
  setChecked(x, y, dark) {
    if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.set(x, y, dark);
  }
};
function drawFormatBits(qr, ecc, mask) {
  const data = ECC_FORMAT_BITS[ecc] << 3 | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = rem << 1 ^ (rem >>> 9) * 1335;
  const bits = (data << 10 | rem) ^ 21522;
  const size = qr.size;
  for (let i = 0; i <= 5; i++) qr.set(8, i, bits >>> i & 1);
  qr.set(8, 7, bits >>> 6 & 1);
  qr.set(8, 8, bits >>> 7 & 1);
  qr.set(7, 8, bits >>> 8 & 1);
  for (let i = 9; i < 15; i++) qr.set(14 - i, 8, bits >>> i & 1);
  for (let i = 0; i < 8; i++) qr.set(size - 1 - i, 8, bits >>> i & 1);
  for (let i = 8; i < 15; i++) qr.set(8, size - 15 + i, bits >>> i & 1);
  qr.set(8, size - 8, true);
}
function drawFinder(qr, cx, cy) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      qr.setChecked(cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  }
}
function drawFunctionPatterns(qr, ver, ecc) {
  const size = qr.size;
  for (let i = 0; i < size; i++) {
    qr.set(6, i, i % 2 === 0);
    qr.set(i, 6, i % 2 === 0);
  }
  drawFinder(qr, 3, 3);
  drawFinder(qr, size - 4, 3);
  drawFinder(qr, 3, size - 4);
  const pos = alignmentPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          qr.set(pos[j] + dx, pos[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  drawFormatBits(qr, ecc, 0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = rem << 1 ^ (rem >>> 11) * 7973;
    const bits = ver << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i & 1) === 1;
      const a = size - 11 + i % 3;
      const b = Math.floor(i / 3);
      qr.set(a, b, bit);
      qr.set(b, a, bit);
    }
  }
}
function placeCodewords(qr, fmap, data) {
  const size = qr.size;
  const total = data.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = (right + 1 & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fmap[y * size + x] && i < total) {
          qr.set(x, y, data[i >> 3] >>> 7 - (i & 7) & 1);
          i++;
        }
      }
    }
  }
}
function maskBit(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return x * y % 2 + x * y % 3 === 0;
    case 6:
      return (x * y % 2 + x * y % 3) % 2 === 0;
    default:
      return ((x + y) % 2 + x * y % 3) % 2 === 0;
  }
}
function applyMask(qr, mask, fmap) {
  const size = qr.size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      if (!fmap[index] && maskBit(mask, x, y)) qr.m[index] ^= 1;
    }
}
function runHistoryAdd(run, history, size) {
  if (history[0] === 0) run += size;
  for (let i = 6; i > 0; i--) history[i] = history[i - 1];
  history[0] = run;
}
function finderLikeCount(h) {
  const n = h[1];
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
}
function finderTerminate(color, run, history, size) {
  if (color) {
    runHistoryAdd(run, history, size);
    run = 0;
  }
  run += size;
  runHistoryAdd(run, history, size);
  return finderLikeCount(history);
}
function penaltyScore(qr) {
  const size = qr.size;
  const m = qr.m;
  let result = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const dark2 = (pass === 0 ? m[a * size + b] : m[b * size + a]) === 1;
        if (dark2 === color) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else {
          runHistoryAdd(run, history, size);
          if (!color) result += finderLikeCount(history) * 40;
          color = dark2;
          run = 1;
        }
      }
      result += finderTerminate(color, run, history, size) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y * size + x];
      if (c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1])
        result += 3;
    }
  let dark = 0;
  for (let i = 0; i < size * size; i++) dark += m[i];
  const total = size * size;
  let diff = dark * 20 - total * 10;
  if (diff < 0) diff = -diff;
  const k = Math.floor((diff + total - 1) / total) - 1;
  result += k * 10;
  return result;
}
function utf8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 55296 && cp <= 56319 && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 56320 && lo <= 57343) {
        cp = 65536 + (cp - 55296 << 10) + (lo - 56320);
        i++;
      } else {
        cp = 65533;
      }
    } else if (cp >= 55296 && cp <= 57343) {
      cp = 65533;
    }
    if (cp < 128) out.push(cp);
    else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
    else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
    else
      out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
  }
  return new Uint8Array(out);
}
function intOption(value, def, name) {
  if (value === void 0 || value === null) return def;
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new QRKudeError("invalid-argument", `invalid argument: ${name} must be an integer`);
  return value;
}
function encode(data, options = {}) {
  if (typeof data !== "string" && !(data && typeof data.length === "number"))
    throw new QRKudeError("invalid-argument", "invalid argument: data must be a string or bytes");
  options = options || {};
  const eccName = options.ecc === void 0 || options.ecc === null ? "M" : options.ecc;
  const minEcc = ECC_LEVELS.indexOf(eccName);
  const minVersion = intOption(options.minVersion, 1, "minVersion");
  const maxVersion = intOption(options.maxVersion, 40, "maxVersion");
  const forcedMask = intOption(options.mask, -1, "mask");
  const boostEcc = options.boostEcc === void 0 || options.boostEcc === null ? true : !!options.boostEcc;
  const eci = !!options.eci;
  if (minEcc < 0 || minVersion < 1 || maxVersion > 40 || minVersion > maxVersion || forcedMask < -1 || forcedMask > 7)
    throw new QRKudeError("invalid-argument", "invalid argument");
  if (data.length > MAX_PAYLOAD_CHARS) throw new QRKudeError("data-too-long", "data too long");
  const bytes = typeof data === "string" ? utf8(data) : data instanceof Uint8Array ? data : Uint8Array.from(data);
  const len = bytes.length;
  const mode = detectMode(bytes);
  let ver = 0;
  let used = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    const bits = totalBits(mode, len, eci, v);
    if (bits >= 0 && bits <= dataCodewords(v, minEcc) * 8) {
      ver = v;
      used = bits;
      break;
    }
  }
  if (ver === 0) throw new QRKudeError("data-too-long", "data too long");
  let ecc = minEcc;
  if (boostEcc) {
    for (let e = ecc + 1; e <= 3; e++) if (used <= dataCodewords(ver, e) * 8) ecc = e;
  }
  const dataLen = dataCodewords(ver, ecc);
  const raw = rawCodewords(ver);
  const bb = new BitBuffer(new Uint8Array(raw));
  if (eci) {
    bb.append(7, 4);
    bb.append(26, 8);
  }
  if (len > 0) {
    bb.append(MODE_BITS[mode], 4);
    bb.append(len, charCountBits(mode, ver));
    if (mode === "numeric") {
      let i = 0;
      for (; i + 3 <= len; i += 3)
        bb.append((bytes[i] - 48) * 100 + (bytes[i + 1] - 48) * 10 + (bytes[i + 2] - 48), 10);
      if (len - i === 2) bb.append((bytes[i] - 48) * 10 + (bytes[i + 1] - 48), 7);
      else if (len - i === 1) bb.append(bytes[i] - 48, 4);
    } else if (mode === "alphanumeric") {
      let i = 0;
      for (; i + 2 <= len; i += 2) bb.append(alnumIndex(bytes[i]) * 45 + alnumIndex(bytes[i + 1]), 11);
      if (i < len) bb.append(alnumIndex(bytes[i]), 6);
    } else {
      for (let i = 0; i < len; i++) bb.append(bytes[i], 8);
    }
  }
  const capacity = dataLen * 8;
  const term = capacity - bb.bits;
  bb.append(0, term < 4 ? term : 4);
  bb.append(0, (8 - bb.bits % 8) % 8);
  for (let pad = 236; bb.bits < capacity; pad ^= 236 ^ 17) bb.append(pad, 8);
  const dat = bb.buf;
  const numBlocks = NUM_ECC_BLOCKS[ecc][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][ver];
  const numShort = numBlocks - raw % numBlocks;
  const shortLen = Math.floor(raw / numBlocks) - blockEccLen;
  const divisor = rsDivisor(blockEccLen);
  const out = new Uint8Array(raw);
  let offset = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortLen + (i < numShort ? 0 : 1);
    const eccBuf = rsRemainder(dat, offset, datLen, divisor);
    for (let j = 0, k = i; j < datLen; j++, k += numBlocks) {
      if (j === shortLen) k -= numShort;
      out[k] = dat[offset + j];
    }
    for (let j = 0, k = dataLen + i; j < blockEccLen; j++, k += numBlocks) out[k] = eccBuf[j];
    offset += datLen;
  }
  const qr = new Matrix(ver * 4 + 17);
  const fmap = functionMap(ver);
  drawFunctionPatterns(qr, ver, ecc);
  placeCodewords(qr, fmap, out);
  let mask = forcedMask;
  if (mask < 0) {
    let best = -1;
    for (let m = 0; m < 8; m++) {
      applyMask(qr, m, fmap);
      drawFormatBits(qr, ecc, m);
      const p = penaltyScore(qr);
      if (best < 0 || p < best) {
        best = p;
        mask = m;
      }
      applyMask(qr, m, fmap);
    }
  }
  applyMask(qr, mask, fmap);
  drawFormatBits(qr, ecc, mask);
  return new QRCode(ver, ECC_LEVELS[ecc], mask, mode, qr.m);
}

// src/json.ts
var JsonObject = class {
  constructor(entries) {
    this.entries = entries;
  }
};
var MAX_DEPTH = 64;
var MAX_NUMBER_LENGTH = 400;
function parseError(message) {
  return new QRKudeError("parse", `parse error: ${message}`);
}
function cutNul(s) {
  const z = s.indexOf("\0");
  if (z >= 0) s = s.slice(0, z);
  return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\uFFFD");
}
function isDigit(s, i) {
  const c = s.charCodeAt(i);
  return c >= 48 && c <= 57;
}
var Reader = class {
  constructor(s) {
    this.s = s;
    this.pos = 0;
  }
  ws() {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      this.pos++;
    }
  }
  peek() {
    this.ws();
    return this.pos < this.s.length ? this.s[this.pos] : "";
  }
  eat(c) {
    if (this.peek() === c) {
      this.pos++;
      return true;
    }
    return false;
  }
  literal(lit) {
    this.ws();
    if (this.s.startsWith(lit, this.pos)) {
      this.pos += lit.length;
      return true;
    }
    return false;
  }
  hex4() {
    if (this.pos + 4 > this.s.length) throw parseError("bad \\u escape");
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const h = parseInt(this.s[this.pos++], 16);
      if (Number.isNaN(h)) throw parseError("bad \\u escape");
      v = v << 4 | h;
    }
    return v;
  }
  string() {
    if (!this.eat('"')) throw parseError(`string expected at ${this.pos}`);
    const s = this.s;
    let out = "";
    let run = this.pos;
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos);
      if (c !== 34 && c !== 92) {
        this.pos++;
        continue;
      }
      out += s.slice(run, this.pos);
      this.pos++;
      if (c === 34) return cutNul(out);
      if (this.pos >= s.length) break;
      const e = s[this.pos++];
      switch (e) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "	";
          break;
        case "r":
          out += "\r";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "u": {
          let cp = this.hex4();
          if (cp >= 55296 && cp < 56320) {
            let lo = 0;
            if (this.pos + 6 <= s.length && s[this.pos] === "\\" && s[this.pos + 1] === "u") {
              const hex = s.slice(this.pos + 2, this.pos + 6);
              const v = /^[0-9a-fA-F]{4}$/.test(hex) ? parseInt(hex, 16) : -1;
              if (v >= 56320 && v <= 57343) {
                lo = v;
                this.pos += 6;
              }
            }
            cp = lo ? 65536 + (cp - 55296 << 10) + (lo - 56320) : 65533;
          } else if (cp >= 56320 && cp <= 57343) {
            cp = 65533;
          }
          out += String.fromCodePoint(cp);
          break;
        }
        default:
          out += e;
          break;
      }
      run = this.pos;
    }
    throw parseError("unterminated string");
  }
  /* The token is rebuilt in canonical form and converted with Number(),
   * which rounds to the nearest double (as the reference reader does). */
  number() {
    this.ws();
    const s = this.s;
    const start = this.pos;
    let neg = false;
    if (this.pos < s.length && s[this.pos] === "-") {
      neg = true;
      this.pos++;
    }
    let p = this.pos;
    while (isDigit(s, this.pos)) this.pos++;
    const intPart = s.slice(p, this.pos);
    let fracPart = "";
    if (this.pos < s.length && s[this.pos] === ".") {
      this.pos++;
      p = this.pos;
      while (isDigit(s, this.pos)) this.pos++;
      fracPart = s.slice(p, this.pos);
    }
    if (!intPart && !fracPart) throw parseError(`number expected at ${start}`);
    let exp = "";
    if (this.pos < s.length && (s[this.pos] === "e" || s[this.pos] === "E")) {
      this.pos++;
      let sign = "+";
      if (this.pos < s.length && (s[this.pos] === "+" || s[this.pos] === "-")) sign = s[this.pos++];
      p = this.pos;
      while (isDigit(s, this.pos)) this.pos++;
      if (this.pos > p) exp = "e" + sign + s.slice(p, this.pos);
    }
    if (this.pos - start > MAX_NUMBER_LENGTH) throw parseError(`number longer than ${MAX_NUMBER_LENGTH} characters`);
    const v = Number((neg ? "-" : "") + (intPart || "0") + (fracPart ? "." + fracPart : "") + exp);
    if (!isFinite(v)) throw parseError("number is not finite");
    return v;
  }
  value(depth) {
    const c = this.peek();
    if (c === '"') return this.string();
    if (c === "{" || c === "[") {
      if (depth + 1 > MAX_DEPTH) throw parseError(`nesting deeper than ${MAX_DEPTH}`);
      this.pos++;
      if (c === "{") {
        const entries = [];
        if (this.eat("}")) return new JsonObject(entries);
        do {
          const key = this.string();
          if (!this.eat(":")) throw parseError(`':' expected at ${this.pos}`);
          entries.push([key, this.value(depth + 1)]);
        } while (this.eat(","));
        if (!this.eat("}")) throw parseError(`'}' expected at ${this.pos}`);
        return new JsonObject(entries);
      }
      const items = [];
      if (this.eat("]")) return items;
      do
        items.push(this.value(depth + 1));
      while (this.eat(","));
      if (!this.eat("]")) throw parseError(`']' expected at ${this.pos}`);
      return items;
    }
    if (this.literal("true")) return true;
    if (this.literal("false")) return false;
    if (this.literal("null")) return null;
    return this.number();
  }
};
function parseJson(text) {
  return new Reader(String(text)).value(0);
}
function fromPlain(v, depth = 0) {
  if (v === null || v === void 0) return null;
  if (typeof v === "number") {
    if (!isFinite(v)) throw parseError("number is not finite");
    return v;
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return cutNul(v);
  if (v instanceof JsonObject) return v;
  if (typeof v === "object") {
    if (depth + 1 > MAX_DEPTH) throw parseError(`nesting deeper than ${MAX_DEPTH}`);
    if (Array.isArray(v)) return v.map((item) => fromPlain(item, depth + 1));
    const entries = [];
    for (const key of Object.keys(v)) {
      const item = v[key];
      if (item !== void 0) entries.push([cutNul(key), fromPlain(item, depth + 1)]);
    }
    return new JsonObject(entries);
  }
  throw parseError(`unsupported value of type ${typeof v}`);
}

// src/style.ts
var MODULE_SHAPES = [
  "square",
  "dot",
  "rounded",
  "diamond",
  "star",
  "fluid",
  "liquid",
  "bevel",
  "classy",
  "hbars",
  "vbars"
];
var EYE_SHAPES = ["square", "rounded", "circle", "leaf", "drop", "bevel", "diamond", "dots"];
var LOGO_SHAPES = ["square", "rounded", "circle"];
var TRANSPARENT = 0;
function rgba(r, g, b, a = 255) {
  return ((r & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | a & 255) >>> 0;
}
function parseColor(str2) {
  if (str2 === "transparent") return TRANSPARENT;
  if (str2.length < 1 || str2[0] !== "#") return null;
  let v = 0;
  for (let i = 1; i < str2.length; i++) {
    const c = str2[i];
    const d = /[0-9a-fA-F]/.test(c) ? parseInt(c, 16) : -1;
    if (d < 0) return null;
    v = (v * 16 + d) % 4294967296;
  }
  switch (str2.length) {
    case 4:
      return rgba((v >> 8 & 15) * 17, (v >> 4 & 15) * 17, (v & 15) * 17);
    case 7:
      return v * 256 % 4294967296 + 255;
    case 9:
      return v >>> 0;
    default:
      return null;
  }
}
function hex2(v) {
  return (v < 16 ? "0" : "") + v.toString(16);
}
function colorHex(c) {
  return "#" + hex2(c >>> 24) + hex2(c >>> 16 & 255) + hex2(c >>> 8 & 255);
}
function formatColor(c) {
  const a = c & 255;
  return a === 255 ? colorHex(c) : colorHex(c) + hex2(a);
}
function colorAlpha(c) {
  return c & 255;
}
function solidPaint(color) {
  return { type: "solid", color };
}
function linearPaint(angle, from, to) {
  return { type: "linear", angle, cx: 0.5, cy: 0.5, r: 0.75, stops: [{ offset: 0, color: from }, { offset: 1, color: to }] };
}
function radialPaint(center, edge) {
  return { type: "radial", angle: 0, cx: 0.5, cy: 0.5, r: 0.75, stops: [{ offset: 0, color: center }, { offset: 1, color: edge }] };
}
function isGradient(p) {
  return p.type === "linear" || p.type === "radial";
}
function defaultStyle() {
  return {
    margin: 4,
    modules: { shape: "square", size: 1, roundness: 1, color: solidPaint(255) },
    eyes: { frame: "square", ball: "square", frameColor: { type: "none" }, ballColor: { type: "none" } },
    alignment: { frame: null, ball: null },
    background: { color: solidPaint(4294967295), radius: 0 },
    border: { width: 0, color: 255 },
    logo: { size: 0, margin: 1, shape: "square", excavate: true, background: TRANSPARENT, href: null },
    label: { text: null, font: "sans-serif", size: 4, color: 255, position: "bottom", bold: true }
  };
}
function cloneStyle(s) {
  const paint = (p) => isGradient(p) ? { ...p, stops: p.stops.map((st) => ({ ...st })) } : { ...p };
  return {
    margin: s.margin,
    modules: { ...s.modules, color: paint(s.modules.color) },
    eyes: { ...s.eyes, frameColor: paint(s.eyes.frameColor), ballColor: paint(s.eyes.ballColor) },
    alignment: { ...s.alignment },
    background: { ...s.background, color: paint(s.background.color) },
    border: { ...s.border },
    logo: { ...s.logo },
    label: { ...s.label }
  };
}
function recommendedEcc(style) {
  return style.logo.size > 0 ? "H" : "M";
}
function fail(what) {
  throw new QRKudeError("parse", `parse error: ${what}`);
}
function members(v, key) {
  if (!(v instanceof JsonObject)) fail(`"${key}" must be an object`);
  return v.entries;
}
function num(v, key) {
  if (typeof v !== "number") fail(`"${key}" must be a number`);
  return v;
}
function bool(v, key) {
  if (typeof v !== "boolean") fail(`"${key}" must be a boolean`);
  return v;
}
function str(v, key) {
  if (typeof v !== "string") fail(`"${key}" must be a string`);
  return v;
}
function strOrNull(v, key) {
  return v === null ? null : str(v, key);
}
function colorValue(v, key) {
  if (v === null) return TRANSPARENT;
  const c = parseColor(str(v, key));
  if (c === null) fail(`invalid color for "${key}"`);
  return c;
}
function paintValue(v, key) {
  if (v === null) return { type: "none" };
  if (typeof v === "string") return solidPaint(colorValue(v, key));
  const p = { type: "linear", angle: 0, cx: 0.5, cy: 0.5, r: 0.75, stops: [] };
  for (const [k, val] of members(v, key)) {
    if (k === "type") {
      const t = str(val, "type");
      if (t === "radial" || t === "linear") p.type = t;
      else fail(`unknown paint type "${t}"`);
    } else if (k === "angle") p.angle = num(val, k);
    else if (k === "cx") p.cx = num(val, k);
    else if (k === "cy") p.cy = num(val, k);
    else if (k === "r") p.r = num(val, k);
    else if (k === "stops") {
      if (!Array.isArray(val)) fail('"stops" must be an array');
      p.stops = [];
      for (const item of val) {
        const st = { offset: 0, color: TRANSPARENT };
        for (const [sk, sv] of members(item, "stop")) {
          if (sk === "offset") st.offset = num(sv, sk);
          else if (sk === "color") st.color = colorValue(sv, sk);
        }
        if (p.stops.length < 8) p.stops.push(st);
      }
    }
  }
  return p;
}
function moduleShape(v) {
  const name = str(v, "shape");
  if (MODULE_SHAPES.indexOf(name) < 0) fail(`unknown module shape "${name}"`);
  return name;
}
function eyeShape(v, key) {
  const name = str(v, key);
  if (EYE_SHAPES.indexOf(name) < 0) fail(`unknown eye shape "${name}"`);
  return name;
}
function readStyleKey(k, v, s) {
  switch (k) {
    case "margin":
      s.margin = num(v, k);
      return;
    case "modules":
      for (const [key, val] of members(v, k)) {
        if (key === "shape") s.modules.shape = moduleShape(val);
        else if (key === "size") s.modules.size = num(val, key);
        else if (key === "roundness") s.modules.roundness = num(val, key);
        else if (key === "color") s.modules.color = paintValue(val, key);
      }
      return;
    case "eyes":
      for (const [key, val] of members(v, k)) {
        if (key === "frame") s.eyes.frame = eyeShape(val, key);
        else if (key === "ball") s.eyes.ball = eyeShape(val, key);
        else if (key === "frameColor") s.eyes.frameColor = paintValue(val, key);
        else if (key === "ballColor") s.eyes.ballColor = paintValue(val, key);
      }
      return;
    case "alignment":
      if (v === null) {
        s.alignment.frame = s.alignment.ball = null;
        return;
      }
      for (const [key, val] of members(v, k)) {
        if (key === "frame") s.alignment.frame = val === null ? null : eyeShape(val, key);
        else if (key === "ball") s.alignment.ball = val === null ? null : eyeShape(val, key);
      }
      return;
    case "background":
      for (const [key, val] of members(v, k)) {
        if (key === "color") s.background.color = paintValue(val, key);
        else if (key === "radius") s.background.radius = num(val, key);
      }
      return;
    case "border":
      for (const [key, val] of members(v, k)) {
        if (key === "width") s.border.width = num(val, key);
        else if (key === "color") s.border.color = colorValue(val, key);
      }
      return;
    case "logo":
      if (v === null) {
        s.logo = defaultStyle().logo;
        return;
      }
      if (!(s.logo.size > 0)) s.logo.size = 0.2;
      for (const [key, val] of members(v, k)) {
        if (key === "href") s.logo.href = strOrNull(val, key);
        else if (key === "size") s.logo.size = num(val, key);
        else if (key === "margin") s.logo.margin = num(val, key);
        else if (key === "excavate") s.logo.excavate = bool(val, key);
        else if (key === "background") s.logo.background = colorValue(val, key);
        else if (key === "shape") {
          const name = str(val, key);
          if (LOGO_SHAPES.indexOf(name) < 0) fail(`unknown logo shape "${name}"`);
          s.logo.shape = name;
        }
      }
      return;
    case "label":
      if (v === null) {
        s.label = defaultStyle().label;
        return;
      }
      for (const [key, val] of members(v, k)) {
        if (key === "text") s.label.text = strOrNull(val, key);
        else if (key === "font") s.label.font = strOrNull(val, key);
        else if (key === "size") s.label.size = num(val, key);
        else if (key === "color") s.label.color = colorValue(val, key);
        else if (key === "bold") s.label.bold = bool(val, key);
        else if (key === "position") {
          const name = str(val, key);
          if (name !== "bottom" && name !== "top") fail(`unknown label position "${name}"`);
          s.label.position = name;
        }
      }
      return;
    default:
      return;
  }
}
function int(v, key) {
  const n = num(v, key);
  return Math.trunc(n < -1e3 ? -1e3 : n > 1e3 ? 1e3 : n);
}
function readEncode(v, e) {
  for (const [key, val] of members(v, "encode")) {
    if (key === "ecc") {
      const level = str(val, key);
      if (level !== "L" && level !== "M" && level !== "Q" && level !== "H") fail(`invalid ecc "${level}"`);
      e.ecc = level;
    } else if (key === "minVersion") e.minVersion = int(val, key);
    else if (key === "maxVersion") e.maxVersion = int(val, key);
    else if (key === "mask") e.mask = int(val, key);
    else if (key === "boostEcc") e.boostEcc = bool(val, key);
    else if (key === "eci") e.eci = bool(val, key);
  }
}
function readSvg(v, o) {
  for (const [key, val] of members(v, "svg")) {
    if (key === "width") o.width = num(val, key);
    else if (key === "idPrefix") o.idPrefix = strOrNull(val, key);
  }
}
function parseDocument(input) {
  const doc = { encode: {}, style: defaultStyle(), svg: {} };
  if (input === null || input === void 0) return doc;
  const root = typeof input === "string" ? parseJson(input) : fromPlain(input);
  for (const [key, val] of members(root, "document")) {
    if (key === "encode") readEncode(val, doc.encode);
    else if (key === "svg") readSvg(val, doc.svg);
    else if (key === "style") {
      for (const [k2, v2] of members(val, "style")) readStyleKey(k2, v2, doc.style);
    } else readStyleKey(key, val, doc.style);
  }
  return doc;
}
function parseStyle(input) {
  return parseDocument(input).style;
}
function paintToJson(p) {
  if (p.type === "none") return null;
  if (p.type === "solid") return formatColor(p.color);
  const stops = p.stops.map((s) => ({ offset: s.offset, color: formatColor(s.color) }));
  return p.type === "linear" ? { type: "linear", angle: p.angle, stops } : { type: "radial", cx: p.cx, cy: p.cy, r: p.r, stops };
}
function styleToJson(s) {
  const out = {
    margin: s.margin,
    modules: { shape: s.modules.shape, size: s.modules.size, roundness: s.modules.roundness, color: paintToJson(s.modules.color) },
    eyes: { frame: s.eyes.frame, ball: s.eyes.ball, frameColor: paintToJson(s.eyes.frameColor), ballColor: paintToJson(s.eyes.ballColor) },
    alignment: { frame: s.alignment.frame, ball: s.alignment.ball },
    background: { color: paintToJson(s.background.color), radius: s.background.radius },
    border: { width: s.border.width, color: formatColor(s.border.color) },
    logo: s.logo.size > 0 ? {
      href: s.logo.href,
      size: s.logo.size,
      margin: s.logo.margin,
      shape: s.logo.shape,
      excavate: s.logo.excavate,
      background: (s.logo.background & 255) === 0 ? null : formatColor(s.logo.background)
    } : null,
    label: s.label.text ? {
      text: s.label.text,
      font: s.label.font,
      size: s.label.size,
      color: formatColor(s.label.color),
      position: s.label.position,
      bold: s.label.bold
    } : null
  };
  return out;
}

// src/layout.ts
var LAYERS = ["background", "border", "modules", "eyeFrames", "eyeBalls", "logoBackground"];
var NONE = 0;
var ROUND = 1;
var CHAMFER = 2;
var TL = 0;
var TR = 1;
var BR = 2;
var BL = 3;
function corners(kind, a) {
  return [{ kind, a }, { kind, a }, { kind, a }, { kind, a }];
}
function crect(x0, y0, x1, y1, kind, a) {
  return { x0, y0, x1, y1, c: corners(kind, a) };
}
function clamp(v, lo, hi) {
  if (!(v >= lo)) return lo;
  return v > hi ? hi : v;
}
var MAX_LENGTH = 1e3;
var MODULE_INDEX = {};
MODULE_SHAPES.forEach((s, i) => MODULE_INDEX[s] = i);
var EYE_INDEX = {};
EYE_SHAPES.forEach((s, i) => EYE_INDEX[s] = i);
function validModuleShape(s) {
  return typeof s === "string" && s in MODULE_INDEX ? s : "square";
}
function validEyeShape(s) {
  return typeof s === "string" && s in EYE_INDEX ? s : null;
}
function ballShape(shape) {
  if (shape === "dots") return "circle";
  return validEyeShape(shape) || "square";
}
var LayoutContext = class _LayoutContext {
  constructor(code, style) {
    this.code = code;
    this.style = style;
    this.labelSize = 0;
    this.bandY = 0;
    this.bandH = 0;
    this.labelX = 0;
    this.labelBaseline = 0;
    this.excavate = false;
    this.logoCx = 0;
    this.logoCy = 0;
    this.logoHalf = 0;
    this.logoAreaHalf = 0;
    this.cells = null;
    const s = style;
    const n = this.n = code.size;
    this.margin = clamp(s.margin, 0, MAX_LENGTH);
    this.border = clamp(s.border.width, 0, MAX_LENGTH);
    this.shape = validModuleShape(s.modules.shape);
    this.size = clamp(s.modules.size, 0.1, 1);
    this.roundness = clamp(s.modules.roundness, 0, 1);
    const frame = this.margin + this.border;
    this.W = n + 2 * frame;
    let H = this.W;
    this.ox = frame;
    let oy = frame;
    this.hasLabel = !!s.label.text;
    if (this.hasLabel) {
      const f = clamp(s.label.size, 0.1, MAX_LENGTH);
      this.labelSize = f;
      this.bandH = f * 1.5;
      H += this.bandH;
      if (s.label.position === "top") {
        this.bandY = this.border;
        oy += this.bandH;
      } else {
        this.bandY = this.W - this.border;
      }
      this.labelX = this.W / 2;
      this.labelBaseline = this.bandY + f * 1.1;
    }
    this.H = H;
    this.oy = oy;
    const minSide = this.W < this.H ? this.W : this.H;
    this.bgRadius = clamp(s.background.radius, 0, minSide / 2);
    this.hasLogo = s.logo.size > 0;
    if (this.hasLogo) {
      this.excavate = !!s.logo.excavate;
      this.logoCx = this.ox + n / 2;
      this.logoCy = this.oy + n / 2;
      this.logoHalf = n * clamp(s.logo.size, 0, 1) / 2;
      this.logoAreaHalf = this.logoHalf + clamp(s.logo.margin, 0, MAX_LENGTH);
    }
    this.alignStyled = validEyeShape(s.alignment.frame) !== null;
    this.alignPos = this.alignStyled ? alignmentPositions(code.version) : [];
  }
  static isFinder(n, x, y) {
    return x < 7 && y < 7 || x >= n - 7 && y < 7 || x < 7 && y >= n - 7;
  }
  inStyledAlignment(x, y) {
    if (!this.alignStyled) return false;
    const pos = this.alignPos;
    const k = pos.length;
    for (let i = 0; i < k; i++) {
      const dy = y - pos[i];
      if (dy < -2 || dy > 2) continue;
      for (let j = 0; j < k; j++) {
        const dx = x - pos[j];
        if (dx >= -2 && dx <= 2 && isAlignmentCenter(k, i, j)) return true;
      }
    }
    return false;
  }
  /** Module overlaps the logo area (box + margin). */
  inLogoArea(x, y) {
    const c = this.n / 2;
    const h = this.logoAreaHalf;
    const dx = Math.abs(x + 0.5 - c);
    const dy = Math.abs(y + 0.5 - c);
    if (this.style.logo.shape === "circle") {
      const nx = dx - 0.5 > 0 ? dx - 0.5 : 0;
      const ny = dy - 0.5 > 0 ? dy - 0.5 : 0;
      return nx * nx + ny * ny < h * h;
    }
    return dx < h + 0.5 && dy < h + 0.5;
  }
  isExcavated(x, y) {
    return this.excavate && this.inLogoArea(x, y);
  }
  /* 0 = not a data cell, 1 = light data cell, 2 = dark data cell */
  classify() {
    if (this.cells) return this.cells;
    const n = this.n;
    const cells = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (_LayoutContext.isFinder(n, x, y) || this.inStyledAlignment(x, y) || this.isExcavated(x, y)) continue;
        cells[y * n + x] = this.code.modules[y * n + x] === 1 ? 2 : 1;
      }
    this.cells = cells;
    return cells;
  }
  isDataCell(x, y) {
    const n = this.n;
    if (x < 0 || y < 0 || x >= n || y >= n) return false;
    return this.classify()[y * n + x] !== 0;
  }
  isDataDark(x, y) {
    const n = this.n;
    if (x < 0 || y < 0 || x >= n || y >= n) return false;
    return this.classify()[y * n + x] === 2;
  }
  /** Cell-local shape of a dark data module; null for the star shape. */
  moduleCRect(x, y) {
    const s = this.size;
    const d = (1 - s) / 2;
    const rho = this.roundness;
    const r = crect(d, d, 1 - d, 1 - d, NONE, 0);
    switch (this.shape) {
      case "square":
        return r;
      case "dot":
        r.c = corners(ROUND, s / 2);
        return r;
      case "rounded":
        r.c = corners(ROUND, rho * s / 2);
        return r;
      case "diamond":
        r.c = corners(CHAMFER, s / 2);
        return r;
      case "star":
        return null;
      case "hbars": {
        const l = this.isDataDark(x - 1, y);
        const rt = this.isDataDark(x + 1, y);
        if (l) r.x0 = 0;
        if (rt) r.x1 = 1;
        const a = rho * s / 2;
        if (!l) r.c[TL] = r.c[BL] = { kind: ROUND, a };
        if (!rt) r.c[TR] = r.c[BR] = { kind: ROUND, a };
        return r;
      }
      case "vbars": {
        const u = this.isDataDark(x, y - 1);
        const dn = this.isDataDark(x, y + 1);
        if (u) r.y0 = 0;
        if (dn) r.y1 = 1;
        const a = rho * s / 2;
        if (!u) r.c[TL] = r.c[TR] = { kind: ROUND, a };
        if (!dn) r.c[BL] = r.c[BR] = { kind: ROUND, a };
        return r;
      }
      default:
        break;
    }
    r.x0 = r.y0 = 0;
    r.x1 = r.y1 = 1;
    const up = this.isDataDark(x, y - 1);
    const down = this.isDataDark(x, y + 1);
    const left = this.isDataDark(x - 1, y);
    const right = this.isDataDark(x + 1, y);
    const open = [!up && !left, !up && !right, !down && !right, !down && !left];
    const kind = this.shape === "bevel" ? CHAMFER : ROUND;
    for (let i = 0; i < 4; i++) {
      let use = open[i];
      if (this.shape === "classy" && (i === TR || i === BL)) use = false;
      if (use) r.c[i] = { kind, a: rho / 2 };
    }
    return r;
  }
  /** Which corners of a light data cell get a liquid fillet (bit i = corner i). */
  filletMask(x, y) {
    if (this.shape !== "liquid" || this.roundness <= 0) return 0;
    const up = this.isDataDark(x, y - 1);
    const down = this.isDataDark(x, y + 1);
    const left = this.isDataDark(x - 1, y);
    const right = this.isDataDark(x + 1, y);
    let m = 0;
    if (up && left && this.isDataDark(x - 1, y - 1)) m |= 1 << TL;
    if (up && right && this.isDataDark(x + 1, y - 1)) m |= 1 << TR;
    if (down && right && this.isDataDark(x + 1, y + 1)) m |= 1 << BR;
    if (down && left && this.isDataDark(x - 1, y + 1)) m |= 1 << BL;
    return m;
  }
  logoBgCRect() {
    const h = this.logoAreaHalf;
    const r = crect(this.logoCx - h, this.logoCy - h, this.logoCx + h, this.logoCy + h, NONE, 0);
    if (this.style.logo.shape === "rounded") r.c = corners(ROUND, h * 0.3);
    else if (this.style.logo.shape === "circle") r.c = corners(ROUND, h);
    return r;
  }
};
function isAlignmentCenter(k, i, j) {
  return !(i === 0 && j === 0 || i === 0 && j === k - 1 || i === k - 1 && j === 0);
}
function eyeCorners(shape, s, cc) {
  switch (shape) {
    case "rounded":
      return corners(ROUND, s * 0.25);
    case "circle":
      return corners(ROUND, s / 2);
    /* leaf/drop use 0.36 * s: fully rounded versions break finder detection */
    case "leaf": {
      const c = corners(NONE, 0);
      c[cc] = { kind: ROUND, a: s * 0.36 };
      c[(cc + 2) % 4] = { kind: ROUND, a: s * 0.36 };
      return c;
    }
    case "drop": {
      const c = corners(ROUND, s * 0.36);
      c[cc] = { kind: NONE, a: 0 };
      return c;
    }
    case "bevel":
      return corners(CHAMFER, s * 0.25);
    case "diamond":
      return corners(CHAMFER, s / 2);
    default:
      return corners(NONE, 0);
  }
}
function innerCorners(outer, sInner) {
  return outer.map((o) => {
    let a = o.a;
    if (o.kind === ROUND) a -= 1;
    else if (o.kind === CHAMFER) a -= 2 - Math.sqrt(2);
    a = clamp(a, 0, sInner / 2);
    return { kind: a > 0 ? o.kind : NONE, a: a > 0 ? a : 0 };
  });
}
function layerPaint(style, layer) {
  switch (layer) {
    case "background":
      return style.background.color;
    case "border":
      return solidPaint(style.border.color);
    case "eyeFrames":
      return style.eyes.frameColor.type !== "none" ? style.eyes.frameColor : style.modules.color;
    case "eyeBalls":
      return style.eyes.ballColor.type !== "none" ? style.eyes.ballColor : style.modules.color;
    case "logoBackground":
      return solidPaint(style.logo.background);
    default:
      return style.modules.color;
  }
}
function layerVisible(code, style, layer) {
  const p = layerPaint(style, layer);
  let painted = p.type === "solid" && (p.color & 255) !== 0;
  if (p.type === "linear" || p.type === "radial")
    painted = p.stops.slice(0, 8).some((st) => (st.color & 255) !== 0);
  switch (layer) {
    case "border":
      return painted && style.border.width > 0;
    case "logoBackground":
      return painted && style.logo.size > 0;
    case "modules":
      return painted && emitLayer(code, style, layer) > 0;
    default:
      return painted;
  }
}
function gradientGeometryFor(L, layer, p) {
  let ax, ay, aw, ah;
  if (layer === "background") {
    ax = 0;
    ay = 0;
    aw = L.W;
    ah = L.H;
  } else {
    ax = L.ox;
    ay = L.oy;
    aw = L.n;
    ah = L.n;
  }
  const cx = ax + aw / 2;
  const cy = ay + ah / 2;
  const angle = "angle" in p ? p.angle : 0;
  let a = angle % 360;
  if (a < 0) a += 360;
  let dx, dy;
  if (a === 0) {
    dx = 1;
    dy = 0;
  } else if (a === 90) {
    dx = 0;
    dy = 1;
  } else if (a === 180) {
    dx = -1;
    dy = 0;
  } else if (a === 270) {
    dx = 0;
    dy = -1;
  } else {
    const rad = a * 3.141592653589793 / 180;
    dx = Math.cos(rad);
    dy = Math.sin(rad);
  }
  const half = (Math.abs(dx) * aw + Math.abs(dy) * ah) / 2;
  const pcx = "cx" in p ? p.cx : 0.5;
  const pcy = "cy" in p ? p.cy : 0.5;
  const pr = "r" in p ? p.r : 0.75;
  return {
    x1: cx - dx * half,
    y1: cy - dy * half,
    x2: cx + dx * half,
    y2: cy + dy * half,
    cx: ax + aw * pcx,
    cy: ay + ah * pcy,
    r: pr * (aw > ah ? aw : ah)
  };
}
function gradientGeometry(code, style, layer) {
  return gradientGeometryFor(new LayoutContext(code, style), layer, layerPaint(style, layer));
}
function getLayout(code, style) {
  const L = new LayoutContext(code, style);
  return {
    width: L.W,
    height: L.H,
    symbolX: L.ox,
    symbolY: L.oy,
    modules: L.n,
    hasLogo: L.hasLogo,
    logoX: L.logoCx - L.logoHalf,
    logoY: L.logoCy - L.logoHalf,
    logoSize: 2 * L.logoHalf,
    hasLabel: L.hasLabel,
    labelX: L.labelX,
    labelBaseline: L.labelBaseline,
    labelSize: L.labelSize
  };
}
var Emitter = class {
  constructor(sink) {
    this.sink = sink;
    this.sx = 0;
    this.sy = 0;
    this.cx = 0;
    this.cy = 0;
    this.pending = false;
    this.px = 0;
    this.py = 0;
    this.count = 0;
  }
  flush() {
    if (this.pending) {
      if (this.sink) this.sink.lineTo(this.px, this.py);
      this.pending = false;
    }
  }
  move(x, y) {
    this.flush();
    this.sx = this.cx = x;
    this.sy = this.cy = y;
    this.count++;
    if (this.sink) this.sink.moveTo(x, y);
  }
  line(x, y) {
    if (x === this.cx && y === this.cy) return;
    this.flush();
    this.pending = true;
    this.px = this.cx = x;
    this.py = this.cy = y;
  }
  arc(r, cw, x, y, ccx, ccy) {
    this.flush();
    this.cx = x;
    this.cy = y;
    if (this.sink) this.sink.arcTo(r, cw, x, y, ccx, ccy);
  }
  close() {
    if (this.pending && !(this.px === this.sx && this.py === this.sy)) this.flush();
    this.pending = false;
    this.cx = this.sx;
    this.cy = this.sy;
    if (this.sink) this.sink.close();
  }
  corner(c, cw, x, y, ccx, ccy) {
    if (c.kind === ROUND && c.a > 0) this.arc(c.a, cw, x, y, ccx, ccy);
    else if (c.kind === CHAMFER && c.a > 0) this.line(x, y);
  }
  /* Clockwise (filled) rectangle with corner treatments. */
  crect(r) {
    const { x0, y0, x1, y1 } = r;
    const tl = camt(r.c[TL]);
    const tr = camt(r.c[TR]);
    const br = camt(r.c[BR]);
    const bl = camt(r.c[BL]);
    this.move(x0 + tl, y0);
    this.line(x1 - tr, y0);
    this.corner(r.c[TR], true, x1, y0 + tr, x1 - tr, y0 + tr);
    this.line(x1, y1 - br);
    this.corner(r.c[BR], true, x1 - br, y1, x1 - br, y1 - br);
    this.line(x0 + bl, y1);
    this.corner(r.c[BL], true, x0, y1 - bl, x0 + bl, y1 - bl);
    this.line(x0, y0 + tl);
    this.corner(r.c[TL], true, x0 + tl, y0, x0 + tl, y0 + tl);
    this.close();
  }
  /* Counter-clockwise version, used for holes. */
  crectCcw(r) {
    const { x0, y0, x1, y1 } = r;
    const tl = camt(r.c[TL]);
    const tr = camt(r.c[TR]);
    const br = camt(r.c[BR]);
    const bl = camt(r.c[BL]);
    this.move(x0, y0 + tl);
    this.line(x0, y1 - bl);
    this.corner(r.c[BL], false, x0 + bl, y1, x0 + bl, y1 - bl);
    this.line(x1 - br, y1);
    this.corner(r.c[BR], false, x1, y1 - br, x1 - br, y1 - br);
    this.line(x1, y0 + tr);
    this.corner(r.c[TR], false, x1 - tr, y0, x1 - tr, y0 + tr);
    this.line(x0 + tl, y0);
    this.corner(r.c[TL], false, x0, y0 + tl, x0 + tl, y0 + tl);
    this.close();
  }
  /* Four-point star: tips at distance h, concave arcs of radius h*sqrt(2.5)
   * centered at (+-1.5h, +-1.5h). */
  star(cx, cy, h) {
    const r = Math.sqrt(2.5) * h;
    const c = 1.5 * h;
    this.move(cx, cy - h);
    this.arc(r, false, cx + h, cy, cx + c, cy - c);
    this.arc(r, false, cx, cy + h, cx + c, cy + c);
    this.arc(r, false, cx - h, cy, cx - c, cy + c);
    this.arc(r, false, cx, cy - h, cx - c, cy - c);
    this.close();
  }
  fillet(corner, X, Y, r) {
    switch (corner) {
      case TL:
        this.move(X, Y);
        this.line(X + r, Y);
        this.arc(r, false, X, Y + r, X + r, Y + r);
        break;
      case TR:
        this.move(X + 1, Y);
        this.line(X + 1, Y + r);
        this.arc(r, false, X + 1 - r, Y, X + 1 - r, Y + r);
        break;
      case BR:
        this.move(X + 1, Y + 1);
        this.line(X + 1 - r, Y + 1);
        this.arc(r, false, X + 1, Y + 1 - r, X + 1 - r, Y + 1 - r);
        break;
      default:
        this.move(X, Y + 1);
        this.line(X, Y + 1 - r);
        this.arc(r, false, X + r, Y + 1, X + r, Y + 1 - r);
        break;
    }
    this.close();
  }
};
function camt(c) {
  return c.kind === NONE ? 0 : c.a;
}
function emitModules(e, L) {
  const n = L.n;
  const ox = L.ox;
  const oy = L.oy;
  const s = L.size;
  const d = (1 - s) / 2;
  if (L.shape === "square" && s === 1 || L.shape === "hbars") {
    const bars = L.shape === "hbars";
    const inset = bars ? d : 0;
    const a = bars ? L.roundness * s / 2 : 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; ) {
        if (!L.isDataDark(x, y)) {
          x++;
          continue;
        }
        const x0 = x;
        while (x < n && L.isDataDark(x, y)) x++;
        e.crect(crect(ox + x0 + inset, oy + y + inset, ox + x - inset, oy + y + 1 - inset, bars ? ROUND : NONE, a));
      }
    }
    return;
  }
  if (L.shape === "vbars") {
    const a = L.roundness * s / 2;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; ) {
        if (!L.isDataDark(x, y)) {
          y++;
          continue;
        }
        const y0 = y;
        while (y < n && L.isDataDark(x, y)) y++;
        e.crect(crect(ox + x + d, oy + y0 + d, ox + x + 1 - d, oy + y - d, ROUND, a));
      }
    }
    return;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const X = ox + x;
      const Y = oy + y;
      if (L.isDataDark(x, y)) {
        const r = L.moduleCRect(x, y);
        if (!r) {
          e.star(X + 0.5, Y + 0.5, s / 2);
          continue;
        }
        r.x0 += X;
        r.x1 += X;
        r.y0 += Y;
        r.y1 += Y;
        e.crect(r);
      } else if (L.isDataCell(x, y)) {
        const m = L.filletMask(x, y);
        for (let c = 0; c < 4; c++) if (m & 1 << c) e.fillet(c, X, Y, L.roundness / 2);
      }
    }
  }
}
function emitEyePart(e, shape, X, Y, s, ring, cc) {
  if (shape === "dots") {
    const k = Math.trunc(s);
    for (let j = 0; j < k; j++)
      for (let i = 0; i < k; i++) {
        if (ring && !(i === 0 || j === 0 || i === k - 1 || j === k - 1)) continue;
        e.crect(crect(X + i, Y + j, X + i + 1, Y + j + 1, ROUND, 0.5));
      }
    return;
  }
  const outer = { x0: X, y0: Y, x1: X + s, y1: Y + s, c: eyeCorners(shape, s, cc) };
  e.crect(outer);
  if (ring) {
    const inner = { x0: X + 1, y0: Y + 1, x1: X + s - 1, y1: Y + s - 1, c: innerCorners(outer.c, s - 2) };
    e.crectCcw(inner);
  }
}
function emitEyes(e, L, frames) {
  const st = L.style;
  const n = L.n;
  const ex = [0, n - 7, 0];
  const ey = [0, 0, n - 7];
  const cc = [BR, BL, TR];
  const fs = validEyeShape(st.eyes.frame) || "square";
  const bs = ballShape(st.eyes.ball);
  for (let i = 0; i < 3; i++) {
    const X = L.ox + ex[i];
    const Y = L.oy + ey[i];
    if (frames) emitEyePart(e, fs, X, Y, 7, true, cc[i]);
    else emitEyePart(e, bs, X + 2, Y + 2, 3, false, cc[i]);
  }
  if (!L.alignStyled) return;
  const afs = validEyeShape(st.alignment.frame);
  const abs = ballShape(st.alignment.ball);
  const pos = L.alignPos;
  const k = pos.length;
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++) {
      if (!isAlignmentCenter(k, i, j)) continue;
      const X = L.ox + pos[j];
      const Y = L.oy + pos[i];
      if (frames) emitEyePart(e, afs, X - 2, Y - 2, 5, true, BR);
      else emitEyePart(e, abs, X, Y, 1, false, BR);
    }
}
function canvasCRect(L, inset) {
  const a = L.bgRadius - inset;
  return crect(inset, inset, L.W - inset, L.H - inset, a > 0 ? ROUND : NONE, a > 0 ? a : 0);
}
function emitLayerFor(L, layer, sink) {
  const e = new Emitter(sink);
  switch (layer) {
    case "background":
      e.crect(canvasCRect(L, 0));
      break;
    case "border":
      if (L.border > 0) {
        e.crect(canvasCRect(L, 0));
        e.crectCcw(canvasCRect(L, L.border));
      }
      break;
    case "modules":
      emitModules(e, L);
      break;
    case "eyeFrames":
      emitEyes(e, L, true);
      break;
    case "eyeBalls":
      emitEyes(e, L, false);
      break;
    case "logoBackground":
      if (L.hasLogo && (L.style.logo.background & 255) !== 0) e.crect(L.logoBgCRect());
      break;
    default:
      break;
  }
  return e.count;
}
function emitLayer(code, style, layer, sink) {
  return emitLayerFor(new LayoutContext(code, style), layer, sink || null);
}
function logoDamage(code, style) {
  const L = new LayoutContext(code, style);
  if (!L.hasLogo) return 0;
  const ver = code.version;
  const ecc = eccIndex(code.ecc);
  const size = code.size;
  const numBlocks = numEccBlocks(ecc, ver);
  const blockEcc = eccCodewordsPerBlock(ecc, ver);
  const raw = rawCodewords(ver);
  const dataLen = raw - numBlocks * blockEcc;
  const numShort = numBlocks - raw % numBlocks;
  const shortLen = Math.floor(raw / numBlocks) - blockEcc;
  const fmap = functionMap(ver);
  const damaged = new Array(numBlocks).fill(0);
  let lastCw = -1;
  let lastHit = false;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = (right + 1 & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fmap[y * size + x] || bit >= raw * 8) continue;
        const cw = Math.floor(bit / 8);
        bit++;
        if (cw !== lastCw) {
          lastCw = cw;
          lastHit = false;
        }
        if (lastHit || !L.inLogoArea(x, y)) continue;
        lastHit = true;
        let block;
        if (cw < dataLen)
          block = cw < shortLen * numBlocks ? cw % numBlocks : numShort + (cw - shortLen * numBlocks);
        else block = (cw - dataLen) % numBlocks;
        damaged[block]++;
      }
    }
  }
  let worst = 0;
  const correctable = Math.floor(blockEcc / 2);
  for (let b = 0; b < numBlocks; b++) {
    const ratio = damaged[b] / correctable;
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

// src/lint.ts
var LINT_FLAGS = [
  "logo-risky",
  "logo-unreadable",
  "low-contrast",
  "inverted",
  "transparent-background",
  "quiet-zone",
  "small-modules",
  "eye-shapes",
  "invisible"
];
var LINT_MESSAGES = {
  "logo-risky": "The logo hides a lot of data; some scanners may fail. Make it smaller or raise the error correction.",
  "logo-unreadable": "The logo hides more data than error correction can recover: this code will not scan.",
  "low-contrast": "Foreground and background colors are too similar (contrast below 3:1).",
  inverted: "Light modules on a dark background: many scanners cannot read inverted codes.",
  "transparent-background": "The background is transparent: make sure the code is placed on a light surface.",
  "quiet-zone": "The margin is below 2 modules; scanners need a quiet zone around the code.",
  "small-modules": "Modules smaller than 60% of a cell are hard to read from a distance.",
  "eye-shapes": "This eye frame / ball combination can confuse finder detection.",
  invisible: "The modules or the eyes have no visible color (none, or fully transparent)."
};
function channel(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
var WEIGHT = [0.2126, 0.7152, 0.0722];
function luminanceOver(c, under) {
  const a = (c & 255) / 255;
  let l = 0;
  for (let i = 0; i < 3; i++) {
    const shift = 24 - 8 * i;
    const v = (c >>> shift & 255) / 255;
    const u = (under >>> shift & 255) / 255;
    l += WEIGHT[i] * channel(v * a + u * (1 - a));
  }
  return l;
}
function paintColors(p) {
  if (p.type === "solid") return [p.color];
  if ((p.type === "linear" || p.type === "radial") && p.stops.length > 0)
    return p.stops.slice(0, 8).map((st) => st.color);
  return [TRANSPARENT];
}
function opaqueOverWhite(c) {
  const a = (c & 255) / 255;
  let out = 255;
  for (let shift = 8; shift <= 24; shift += 8) {
    const v = (c >>> shift & 255) * a + 255 * (1 - a);
    out |= Math.floor(v + 0.5) << shift;
  }
  return out >>> 0;
}
function lint(code, style) {
  const flags = /* @__PURE__ */ new Set();
  const L = new LayoutContext(code, style);
  if (L.hasLogo) {
    const d = logoDamage(code, style);
    if (d > 1) flags.add("logo-unreadable");
    else if (d > 0.7) flags.add("logo-risky");
  }
  const original = paintColors(style.background.color);
  if (original.every((c) => (c & 255) === 0)) flags.add("transparent-background");
  const bg = original.map(opaqueOverWhite);
  let bgLo = 1;
  let bgHi = 0;
  for (const b of bg) {
    const l = luminanceOver(b, b);
    if (l < bgLo) bgLo = l;
    if (l > bgHi) bgHi = l;
  }
  let fgLo = 1;
  let fgHi = 0;
  for (const layer of ["modules", "eyeFrames", "eyeBalls"]) {
    let visible = false;
    for (const f of paintColors(layerPaint(style, layer))) {
      if (f & 255) visible = true;
      for (const b of bg) {
        const l = luminanceOver(f, b);
        if (l < fgLo) fgLo = l;
        if (l > fgHi) fgHi = l;
      }
    }
    if (!visible) flags.add("invisible");
  }
  let contrast;
  if ((fgLo + fgHi) / 2 > (bgLo + bgHi) / 2) {
    flags.add("inverted");
    contrast = (fgLo + 0.05) / (bgHi + 0.05);
  } else {
    contrast = (bgLo + 0.05) / (fgHi + 0.05);
  }
  if (contrast < 3) flags.add("low-contrast");
  if (L.margin < 2) flags.add("quiet-zone");
  switch (L.shape) {
    case "square":
    case "dot":
    case "rounded":
    case "diamond":
    case "star":
    case "hbars":
    case "vbars":
      if (L.size < 0.6) flags.add("small-modules");
      break;
    default:
      break;
  }
  const frame = style.eyes.frame;
  const ball = ballShape(style.eyes.ball);
  if (frame === "diamond" || ball === "diamond" && (frame === "square" || frame === "leaf")) flags.add("eye-shapes");
  return LINT_FLAGS.filter((f) => flags.has(f));
}

// src/svg.ts
function formatNumber(value) {
  if (!(value > -1e15 && value < 1e15)) value = 0;
  let n = Math.floor(value * 1e3 + 0.5);
  let out = "";
  if (n < 0) {
    out = "-";
    n = -n;
  }
  const fp = n % 1e3;
  const ip = (n - fp) / 1e3;
  out += String(ip);
  if (fp) {
    out += "." + Math.floor(fp / 100);
    if (fp % 100) {
      out += Math.floor(fp / 10) % 10;
      if (fp % 10) out += fp % 10;
    }
  }
  return out;
}
function escapeXml(value) {
  const s = String(value);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "&") out += "&amp;";
    else if (c === "<") out += "&lt;";
    else if (c === ">") out += "&gt;";
    else if (c === '"') out += "&quot;";
    else if (c >= " " || c === "	" || c === "\n" || c === "\r") out += c;
  }
  return out;
}
var SvgPathWriter = class {
  constructor() {
    this.parts = [];
    this.lx = 0;
    this.ly = 0;
  }
  moveTo(x, y) {
    this.parts.push("M" + formatNumber(x) + " " + formatNumber(y));
    this.lx = x;
    this.ly = y;
  }
  lineTo(x, y) {
    if (y === this.ly) this.parts.push("H" + formatNumber(x));
    else if (x === this.lx) this.parts.push("V" + formatNumber(y));
    else this.parts.push("L" + formatNumber(x) + " " + formatNumber(y));
    this.lx = x;
    this.ly = y;
  }
  arcTo(r, clockwise, x, y) {
    const rs = formatNumber(r);
    this.parts.push("A" + rs + " " + rs + (clockwise ? " 0 0 1 " : " 0 0 0 ") + formatNumber(x) + " " + formatNumber(y));
    this.lx = x;
    this.ly = y;
  }
  close() {
    this.parts.push("Z");
  }
  toString() {
    return this.parts.join("");
  }
};
function sanitizeIdPrefix(prefix) {
  if (prefix === null || prefix === void 0) return "qrk";
  const bytes = utf8(String(prefix));
  if (bytes.length === 0) return "qrk";
  let out = bytes[0] >= 48 && bytes[0] <= 57 || bytes[0] === 45 ? "q" : "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    const ok = c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 95 || c === 45;
    out += ok ? String.fromCharCode(c) : "_";
  }
  return out;
}
function opacityAttr(attr, color) {
  const a = color & 255;
  return a !== 255 ? ` ${attr}="${formatNumber(a / 255)}"` : "";
}
function fillAttr(p, prefix, id) {
  if (isGradient(p)) return ` fill="url(#${prefix}-${id})"`;
  if (p.type === "solid") return ` fill="${colorHex(p.color)}"` + opacityAttr("fill-opacity", p.color);
  return ' fill="none"';
}
function gradientElement(L, layer, p, prefix, id) {
  if (!isGradient(p)) return "";
  const g = gradientGeometryFor(L, layer, p);
  const linear = p.type === "linear";
  let out = (linear ? '<linearGradient id="' : '<radialGradient id="') + prefix + "-" + id + '" gradientUnits="userSpaceOnUse"';
  if (linear)
    out += ` x1="${formatNumber(g.x1)}" y1="${formatNumber(g.y1)}" x2="${formatNumber(g.x2)}" y2="${formatNumber(g.y2)}"`;
  else out += ` cx="${formatNumber(g.cx)}" cy="${formatNumber(g.cy)}" r="${formatNumber(g.r)}"`;
  out += ">";
  const count = Math.min(p.stops.length, 8);
  for (let i = 0; i < count; i++) {
    const st = p.stops[i];
    out += `<stop offset="${formatNumber(st.offset)}" stop-color="${colorHex(st.color)}"` + opacityAttr("stop-opacity", st.color) + "/>";
  }
  return out + (linear ? "</linearGradient>" : "</radialGradient>");
}
function layerPath(L, layer, paint, prefix, id) {
  const w = new SvgPathWriter();
  if (emitLayerFor(L, layer, w) === 0) return "";
  return '<path d="' + w.toString() + '"' + fillAttr(paint, prefix, id) + "/>\n";
}
function toSvg(code, style, options = {}) {
  options = options || {};
  const prefix = sanitizeIdPrefix(options.idPrefix);
  const width = typeof options.width === "number" ? options.width : 0;
  const L = new LayoutContext(code, style);
  let out = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + formatNumber(L.W) + " " + formatNumber(L.H) + '"';
  if (width > 0) out += ` width="${formatNumber(width)}" height="${formatNumber(width * L.H / L.W)}"`;
  out += ">\n";
  const bg = style.background.color;
  const fg = style.modules.color;
  const ef = style.eyes.frameColor;
  const eb = style.eyes.ballColor;
  if (isGradient(bg) || isGradient(fg) || isGradient(ef) || isGradient(eb)) {
    out += "<defs>";
    out += gradientElement(L, "background", bg, prefix, "bg");
    out += gradientElement(L, "modules", fg, prefix, "fg");
    out += gradientElement(L, "eyeFrames", ef, prefix, "ef");
    out += gradientElement(L, "eyeBalls", eb, prefix, "eb");
    out += "</defs>\n";
  }
  const bgVisible = isGradient(bg) || bg.type === "solid" && (bg.color & 255) !== 0;
  if (bgVisible) {
    out += `<rect width="${formatNumber(L.W)}" height="${formatNumber(L.H)}"`;
    if (L.bgRadius > 0) out += ` rx="${formatNumber(L.bgRadius)}"`;
    out += fillAttr(bg, prefix, "bg") + "/>\n";
  }
  out += layerPath(L, "border", solidPaint(style.border.color), prefix, "");
  out += layerPath(L, "modules", fg, prefix, "fg");
  out += layerPath(L, "eyeFrames", ef.type !== "none" ? ef : fg, prefix, ef.type !== "none" ? "ef" : "fg");
  out += layerPath(L, "eyeBalls", eb.type !== "none" ? eb : fg, prefix, eb.type !== "none" ? "eb" : "fg");
  out += layerPath(L, "logoBackground", solidPaint(style.logo.background), prefix, "");
  if (L.hasLogo && style.logo.href && String(style.logo.href)) {
    out += `<image x="${formatNumber(L.logoCx - L.logoHalf)}" y="${formatNumber(L.logoCy - L.logoHalf)}" width="${formatNumber(2 * L.logoHalf)}" height="${formatNumber(2 * L.logoHalf)}" preserveAspectRatio="xMidYMid meet" xlink:href="${escapeXml(style.logo.href)}"/>
`;
  }
  if (L.hasLabel) {
    const f = L.labelSize;
    out += `<text x="${formatNumber(L.labelX)}" y="${formatNumber(L.labelBaseline)}" text-anchor="middle" font-family="` + escapeXml(style.label.font ? style.label.font : "sans-serif") + `" font-size="${formatNumber(f)}"` + (style.label.bold ? ' font-weight="bold"' : "") + ` fill="${colorHex(style.label.color)}"` + opacityAttr("fill-opacity", style.label.color) + ">" + escapeXml(style.label.text) + "</text>\n";
  }
  return out + "</svg>\n";
}

// src/payload.ts
function empty(s) {
  return !s;
}
function escaped(s, special) {
  if (!s) return "";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") {
      out += "\\n";
      continue;
    }
    if (special.indexOf(c) >= 0) out += "\\";
    out += c;
  }
  return out;
}
var HEX = "0123456789ABCDEF";
function percent(s) {
  let out = "";
  const bytes = utf8(s);
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 48 && c <= 57 || c === 45 || c === 95 || c === 46 || c === 126)
      out += String.fromCharCode(c);
    else out += "%" + HEX[c >> 4] + HEX[c & 15];
  }
  return out;
}
function wifi(ssid, password, auth, hidden = false) {
  const special = '\\;,:"';
  let out = "WIFI:";
  if (!empty(auth)) out += "T:" + auth + ";";
  out += "S:" + escaped(ssid, special) + ";";
  if (!empty(password) && auth !== "nopass") out += "P:" + escaped(password, special) + ";";
  if (hidden) out += "H:true;";
  return out + ";";
}
function email(to, subject, body) {
  let out = "mailto:" + (to || "");
  let sep = "?";
  if (!empty(subject)) {
    out += sep + "subject=" + percent(subject);
    sep = "&";
  }
  if (!empty(body)) out += sep + "body=" + percent(body);
  return out;
}
function sms(number, message) {
  return "SMSTO:" + (number || "") + (empty(message) ? "" : ":" + message);
}
function tel(number) {
  return "tel:" + (number || "");
}
function fixed6(v) {
  let n = Math.floor(v * 1e6 + 0.5);
  let out = "";
  if (n < 0) {
    out = "-";
    n = -n;
  }
  const fp = n % 1e6;
  const ip = (n - fp) / 1e6;
  out += String(ip);
  if (fp) {
    let frac = String(fp);
    while (frac.length < 6) frac = "0" + frac;
    out += "." + frac.replace(/0+$/, "");
  }
  return out;
}
function clamp2(v, lo, hi) {
  if (!(v >= lo)) return lo;
  return v > hi ? hi : v;
}
function geo(latitude, longitude) {
  return "geo:" + fixed6(clamp2(latitude, -90, 90)) + "," + fixed6(clamp2(longitude, -180, 180));
}
function vline(key, value, always = false) {
  if (!always && empty(value)) return "";
  return key + ":" + escaped(value, "\\;,") + "\n";
}
function vcard(card) {
  const special = "\\;,";
  let out = "BEGIN:VCARD\nVERSION:3.0\nN:";
  out += escaped(card.lastName, special) + ";" + escaped(card.firstName, special) + ";;;\nFN:";
  out += escaped(card.firstName, special);
  if (!empty(card.firstName) && !empty(card.lastName)) out += " ";
  out += escaped(card.lastName, special) + "\n";
  out += vline("ORG", card.organization);
  out += vline("TITLE", card.title);
  out += vline("TEL", card.phone);
  out += vline("EMAIL", card.email);
  out += vline("URL", card.url);
  if (!empty(card.address)) out += "ADR:;;" + escaped(card.address, special) + ";;;;\n";
  out += vline("NOTE", card.note);
  return out + "END:VCARD";
}
function event(e) {
  let out = "BEGIN:VEVENT\n";
  out += vline("SUMMARY", e.summary, true);
  out += vline("DTSTART", e.start);
  out += vline("DTEND", e.end);
  out += vline("LOCATION", e.location);
  out += vline("DESCRIPTION", e.description);
  return out + "END:VEVENT";
}

// src/canvas.ts
var CanvasPathSink = class {
  constructor(target) {
    this.target = target;
    this.x = 0;
    this.y = 0;
    this.sx = 0;
    this.sy = 0;
  }
  moveTo(x, y) {
    this.target.moveTo(x, y);
    this.x = this.sx = x;
    this.y = this.sy = y;
  }
  lineTo(x, y) {
    this.target.lineTo(x, y);
    this.x = x;
    this.y = y;
  }
  arcTo(r, clockwise, x, y, cx, cy) {
    const a0 = Math.atan2(this.y - cy, this.x - cx);
    const a1 = Math.atan2(y - cy, x - cx);
    this.target.arc(cx, cy, r, a0, a1, !clockwise);
    this.x = x;
    this.y = y;
  }
  close() {
    this.target.closePath();
    this.x = this.sx;
    this.y = this.sy;
  }
};
function layerToCanvasPath(target, code, style, layer) {
  return emitLayerFor(new LayoutContext(code, style), layer, new CanvasPathSink(target));
}
function cssColor(c) {
  const a = (c & 255) / 255;
  return `rgba(${c >>> 24},${c >>> 16 & 255},${c >>> 8 & 255},${Math.round(a * 1e3) / 1e3})`;
}
function fillStyleFor(ctx, L, layer, p) {
  if (p.type === "none") return null;
  if (p.type === "solid") return (p.color & 255) === 0 ? null : cssColor(p.color);
  const stops = p.stops.slice(0, 8);
  if (stops.length === 0) return null;
  const g = gradientGeometryFor(L, layer, p);
  if (p.type === "radial" && !(g.r > 0)) return cssColor(stops[stops.length - 1].color);
  const grad = p.type === "linear" ? ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2) : ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.r);
  let prev = 0;
  for (const st of stops) {
    let o = st.offset < 0 ? 0 : st.offset > 1 ? 1 : st.offset;
    if (!(o >= prev)) o = prev;
    prev = o;
    grad.addColorStop(o, cssColor(st.color));
  }
  return grad;
}
function fillLayer(ctx, L, layer, paint) {
  const style = fillStyleFor(ctx, L, layer, paint);
  if (style === null) return;
  const P2D = globalThis.Path2D;
  if (P2D) {
    const path = new P2D();
    if (emitLayerFor(L, layer, new CanvasPathSink(path)) === 0) return;
    ctx.fillStyle = style;
    ctx.fill(path, "nonzero");
  } else {
    ctx.beginPath();
    if (emitLayerFor(L, layer, new CanvasPathSink(ctx)) === 0) return;
    ctx.fillStyle = style;
    ctx.fill("nonzero");
  }
}
function imageSize(img) {
  const pick = (...v) => {
    for (const x of v) {
      if (typeof x === "number" && x > 0) return x;
      if (x && typeof x === "object" && "baseVal" in x) {
        const bv = x.baseVal.value;
        if (bv > 0) return bv;
      }
    }
    return 0;
  };
  const w = pick(img.naturalWidth, img.videoWidth, img.displayWidth, img.codedWidth, img.width);
  const h = pick(img.naturalHeight, img.videoHeight, img.displayHeight, img.codedHeight, img.height);
  return w > 0 && h > 0 ? [w, h] : [1, 1];
}
function isCanvas(t) {
  return !!t && typeof t.getContext === "function";
}
function renderToCanvas(target, code, style, options = {}) {
  const L = new LayoutContext(code, style);
  const pr = options.pixelRatio && options.pixelRatio > 0 ? options.pixelRatio : 1;
  let ctx;
  let width;
  if (isCanvas(target)) {
    const c = target.getContext("2d");
    if (!c) throw new Error("qrkude: 2D canvas context unavailable");
    ctx = c;
    width = options.size && options.size > 0 ? options.size : target.width / pr;
    const height2 = width * L.H / L.W;
    target.width = Math.round(width * pr);
    target.height = Math.round(height2 * pr);
    const cssStyle = target.style;
    if (pr !== 1 && cssStyle) {
      cssStyle.width = `${width}px`;
      cssStyle.height = `${height2}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx = target;
    const canvas = ctx.canvas;
    width = options.size && options.size > 0 ? options.size : (canvas && canvas.width || 256) / pr;
  }
  const height = width * L.H / L.W;
  const scale = width / L.W * pr;
  ctx.save();
  ctx.scale(scale, scale);
  const bg = style.background.color;
  if (isGradient(bg) || bg.type === "solid" && (bg.color & 255) !== 0) fillLayer(ctx, L, "background", bg);
  fillLayer(ctx, L, "border", layerPaint(style, "border"));
  fillLayer(ctx, L, "modules", layerPaint(style, "modules"));
  fillLayer(ctx, L, "eyeFrames", layerPaint(style, "eyeFrames"));
  fillLayer(ctx, L, "eyeBalls", layerPaint(style, "eyeBalls"));
  fillLayer(ctx, L, "logoBackground", layerPaint(style, "logoBackground"));
  const logo = options.logo;
  if (L.hasLogo && logo) {
    const box = 2 * L.logoHalf;
    const [iw, ih] = imageSize(logo);
    const k = box / Math.max(iw, ih);
    const w = iw * k;
    const h = ih * k;
    ctx.drawImage(logo, L.logoCx - L.logoHalf + (box - w) / 2, L.logoCy - L.logoHalf + (box - h) / 2, w, h);
  }
  ctx.restore();
  if (L.hasLabel && options.label !== false) {
    ctx.save();
    ctx.scale(pr, pr);
    const k = width / L.W;
    const font = style.label.font ? style.label.font : "sans-serif";
    ctx.font = `${style.label.bold ? "bold " : ""}${L.labelSize * k}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = cssColor(style.label.color);
    ctx.fillText(style.label.text, L.labelX * k, L.labelBaseline * k);
    ctx.restore();
  }
  return { width, height, scale };
}
function createCanvas() {
  const g = globalThis;
  if (g.document && typeof g.document.createElement === "function") return g.document.createElement("canvas");
  if (g.OffscreenCanvas) return new g.OffscreenCanvas(1, 1);
  throw new Error("qrkude: no canvas implementation available");
}
function loadImage(src) {
  const g = globalThis;
  if (g.Image) {
    const ImageCtor = g.Image;
    return new Promise((resolve2, reject) => {
      const img = new ImageCtor();
      if (!/^(data|blob):/i.test(src)) img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => resolve2(img);
      img.onerror = () => reject(new Error(`qrkude: cannot load image ${src.slice(0, 64)}`));
      img.src = src;
    });
  }
  if (g.fetch && g.createImageBitmap) {
    const create = g.createImageBitmap;
    return g.fetch(src).then((r) => r.blob()).then((b) => create(b));
  }
  return Promise.reject(new Error("qrkude: cannot load images in this environment"));
}
async function renderForExport(code, style, options) {
  let logo = options.logo;
  if (logo === void 0 && style.logo.size > 0 && style.logo.href) logo = await loadImage(style.logo.href);
  const canvas = createCanvas();
  renderToCanvas(canvas, code, style, { size: 512, ...options, logo });
  return canvas;
}
async function toDataURL(code, style, options = {}) {
  const canvas = await renderForExport(code, style, options);
  if (canvas.toDataURL) return canvas.toDataURL(options.type || "image/png", options.quality);
  const blob = await blobOf(canvas, options);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 32768)));
  return `data:${blob.type || options.type || "image/png"};base64,${btoa(bin)}`;
}
function blobOf(canvas, options) {
  const type = options.type || "image/png";
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality: options.quality });
  return new Promise((resolve2, reject) => {
    if (!canvas.toBlob) return reject(new Error("qrkude: canvas cannot export blobs"));
    canvas.toBlob((b) => b ? resolve2(b) : reject(new Error("qrkude: toBlob failed")), type, options.quality);
  });
}
async function toBlob(code, style, options = {}) {
  return blobOf(await renderForExport(code, style, options), options);
}

// src/index.ts
var VERSION = "0.1.0";
function encodeForStyle(data, options, style) {
  const o = options || {};
  return encode(data, { ...o, ecc: o.ecc !== void 0 && o.ecc !== null ? o.ecc : recommendedEcc(style) });
}
function isParsed(doc) {
  const d = doc;
  const s = d && typeof d === "object" ? d.style : void 0;
  return !!s && typeof s === "object" && typeof (s.border && s.border.color) === "number" && typeof (s.logo && s.logo.background) === "number" && typeof (s.label && s.label.color) === "number";
}
function resolve(doc) {
  if (isParsed(doc)) return { encode: doc.encode || {}, style: doc.style, svg: doc.svg || {} };
  return parseDocument(doc);
}
function generate(text, doc) {
  const d = resolve(doc);
  const code = encodeForStyle(text, d.encode, d.style);
  return {
    code,
    style: d.style,
    svgOptions: d.svg,
    svg: toSvg(code, d.style, d.svg),
    lint: lint(code, d.style),
    logoDamage: logoDamage(code, d.style)
  };
}
function svg(text, doc) {
  const d = resolve(doc);
  return toSvg(encodeForStyle(text, d.encode, d.style), d.style, d.svg);
}
