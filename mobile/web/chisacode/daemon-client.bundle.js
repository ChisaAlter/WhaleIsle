var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// (disabled):crypto
var require_crypto = __commonJS({
  "(disabled):crypto"() {
  }
});

// ../../vendor/chisacode-remote/node_modules/tweetnacl/nacl-fast.js
var require_nacl_fast = __commonJS({
  "../../vendor/chisacode-remote/node_modules/tweetnacl/nacl-fast.js"(exports, module) {
    (function(nacl3) {
      "use strict";
      var gf = function(init) {
        var i, r = new Float64Array(16);
        if (init) for (i = 0; i < init.length; i++) r[i] = init[i];
        return r;
      };
      var randombytes = function() {
        throw new Error("no PRNG");
      };
      var _0 = new Uint8Array(16);
      var _9 = new Uint8Array(32);
      _9[0] = 9;
      var gf0 = gf(), gf1 = gf([1]), _121665 = gf([56129, 1]), D = gf([30883, 4953, 19914, 30187, 55467, 16705, 2637, 112, 59544, 30585, 16505, 36039, 65139, 11119, 27886, 20995]), D2 = gf([61785, 9906, 39828, 60374, 45398, 33411, 5274, 224, 53552, 61171, 33010, 6542, 64743, 22239, 55772, 9222]), X = gf([54554, 36645, 11616, 51542, 42930, 38181, 51040, 26924, 56412, 64982, 57905, 49316, 21502, 52590, 14035, 8553]), Y = gf([26200, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214, 26214]), I = gf([41136, 18958, 6951, 50414, 58488, 44335, 6150, 12099, 55207, 15867, 153, 11085, 57099, 20417, 9344, 11139]);
      function ts64(x, i, h, l) {
        x[i] = h >> 24 & 255;
        x[i + 1] = h >> 16 & 255;
        x[i + 2] = h >> 8 & 255;
        x[i + 3] = h & 255;
        x[i + 4] = l >> 24 & 255;
        x[i + 5] = l >> 16 & 255;
        x[i + 6] = l >> 8 & 255;
        x[i + 7] = l & 255;
      }
      function vn(x, xi, y, yi, n) {
        var i, d = 0;
        for (i = 0; i < n; i++) d |= x[xi + i] ^ y[yi + i];
        return (1 & d - 1 >>> 8) - 1;
      }
      function crypto_verify_16(x, xi, y, yi) {
        return vn(x, xi, y, yi, 16);
      }
      function crypto_verify_32(x, xi, y, yi) {
        return vn(x, xi, y, yi, 32);
      }
      function core_salsa20(o, p, k, c) {
        var j0 = c[0] & 255 | (c[1] & 255) << 8 | (c[2] & 255) << 16 | (c[3] & 255) << 24, j1 = k[0] & 255 | (k[1] & 255) << 8 | (k[2] & 255) << 16 | (k[3] & 255) << 24, j2 = k[4] & 255 | (k[5] & 255) << 8 | (k[6] & 255) << 16 | (k[7] & 255) << 24, j3 = k[8] & 255 | (k[9] & 255) << 8 | (k[10] & 255) << 16 | (k[11] & 255) << 24, j4 = k[12] & 255 | (k[13] & 255) << 8 | (k[14] & 255) << 16 | (k[15] & 255) << 24, j5 = c[4] & 255 | (c[5] & 255) << 8 | (c[6] & 255) << 16 | (c[7] & 255) << 24, j6 = p[0] & 255 | (p[1] & 255) << 8 | (p[2] & 255) << 16 | (p[3] & 255) << 24, j7 = p[4] & 255 | (p[5] & 255) << 8 | (p[6] & 255) << 16 | (p[7] & 255) << 24, j8 = p[8] & 255 | (p[9] & 255) << 8 | (p[10] & 255) << 16 | (p[11] & 255) << 24, j9 = p[12] & 255 | (p[13] & 255) << 8 | (p[14] & 255) << 16 | (p[15] & 255) << 24, j10 = c[8] & 255 | (c[9] & 255) << 8 | (c[10] & 255) << 16 | (c[11] & 255) << 24, j11 = k[16] & 255 | (k[17] & 255) << 8 | (k[18] & 255) << 16 | (k[19] & 255) << 24, j12 = k[20] & 255 | (k[21] & 255) << 8 | (k[22] & 255) << 16 | (k[23] & 255) << 24, j13 = k[24] & 255 | (k[25] & 255) << 8 | (k[26] & 255) << 16 | (k[27] & 255) << 24, j14 = k[28] & 255 | (k[29] & 255) << 8 | (k[30] & 255) << 16 | (k[31] & 255) << 24, j15 = c[12] & 255 | (c[13] & 255) << 8 | (c[14] & 255) << 16 | (c[15] & 255) << 24;
        var x0 = j0, x1 = j1, x2 = j2, x3 = j3, x4 = j4, x5 = j5, x6 = j6, x7 = j7, x8 = j8, x9 = j9, x10 = j10, x11 = j11, x12 = j12, x13 = j13, x14 = j14, x15 = j15, u;
        for (var i = 0; i < 20; i += 2) {
          u = x0 + x12 | 0;
          x4 ^= u << 7 | u >>> 32 - 7;
          u = x4 + x0 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x4 | 0;
          x12 ^= u << 13 | u >>> 32 - 13;
          u = x12 + x8 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x1 | 0;
          x9 ^= u << 7 | u >>> 32 - 7;
          u = x9 + x5 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x9 | 0;
          x1 ^= u << 13 | u >>> 32 - 13;
          u = x1 + x13 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x6 | 0;
          x14 ^= u << 7 | u >>> 32 - 7;
          u = x14 + x10 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x14 | 0;
          x6 ^= u << 13 | u >>> 32 - 13;
          u = x6 + x2 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x11 | 0;
          x3 ^= u << 7 | u >>> 32 - 7;
          u = x3 + x15 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x3 | 0;
          x11 ^= u << 13 | u >>> 32 - 13;
          u = x11 + x7 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
          u = x0 + x3 | 0;
          x1 ^= u << 7 | u >>> 32 - 7;
          u = x1 + x0 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x1 | 0;
          x3 ^= u << 13 | u >>> 32 - 13;
          u = x3 + x2 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x4 | 0;
          x6 ^= u << 7 | u >>> 32 - 7;
          u = x6 + x5 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x6 | 0;
          x4 ^= u << 13 | u >>> 32 - 13;
          u = x4 + x7 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x9 | 0;
          x11 ^= u << 7 | u >>> 32 - 7;
          u = x11 + x10 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x11 | 0;
          x9 ^= u << 13 | u >>> 32 - 13;
          u = x9 + x8 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x14 | 0;
          x12 ^= u << 7 | u >>> 32 - 7;
          u = x12 + x15 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x12 | 0;
          x14 ^= u << 13 | u >>> 32 - 13;
          u = x14 + x13 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
        }
        x0 = x0 + j0 | 0;
        x1 = x1 + j1 | 0;
        x2 = x2 + j2 | 0;
        x3 = x3 + j3 | 0;
        x4 = x4 + j4 | 0;
        x5 = x5 + j5 | 0;
        x6 = x6 + j6 | 0;
        x7 = x7 + j7 | 0;
        x8 = x8 + j8 | 0;
        x9 = x9 + j9 | 0;
        x10 = x10 + j10 | 0;
        x11 = x11 + j11 | 0;
        x12 = x12 + j12 | 0;
        x13 = x13 + j13 | 0;
        x14 = x14 + j14 | 0;
        x15 = x15 + j15 | 0;
        o[0] = x0 >>> 0 & 255;
        o[1] = x0 >>> 8 & 255;
        o[2] = x0 >>> 16 & 255;
        o[3] = x0 >>> 24 & 255;
        o[4] = x1 >>> 0 & 255;
        o[5] = x1 >>> 8 & 255;
        o[6] = x1 >>> 16 & 255;
        o[7] = x1 >>> 24 & 255;
        o[8] = x2 >>> 0 & 255;
        o[9] = x2 >>> 8 & 255;
        o[10] = x2 >>> 16 & 255;
        o[11] = x2 >>> 24 & 255;
        o[12] = x3 >>> 0 & 255;
        o[13] = x3 >>> 8 & 255;
        o[14] = x3 >>> 16 & 255;
        o[15] = x3 >>> 24 & 255;
        o[16] = x4 >>> 0 & 255;
        o[17] = x4 >>> 8 & 255;
        o[18] = x4 >>> 16 & 255;
        o[19] = x4 >>> 24 & 255;
        o[20] = x5 >>> 0 & 255;
        o[21] = x5 >>> 8 & 255;
        o[22] = x5 >>> 16 & 255;
        o[23] = x5 >>> 24 & 255;
        o[24] = x6 >>> 0 & 255;
        o[25] = x6 >>> 8 & 255;
        o[26] = x6 >>> 16 & 255;
        o[27] = x6 >>> 24 & 255;
        o[28] = x7 >>> 0 & 255;
        o[29] = x7 >>> 8 & 255;
        o[30] = x7 >>> 16 & 255;
        o[31] = x7 >>> 24 & 255;
        o[32] = x8 >>> 0 & 255;
        o[33] = x8 >>> 8 & 255;
        o[34] = x8 >>> 16 & 255;
        o[35] = x8 >>> 24 & 255;
        o[36] = x9 >>> 0 & 255;
        o[37] = x9 >>> 8 & 255;
        o[38] = x9 >>> 16 & 255;
        o[39] = x9 >>> 24 & 255;
        o[40] = x10 >>> 0 & 255;
        o[41] = x10 >>> 8 & 255;
        o[42] = x10 >>> 16 & 255;
        o[43] = x10 >>> 24 & 255;
        o[44] = x11 >>> 0 & 255;
        o[45] = x11 >>> 8 & 255;
        o[46] = x11 >>> 16 & 255;
        o[47] = x11 >>> 24 & 255;
        o[48] = x12 >>> 0 & 255;
        o[49] = x12 >>> 8 & 255;
        o[50] = x12 >>> 16 & 255;
        o[51] = x12 >>> 24 & 255;
        o[52] = x13 >>> 0 & 255;
        o[53] = x13 >>> 8 & 255;
        o[54] = x13 >>> 16 & 255;
        o[55] = x13 >>> 24 & 255;
        o[56] = x14 >>> 0 & 255;
        o[57] = x14 >>> 8 & 255;
        o[58] = x14 >>> 16 & 255;
        o[59] = x14 >>> 24 & 255;
        o[60] = x15 >>> 0 & 255;
        o[61] = x15 >>> 8 & 255;
        o[62] = x15 >>> 16 & 255;
        o[63] = x15 >>> 24 & 255;
      }
      function core_hsalsa20(o, p, k, c) {
        var j0 = c[0] & 255 | (c[1] & 255) << 8 | (c[2] & 255) << 16 | (c[3] & 255) << 24, j1 = k[0] & 255 | (k[1] & 255) << 8 | (k[2] & 255) << 16 | (k[3] & 255) << 24, j2 = k[4] & 255 | (k[5] & 255) << 8 | (k[6] & 255) << 16 | (k[7] & 255) << 24, j3 = k[8] & 255 | (k[9] & 255) << 8 | (k[10] & 255) << 16 | (k[11] & 255) << 24, j4 = k[12] & 255 | (k[13] & 255) << 8 | (k[14] & 255) << 16 | (k[15] & 255) << 24, j5 = c[4] & 255 | (c[5] & 255) << 8 | (c[6] & 255) << 16 | (c[7] & 255) << 24, j6 = p[0] & 255 | (p[1] & 255) << 8 | (p[2] & 255) << 16 | (p[3] & 255) << 24, j7 = p[4] & 255 | (p[5] & 255) << 8 | (p[6] & 255) << 16 | (p[7] & 255) << 24, j8 = p[8] & 255 | (p[9] & 255) << 8 | (p[10] & 255) << 16 | (p[11] & 255) << 24, j9 = p[12] & 255 | (p[13] & 255) << 8 | (p[14] & 255) << 16 | (p[15] & 255) << 24, j10 = c[8] & 255 | (c[9] & 255) << 8 | (c[10] & 255) << 16 | (c[11] & 255) << 24, j11 = k[16] & 255 | (k[17] & 255) << 8 | (k[18] & 255) << 16 | (k[19] & 255) << 24, j12 = k[20] & 255 | (k[21] & 255) << 8 | (k[22] & 255) << 16 | (k[23] & 255) << 24, j13 = k[24] & 255 | (k[25] & 255) << 8 | (k[26] & 255) << 16 | (k[27] & 255) << 24, j14 = k[28] & 255 | (k[29] & 255) << 8 | (k[30] & 255) << 16 | (k[31] & 255) << 24, j15 = c[12] & 255 | (c[13] & 255) << 8 | (c[14] & 255) << 16 | (c[15] & 255) << 24;
        var x0 = j0, x1 = j1, x2 = j2, x3 = j3, x4 = j4, x5 = j5, x6 = j6, x7 = j7, x8 = j8, x9 = j9, x10 = j10, x11 = j11, x12 = j12, x13 = j13, x14 = j14, x15 = j15, u;
        for (var i = 0; i < 20; i += 2) {
          u = x0 + x12 | 0;
          x4 ^= u << 7 | u >>> 32 - 7;
          u = x4 + x0 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x4 | 0;
          x12 ^= u << 13 | u >>> 32 - 13;
          u = x12 + x8 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x1 | 0;
          x9 ^= u << 7 | u >>> 32 - 7;
          u = x9 + x5 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x9 | 0;
          x1 ^= u << 13 | u >>> 32 - 13;
          u = x1 + x13 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x6 | 0;
          x14 ^= u << 7 | u >>> 32 - 7;
          u = x14 + x10 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x14 | 0;
          x6 ^= u << 13 | u >>> 32 - 13;
          u = x6 + x2 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x11 | 0;
          x3 ^= u << 7 | u >>> 32 - 7;
          u = x3 + x15 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x3 | 0;
          x11 ^= u << 13 | u >>> 32 - 13;
          u = x11 + x7 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
          u = x0 + x3 | 0;
          x1 ^= u << 7 | u >>> 32 - 7;
          u = x1 + x0 | 0;
          x2 ^= u << 9 | u >>> 32 - 9;
          u = x2 + x1 | 0;
          x3 ^= u << 13 | u >>> 32 - 13;
          u = x3 + x2 | 0;
          x0 ^= u << 18 | u >>> 32 - 18;
          u = x5 + x4 | 0;
          x6 ^= u << 7 | u >>> 32 - 7;
          u = x6 + x5 | 0;
          x7 ^= u << 9 | u >>> 32 - 9;
          u = x7 + x6 | 0;
          x4 ^= u << 13 | u >>> 32 - 13;
          u = x4 + x7 | 0;
          x5 ^= u << 18 | u >>> 32 - 18;
          u = x10 + x9 | 0;
          x11 ^= u << 7 | u >>> 32 - 7;
          u = x11 + x10 | 0;
          x8 ^= u << 9 | u >>> 32 - 9;
          u = x8 + x11 | 0;
          x9 ^= u << 13 | u >>> 32 - 13;
          u = x9 + x8 | 0;
          x10 ^= u << 18 | u >>> 32 - 18;
          u = x15 + x14 | 0;
          x12 ^= u << 7 | u >>> 32 - 7;
          u = x12 + x15 | 0;
          x13 ^= u << 9 | u >>> 32 - 9;
          u = x13 + x12 | 0;
          x14 ^= u << 13 | u >>> 32 - 13;
          u = x14 + x13 | 0;
          x15 ^= u << 18 | u >>> 32 - 18;
        }
        o[0] = x0 >>> 0 & 255;
        o[1] = x0 >>> 8 & 255;
        o[2] = x0 >>> 16 & 255;
        o[3] = x0 >>> 24 & 255;
        o[4] = x5 >>> 0 & 255;
        o[5] = x5 >>> 8 & 255;
        o[6] = x5 >>> 16 & 255;
        o[7] = x5 >>> 24 & 255;
        o[8] = x10 >>> 0 & 255;
        o[9] = x10 >>> 8 & 255;
        o[10] = x10 >>> 16 & 255;
        o[11] = x10 >>> 24 & 255;
        o[12] = x15 >>> 0 & 255;
        o[13] = x15 >>> 8 & 255;
        o[14] = x15 >>> 16 & 255;
        o[15] = x15 >>> 24 & 255;
        o[16] = x6 >>> 0 & 255;
        o[17] = x6 >>> 8 & 255;
        o[18] = x6 >>> 16 & 255;
        o[19] = x6 >>> 24 & 255;
        o[20] = x7 >>> 0 & 255;
        o[21] = x7 >>> 8 & 255;
        o[22] = x7 >>> 16 & 255;
        o[23] = x7 >>> 24 & 255;
        o[24] = x8 >>> 0 & 255;
        o[25] = x8 >>> 8 & 255;
        o[26] = x8 >>> 16 & 255;
        o[27] = x8 >>> 24 & 255;
        o[28] = x9 >>> 0 & 255;
        o[29] = x9 >>> 8 & 255;
        o[30] = x9 >>> 16 & 255;
        o[31] = x9 >>> 24 & 255;
      }
      function crypto_core_salsa20(out, inp, k, c) {
        core_salsa20(out, inp, k, c);
      }
      function crypto_core_hsalsa20(out, inp, k, c) {
        core_hsalsa20(out, inp, k, c);
      }
      var sigma = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
      function crypto_stream_salsa20_xor(c, cpos, m, mpos, b, n, k) {
        var z = new Uint8Array(16), x = new Uint8Array(64);
        var u, i;
        for (i = 0; i < 16; i++) z[i] = 0;
        for (i = 0; i < 8; i++) z[i] = n[i];
        while (b >= 64) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < 64; i++) c[cpos + i] = m[mpos + i] ^ x[i];
          u = 1;
          for (i = 8; i < 16; i++) {
            u = u + (z[i] & 255) | 0;
            z[i] = u & 255;
            u >>>= 8;
          }
          b -= 64;
          cpos += 64;
          mpos += 64;
        }
        if (b > 0) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < b; i++) c[cpos + i] = m[mpos + i] ^ x[i];
        }
        return 0;
      }
      function crypto_stream_salsa20(c, cpos, b, n, k) {
        var z = new Uint8Array(16), x = new Uint8Array(64);
        var u, i;
        for (i = 0; i < 16; i++) z[i] = 0;
        for (i = 0; i < 8; i++) z[i] = n[i];
        while (b >= 64) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < 64; i++) c[cpos + i] = x[i];
          u = 1;
          for (i = 8; i < 16; i++) {
            u = u + (z[i] & 255) | 0;
            z[i] = u & 255;
            u >>>= 8;
          }
          b -= 64;
          cpos += 64;
        }
        if (b > 0) {
          crypto_core_salsa20(x, z, k, sigma);
          for (i = 0; i < b; i++) c[cpos + i] = x[i];
        }
        return 0;
      }
      function crypto_stream(c, cpos, d, n, k) {
        var s = new Uint8Array(32);
        crypto_core_hsalsa20(s, n, k, sigma);
        var sn = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sn[i] = n[i + 16];
        return crypto_stream_salsa20(c, cpos, d, sn, s);
      }
      function crypto_stream_xor(c, cpos, m, mpos, d, n, k) {
        var s = new Uint8Array(32);
        crypto_core_hsalsa20(s, n, k, sigma);
        var sn = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sn[i] = n[i + 16];
        return crypto_stream_salsa20_xor(c, cpos, m, mpos, d, sn, s);
      }
      var poly1305 = function(key) {
        this.buffer = new Uint8Array(16);
        this.r = new Uint16Array(10);
        this.h = new Uint16Array(10);
        this.pad = new Uint16Array(8);
        this.leftover = 0;
        this.fin = 0;
        var t0, t1, t2, t3, t4, t5, t6, t7;
        t0 = key[0] & 255 | (key[1] & 255) << 8;
        this.r[0] = t0 & 8191;
        t1 = key[2] & 255 | (key[3] & 255) << 8;
        this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
        t2 = key[4] & 255 | (key[5] & 255) << 8;
        this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
        t3 = key[6] & 255 | (key[7] & 255) << 8;
        this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
        t4 = key[8] & 255 | (key[9] & 255) << 8;
        this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
        this.r[5] = t4 >>> 1 & 8190;
        t5 = key[10] & 255 | (key[11] & 255) << 8;
        this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
        t6 = key[12] & 255 | (key[13] & 255) << 8;
        this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
        t7 = key[14] & 255 | (key[15] & 255) << 8;
        this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
        this.r[9] = t7 >>> 5 & 127;
        this.pad[0] = key[16] & 255 | (key[17] & 255) << 8;
        this.pad[1] = key[18] & 255 | (key[19] & 255) << 8;
        this.pad[2] = key[20] & 255 | (key[21] & 255) << 8;
        this.pad[3] = key[22] & 255 | (key[23] & 255) << 8;
        this.pad[4] = key[24] & 255 | (key[25] & 255) << 8;
        this.pad[5] = key[26] & 255 | (key[27] & 255) << 8;
        this.pad[6] = key[28] & 255 | (key[29] & 255) << 8;
        this.pad[7] = key[30] & 255 | (key[31] & 255) << 8;
      };
      poly1305.prototype.blocks = function(m, mpos, bytes) {
        var hibit = this.fin ? 0 : 1 << 11;
        var t0, t1, t2, t3, t4, t5, t6, t7, c;
        var d0, d1, d2, d3, d4, d5, d6, d7, d8, d9;
        var h0 = this.h[0], h1 = this.h[1], h2 = this.h[2], h3 = this.h[3], h4 = this.h[4], h5 = this.h[5], h6 = this.h[6], h7 = this.h[7], h8 = this.h[8], h9 = this.h[9];
        var r0 = this.r[0], r1 = this.r[1], r2 = this.r[2], r3 = this.r[3], r4 = this.r[4], r5 = this.r[5], r6 = this.r[6], r7 = this.r[7], r8 = this.r[8], r9 = this.r[9];
        while (bytes >= 16) {
          t0 = m[mpos + 0] & 255 | (m[mpos + 1] & 255) << 8;
          h0 += t0 & 8191;
          t1 = m[mpos + 2] & 255 | (m[mpos + 3] & 255) << 8;
          h1 += (t0 >>> 13 | t1 << 3) & 8191;
          t2 = m[mpos + 4] & 255 | (m[mpos + 5] & 255) << 8;
          h2 += (t1 >>> 10 | t2 << 6) & 8191;
          t3 = m[mpos + 6] & 255 | (m[mpos + 7] & 255) << 8;
          h3 += (t2 >>> 7 | t3 << 9) & 8191;
          t4 = m[mpos + 8] & 255 | (m[mpos + 9] & 255) << 8;
          h4 += (t3 >>> 4 | t4 << 12) & 8191;
          h5 += t4 >>> 1 & 8191;
          t5 = m[mpos + 10] & 255 | (m[mpos + 11] & 255) << 8;
          h6 += (t4 >>> 14 | t5 << 2) & 8191;
          t6 = m[mpos + 12] & 255 | (m[mpos + 13] & 255) << 8;
          h7 += (t5 >>> 11 | t6 << 5) & 8191;
          t7 = m[mpos + 14] & 255 | (m[mpos + 15] & 255) << 8;
          h8 += (t6 >>> 8 | t7 << 8) & 8191;
          h9 += t7 >>> 5 | hibit;
          c = 0;
          d0 = c;
          d0 += h0 * r0;
          d0 += h1 * (5 * r9);
          d0 += h2 * (5 * r8);
          d0 += h3 * (5 * r7);
          d0 += h4 * (5 * r6);
          c = d0 >>> 13;
          d0 &= 8191;
          d0 += h5 * (5 * r5);
          d0 += h6 * (5 * r4);
          d0 += h7 * (5 * r3);
          d0 += h8 * (5 * r2);
          d0 += h9 * (5 * r1);
          c += d0 >>> 13;
          d0 &= 8191;
          d1 = c;
          d1 += h0 * r1;
          d1 += h1 * r0;
          d1 += h2 * (5 * r9);
          d1 += h3 * (5 * r8);
          d1 += h4 * (5 * r7);
          c = d1 >>> 13;
          d1 &= 8191;
          d1 += h5 * (5 * r6);
          d1 += h6 * (5 * r5);
          d1 += h7 * (5 * r4);
          d1 += h8 * (5 * r3);
          d1 += h9 * (5 * r2);
          c += d1 >>> 13;
          d1 &= 8191;
          d2 = c;
          d2 += h0 * r2;
          d2 += h1 * r1;
          d2 += h2 * r0;
          d2 += h3 * (5 * r9);
          d2 += h4 * (5 * r8);
          c = d2 >>> 13;
          d2 &= 8191;
          d2 += h5 * (5 * r7);
          d2 += h6 * (5 * r6);
          d2 += h7 * (5 * r5);
          d2 += h8 * (5 * r4);
          d2 += h9 * (5 * r3);
          c += d2 >>> 13;
          d2 &= 8191;
          d3 = c;
          d3 += h0 * r3;
          d3 += h1 * r2;
          d3 += h2 * r1;
          d3 += h3 * r0;
          d3 += h4 * (5 * r9);
          c = d3 >>> 13;
          d3 &= 8191;
          d3 += h5 * (5 * r8);
          d3 += h6 * (5 * r7);
          d3 += h7 * (5 * r6);
          d3 += h8 * (5 * r5);
          d3 += h9 * (5 * r4);
          c += d3 >>> 13;
          d3 &= 8191;
          d4 = c;
          d4 += h0 * r4;
          d4 += h1 * r3;
          d4 += h2 * r2;
          d4 += h3 * r1;
          d4 += h4 * r0;
          c = d4 >>> 13;
          d4 &= 8191;
          d4 += h5 * (5 * r9);
          d4 += h6 * (5 * r8);
          d4 += h7 * (5 * r7);
          d4 += h8 * (5 * r6);
          d4 += h9 * (5 * r5);
          c += d4 >>> 13;
          d4 &= 8191;
          d5 = c;
          d5 += h0 * r5;
          d5 += h1 * r4;
          d5 += h2 * r3;
          d5 += h3 * r2;
          d5 += h4 * r1;
          c = d5 >>> 13;
          d5 &= 8191;
          d5 += h5 * r0;
          d5 += h6 * (5 * r9);
          d5 += h7 * (5 * r8);
          d5 += h8 * (5 * r7);
          d5 += h9 * (5 * r6);
          c += d5 >>> 13;
          d5 &= 8191;
          d6 = c;
          d6 += h0 * r6;
          d6 += h1 * r5;
          d6 += h2 * r4;
          d6 += h3 * r3;
          d6 += h4 * r2;
          c = d6 >>> 13;
          d6 &= 8191;
          d6 += h5 * r1;
          d6 += h6 * r0;
          d6 += h7 * (5 * r9);
          d6 += h8 * (5 * r8);
          d6 += h9 * (5 * r7);
          c += d6 >>> 13;
          d6 &= 8191;
          d7 = c;
          d7 += h0 * r7;
          d7 += h1 * r6;
          d7 += h2 * r5;
          d7 += h3 * r4;
          d7 += h4 * r3;
          c = d7 >>> 13;
          d7 &= 8191;
          d7 += h5 * r2;
          d7 += h6 * r1;
          d7 += h7 * r0;
          d7 += h8 * (5 * r9);
          d7 += h9 * (5 * r8);
          c += d7 >>> 13;
          d7 &= 8191;
          d8 = c;
          d8 += h0 * r8;
          d8 += h1 * r7;
          d8 += h2 * r6;
          d8 += h3 * r5;
          d8 += h4 * r4;
          c = d8 >>> 13;
          d8 &= 8191;
          d8 += h5 * r3;
          d8 += h6 * r2;
          d8 += h7 * r1;
          d8 += h8 * r0;
          d8 += h9 * (5 * r9);
          c += d8 >>> 13;
          d8 &= 8191;
          d9 = c;
          d9 += h0 * r9;
          d9 += h1 * r8;
          d9 += h2 * r7;
          d9 += h3 * r6;
          d9 += h4 * r5;
          c = d9 >>> 13;
          d9 &= 8191;
          d9 += h5 * r4;
          d9 += h6 * r3;
          d9 += h7 * r2;
          d9 += h8 * r1;
          d9 += h9 * r0;
          c += d9 >>> 13;
          d9 &= 8191;
          c = (c << 2) + c | 0;
          c = c + d0 | 0;
          d0 = c & 8191;
          c = c >>> 13;
          d1 += c;
          h0 = d0;
          h1 = d1;
          h2 = d2;
          h3 = d3;
          h4 = d4;
          h5 = d5;
          h6 = d6;
          h7 = d7;
          h8 = d8;
          h9 = d9;
          mpos += 16;
          bytes -= 16;
        }
        this.h[0] = h0;
        this.h[1] = h1;
        this.h[2] = h2;
        this.h[3] = h3;
        this.h[4] = h4;
        this.h[5] = h5;
        this.h[6] = h6;
        this.h[7] = h7;
        this.h[8] = h8;
        this.h[9] = h9;
      };
      poly1305.prototype.finish = function(mac, macpos) {
        var g = new Uint16Array(10);
        var c, mask, f, i;
        if (this.leftover) {
          i = this.leftover;
          this.buffer[i++] = 1;
          for (; i < 16; i++) this.buffer[i] = 0;
          this.fin = 1;
          this.blocks(this.buffer, 0, 16);
        }
        c = this.h[1] >>> 13;
        this.h[1] &= 8191;
        for (i = 2; i < 10; i++) {
          this.h[i] += c;
          c = this.h[i] >>> 13;
          this.h[i] &= 8191;
        }
        this.h[0] += c * 5;
        c = this.h[0] >>> 13;
        this.h[0] &= 8191;
        this.h[1] += c;
        c = this.h[1] >>> 13;
        this.h[1] &= 8191;
        this.h[2] += c;
        g[0] = this.h[0] + 5;
        c = g[0] >>> 13;
        g[0] &= 8191;
        for (i = 1; i < 10; i++) {
          g[i] = this.h[i] + c;
          c = g[i] >>> 13;
          g[i] &= 8191;
        }
        g[9] -= 1 << 13;
        mask = (c ^ 1) - 1;
        for (i = 0; i < 10; i++) g[i] &= mask;
        mask = ~mask;
        for (i = 0; i < 10; i++) this.h[i] = this.h[i] & mask | g[i];
        this.h[0] = (this.h[0] | this.h[1] << 13) & 65535;
        this.h[1] = (this.h[1] >>> 3 | this.h[2] << 10) & 65535;
        this.h[2] = (this.h[2] >>> 6 | this.h[3] << 7) & 65535;
        this.h[3] = (this.h[3] >>> 9 | this.h[4] << 4) & 65535;
        this.h[4] = (this.h[4] >>> 12 | this.h[5] << 1 | this.h[6] << 14) & 65535;
        this.h[5] = (this.h[6] >>> 2 | this.h[7] << 11) & 65535;
        this.h[6] = (this.h[7] >>> 5 | this.h[8] << 8) & 65535;
        this.h[7] = (this.h[8] >>> 8 | this.h[9] << 5) & 65535;
        f = this.h[0] + this.pad[0];
        this.h[0] = f & 65535;
        for (i = 1; i < 8; i++) {
          f = (this.h[i] + this.pad[i] | 0) + (f >>> 16) | 0;
          this.h[i] = f & 65535;
        }
        mac[macpos + 0] = this.h[0] >>> 0 & 255;
        mac[macpos + 1] = this.h[0] >>> 8 & 255;
        mac[macpos + 2] = this.h[1] >>> 0 & 255;
        mac[macpos + 3] = this.h[1] >>> 8 & 255;
        mac[macpos + 4] = this.h[2] >>> 0 & 255;
        mac[macpos + 5] = this.h[2] >>> 8 & 255;
        mac[macpos + 6] = this.h[3] >>> 0 & 255;
        mac[macpos + 7] = this.h[3] >>> 8 & 255;
        mac[macpos + 8] = this.h[4] >>> 0 & 255;
        mac[macpos + 9] = this.h[4] >>> 8 & 255;
        mac[macpos + 10] = this.h[5] >>> 0 & 255;
        mac[macpos + 11] = this.h[5] >>> 8 & 255;
        mac[macpos + 12] = this.h[6] >>> 0 & 255;
        mac[macpos + 13] = this.h[6] >>> 8 & 255;
        mac[macpos + 14] = this.h[7] >>> 0 & 255;
        mac[macpos + 15] = this.h[7] >>> 8 & 255;
      };
      poly1305.prototype.update = function(m, mpos, bytes) {
        var i, want;
        if (this.leftover) {
          want = 16 - this.leftover;
          if (want > bytes)
            want = bytes;
          for (i = 0; i < want; i++)
            this.buffer[this.leftover + i] = m[mpos + i];
          bytes -= want;
          mpos += want;
          this.leftover += want;
          if (this.leftover < 16)
            return;
          this.blocks(this.buffer, 0, 16);
          this.leftover = 0;
        }
        if (bytes >= 16) {
          want = bytes - bytes % 16;
          this.blocks(m, mpos, want);
          mpos += want;
          bytes -= want;
        }
        if (bytes) {
          for (i = 0; i < bytes; i++)
            this.buffer[this.leftover + i] = m[mpos + i];
          this.leftover += bytes;
        }
      };
      function crypto_onetimeauth(out, outpos, m, mpos, n, k) {
        var s = new poly1305(k);
        s.update(m, mpos, n);
        s.finish(out, outpos);
        return 0;
      }
      function crypto_onetimeauth_verify(h, hpos, m, mpos, n, k) {
        var x = new Uint8Array(16);
        crypto_onetimeauth(x, 0, m, mpos, n, k);
        return crypto_verify_16(h, hpos, x, 0);
      }
      function crypto_secretbox(c, m, d, n, k) {
        var i;
        if (d < 32) return -1;
        crypto_stream_xor(c, 0, m, 0, d, n, k);
        crypto_onetimeauth(c, 16, c, 32, d - 32, c);
        for (i = 0; i < 16; i++) c[i] = 0;
        return 0;
      }
      function crypto_secretbox_open(m, c, d, n, k) {
        var i;
        var x = new Uint8Array(32);
        if (d < 32) return -1;
        crypto_stream(x, 0, 32, n, k);
        if (crypto_onetimeauth_verify(c, 16, c, 32, d - 32, x) !== 0) return -1;
        crypto_stream_xor(m, 0, c, 0, d, n, k);
        for (i = 0; i < 32; i++) m[i] = 0;
        return 0;
      }
      function set25519(r, a) {
        var i;
        for (i = 0; i < 16; i++) r[i] = a[i] | 0;
      }
      function car25519(o) {
        var i, v, c = 1;
        for (i = 0; i < 16; i++) {
          v = o[i] + c + 65535;
          c = Math.floor(v / 65536);
          o[i] = v - c * 65536;
        }
        o[0] += c - 1 + 37 * (c - 1);
      }
      function sel25519(p, q, b) {
        var t, c = ~(b - 1);
        for (var i = 0; i < 16; i++) {
          t = c & (p[i] ^ q[i]);
          p[i] ^= t;
          q[i] ^= t;
        }
      }
      function pack25519(o, n) {
        var i, j, b;
        var m = gf(), t = gf();
        for (i = 0; i < 16; i++) t[i] = n[i];
        car25519(t);
        car25519(t);
        car25519(t);
        for (j = 0; j < 2; j++) {
          m[0] = t[0] - 65517;
          for (i = 1; i < 15; i++) {
            m[i] = t[i] - 65535 - (m[i - 1] >> 16 & 1);
            m[i - 1] &= 65535;
          }
          m[15] = t[15] - 32767 - (m[14] >> 16 & 1);
          b = m[15] >> 16 & 1;
          m[14] &= 65535;
          sel25519(t, m, 1 - b);
        }
        for (i = 0; i < 16; i++) {
          o[2 * i] = t[i] & 255;
          o[2 * i + 1] = t[i] >> 8;
        }
      }
      function neq25519(a, b) {
        var c = new Uint8Array(32), d = new Uint8Array(32);
        pack25519(c, a);
        pack25519(d, b);
        return crypto_verify_32(c, 0, d, 0);
      }
      function par25519(a) {
        var d = new Uint8Array(32);
        pack25519(d, a);
        return d[0] & 1;
      }
      function unpack25519(o, n) {
        var i;
        for (i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
        o[15] &= 32767;
      }
      function A(o, a, b) {
        for (var i = 0; i < 16; i++) o[i] = a[i] + b[i];
      }
      function Z(o, a, b) {
        for (var i = 0; i < 16; i++) o[i] = a[i] - b[i];
      }
      function M(o, a, b) {
        var v, c, t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, t6 = 0, t7 = 0, t8 = 0, t9 = 0, t10 = 0, t11 = 0, t12 = 0, t13 = 0, t14 = 0, t15 = 0, t16 = 0, t17 = 0, t18 = 0, t19 = 0, t20 = 0, t21 = 0, t22 = 0, t23 = 0, t24 = 0, t25 = 0, t26 = 0, t27 = 0, t28 = 0, t29 = 0, t30 = 0, b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11], b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
        v = a[0];
        t0 += v * b0;
        t1 += v * b1;
        t2 += v * b2;
        t3 += v * b3;
        t4 += v * b4;
        t5 += v * b5;
        t6 += v * b6;
        t7 += v * b7;
        t8 += v * b8;
        t9 += v * b9;
        t10 += v * b10;
        t11 += v * b11;
        t12 += v * b12;
        t13 += v * b13;
        t14 += v * b14;
        t15 += v * b15;
        v = a[1];
        t1 += v * b0;
        t2 += v * b1;
        t3 += v * b2;
        t4 += v * b3;
        t5 += v * b4;
        t6 += v * b5;
        t7 += v * b6;
        t8 += v * b7;
        t9 += v * b8;
        t10 += v * b9;
        t11 += v * b10;
        t12 += v * b11;
        t13 += v * b12;
        t14 += v * b13;
        t15 += v * b14;
        t16 += v * b15;
        v = a[2];
        t2 += v * b0;
        t3 += v * b1;
        t4 += v * b2;
        t5 += v * b3;
        t6 += v * b4;
        t7 += v * b5;
        t8 += v * b6;
        t9 += v * b7;
        t10 += v * b8;
        t11 += v * b9;
        t12 += v * b10;
        t13 += v * b11;
        t14 += v * b12;
        t15 += v * b13;
        t16 += v * b14;
        t17 += v * b15;
        v = a[3];
        t3 += v * b0;
        t4 += v * b1;
        t5 += v * b2;
        t6 += v * b3;
        t7 += v * b4;
        t8 += v * b5;
        t9 += v * b6;
        t10 += v * b7;
        t11 += v * b8;
        t12 += v * b9;
        t13 += v * b10;
        t14 += v * b11;
        t15 += v * b12;
        t16 += v * b13;
        t17 += v * b14;
        t18 += v * b15;
        v = a[4];
        t4 += v * b0;
        t5 += v * b1;
        t6 += v * b2;
        t7 += v * b3;
        t8 += v * b4;
        t9 += v * b5;
        t10 += v * b6;
        t11 += v * b7;
        t12 += v * b8;
        t13 += v * b9;
        t14 += v * b10;
        t15 += v * b11;
        t16 += v * b12;
        t17 += v * b13;
        t18 += v * b14;
        t19 += v * b15;
        v = a[5];
        t5 += v * b0;
        t6 += v * b1;
        t7 += v * b2;
        t8 += v * b3;
        t9 += v * b4;
        t10 += v * b5;
        t11 += v * b6;
        t12 += v * b7;
        t13 += v * b8;
        t14 += v * b9;
        t15 += v * b10;
        t16 += v * b11;
        t17 += v * b12;
        t18 += v * b13;
        t19 += v * b14;
        t20 += v * b15;
        v = a[6];
        t6 += v * b0;
        t7 += v * b1;
        t8 += v * b2;
        t9 += v * b3;
        t10 += v * b4;
        t11 += v * b5;
        t12 += v * b6;
        t13 += v * b7;
        t14 += v * b8;
        t15 += v * b9;
        t16 += v * b10;
        t17 += v * b11;
        t18 += v * b12;
        t19 += v * b13;
        t20 += v * b14;
        t21 += v * b15;
        v = a[7];
        t7 += v * b0;
        t8 += v * b1;
        t9 += v * b2;
        t10 += v * b3;
        t11 += v * b4;
        t12 += v * b5;
        t13 += v * b6;
        t14 += v * b7;
        t15 += v * b8;
        t16 += v * b9;
        t17 += v * b10;
        t18 += v * b11;
        t19 += v * b12;
        t20 += v * b13;
        t21 += v * b14;
        t22 += v * b15;
        v = a[8];
        t8 += v * b0;
        t9 += v * b1;
        t10 += v * b2;
        t11 += v * b3;
        t12 += v * b4;
        t13 += v * b5;
        t14 += v * b6;
        t15 += v * b7;
        t16 += v * b8;
        t17 += v * b9;
        t18 += v * b10;
        t19 += v * b11;
        t20 += v * b12;
        t21 += v * b13;
        t22 += v * b14;
        t23 += v * b15;
        v = a[9];
        t9 += v * b0;
        t10 += v * b1;
        t11 += v * b2;
        t12 += v * b3;
        t13 += v * b4;
        t14 += v * b5;
        t15 += v * b6;
        t16 += v * b7;
        t17 += v * b8;
        t18 += v * b9;
        t19 += v * b10;
        t20 += v * b11;
        t21 += v * b12;
        t22 += v * b13;
        t23 += v * b14;
        t24 += v * b15;
        v = a[10];
        t10 += v * b0;
        t11 += v * b1;
        t12 += v * b2;
        t13 += v * b3;
        t14 += v * b4;
        t15 += v * b5;
        t16 += v * b6;
        t17 += v * b7;
        t18 += v * b8;
        t19 += v * b9;
        t20 += v * b10;
        t21 += v * b11;
        t22 += v * b12;
        t23 += v * b13;
        t24 += v * b14;
        t25 += v * b15;
        v = a[11];
        t11 += v * b0;
        t12 += v * b1;
        t13 += v * b2;
        t14 += v * b3;
        t15 += v * b4;
        t16 += v * b5;
        t17 += v * b6;
        t18 += v * b7;
        t19 += v * b8;
        t20 += v * b9;
        t21 += v * b10;
        t22 += v * b11;
        t23 += v * b12;
        t24 += v * b13;
        t25 += v * b14;
        t26 += v * b15;
        v = a[12];
        t12 += v * b0;
        t13 += v * b1;
        t14 += v * b2;
        t15 += v * b3;
        t16 += v * b4;
        t17 += v * b5;
        t18 += v * b6;
        t19 += v * b7;
        t20 += v * b8;
        t21 += v * b9;
        t22 += v * b10;
        t23 += v * b11;
        t24 += v * b12;
        t25 += v * b13;
        t26 += v * b14;
        t27 += v * b15;
        v = a[13];
        t13 += v * b0;
        t14 += v * b1;
        t15 += v * b2;
        t16 += v * b3;
        t17 += v * b4;
        t18 += v * b5;
        t19 += v * b6;
        t20 += v * b7;
        t21 += v * b8;
        t22 += v * b9;
        t23 += v * b10;
        t24 += v * b11;
        t25 += v * b12;
        t26 += v * b13;
        t27 += v * b14;
        t28 += v * b15;
        v = a[14];
        t14 += v * b0;
        t15 += v * b1;
        t16 += v * b2;
        t17 += v * b3;
        t18 += v * b4;
        t19 += v * b5;
        t20 += v * b6;
        t21 += v * b7;
        t22 += v * b8;
        t23 += v * b9;
        t24 += v * b10;
        t25 += v * b11;
        t26 += v * b12;
        t27 += v * b13;
        t28 += v * b14;
        t29 += v * b15;
        v = a[15];
        t15 += v * b0;
        t16 += v * b1;
        t17 += v * b2;
        t18 += v * b3;
        t19 += v * b4;
        t20 += v * b5;
        t21 += v * b6;
        t22 += v * b7;
        t23 += v * b8;
        t24 += v * b9;
        t25 += v * b10;
        t26 += v * b11;
        t27 += v * b12;
        t28 += v * b13;
        t29 += v * b14;
        t30 += v * b15;
        t0 += 38 * t16;
        t1 += 38 * t17;
        t2 += 38 * t18;
        t3 += 38 * t19;
        t4 += 38 * t20;
        t5 += 38 * t21;
        t6 += 38 * t22;
        t7 += 38 * t23;
        t8 += 38 * t24;
        t9 += 38 * t25;
        t10 += 38 * t26;
        t11 += 38 * t27;
        t12 += 38 * t28;
        t13 += 38 * t29;
        t14 += 38 * t30;
        c = 1;
        v = t0 + c + 65535;
        c = Math.floor(v / 65536);
        t0 = v - c * 65536;
        v = t1 + c + 65535;
        c = Math.floor(v / 65536);
        t1 = v - c * 65536;
        v = t2 + c + 65535;
        c = Math.floor(v / 65536);
        t2 = v - c * 65536;
        v = t3 + c + 65535;
        c = Math.floor(v / 65536);
        t3 = v - c * 65536;
        v = t4 + c + 65535;
        c = Math.floor(v / 65536);
        t4 = v - c * 65536;
        v = t5 + c + 65535;
        c = Math.floor(v / 65536);
        t5 = v - c * 65536;
        v = t6 + c + 65535;
        c = Math.floor(v / 65536);
        t6 = v - c * 65536;
        v = t7 + c + 65535;
        c = Math.floor(v / 65536);
        t7 = v - c * 65536;
        v = t8 + c + 65535;
        c = Math.floor(v / 65536);
        t8 = v - c * 65536;
        v = t9 + c + 65535;
        c = Math.floor(v / 65536);
        t9 = v - c * 65536;
        v = t10 + c + 65535;
        c = Math.floor(v / 65536);
        t10 = v - c * 65536;
        v = t11 + c + 65535;
        c = Math.floor(v / 65536);
        t11 = v - c * 65536;
        v = t12 + c + 65535;
        c = Math.floor(v / 65536);
        t12 = v - c * 65536;
        v = t13 + c + 65535;
        c = Math.floor(v / 65536);
        t13 = v - c * 65536;
        v = t14 + c + 65535;
        c = Math.floor(v / 65536);
        t14 = v - c * 65536;
        v = t15 + c + 65535;
        c = Math.floor(v / 65536);
        t15 = v - c * 65536;
        t0 += c - 1 + 37 * (c - 1);
        c = 1;
        v = t0 + c + 65535;
        c = Math.floor(v / 65536);
        t0 = v - c * 65536;
        v = t1 + c + 65535;
        c = Math.floor(v / 65536);
        t1 = v - c * 65536;
        v = t2 + c + 65535;
        c = Math.floor(v / 65536);
        t2 = v - c * 65536;
        v = t3 + c + 65535;
        c = Math.floor(v / 65536);
        t3 = v - c * 65536;
        v = t4 + c + 65535;
        c = Math.floor(v / 65536);
        t4 = v - c * 65536;
        v = t5 + c + 65535;
        c = Math.floor(v / 65536);
        t5 = v - c * 65536;
        v = t6 + c + 65535;
        c = Math.floor(v / 65536);
        t6 = v - c * 65536;
        v = t7 + c + 65535;
        c = Math.floor(v / 65536);
        t7 = v - c * 65536;
        v = t8 + c + 65535;
        c = Math.floor(v / 65536);
        t8 = v - c * 65536;
        v = t9 + c + 65535;
        c = Math.floor(v / 65536);
        t9 = v - c * 65536;
        v = t10 + c + 65535;
        c = Math.floor(v / 65536);
        t10 = v - c * 65536;
        v = t11 + c + 65535;
        c = Math.floor(v / 65536);
        t11 = v - c * 65536;
        v = t12 + c + 65535;
        c = Math.floor(v / 65536);
        t12 = v - c * 65536;
        v = t13 + c + 65535;
        c = Math.floor(v / 65536);
        t13 = v - c * 65536;
        v = t14 + c + 65535;
        c = Math.floor(v / 65536);
        t14 = v - c * 65536;
        v = t15 + c + 65535;
        c = Math.floor(v / 65536);
        t15 = v - c * 65536;
        t0 += c - 1 + 37 * (c - 1);
        o[0] = t0;
        o[1] = t1;
        o[2] = t2;
        o[3] = t3;
        o[4] = t4;
        o[5] = t5;
        o[6] = t6;
        o[7] = t7;
        o[8] = t8;
        o[9] = t9;
        o[10] = t10;
        o[11] = t11;
        o[12] = t12;
        o[13] = t13;
        o[14] = t14;
        o[15] = t15;
      }
      function S(o, a) {
        M(o, a, a);
      }
      function inv25519(o, i) {
        var c = gf();
        var a;
        for (a = 0; a < 16; a++) c[a] = i[a];
        for (a = 253; a >= 0; a--) {
          S(c, c);
          if (a !== 2 && a !== 4) M(c, c, i);
        }
        for (a = 0; a < 16; a++) o[a] = c[a];
      }
      function pow2523(o, i) {
        var c = gf();
        var a;
        for (a = 0; a < 16; a++) c[a] = i[a];
        for (a = 250; a >= 0; a--) {
          S(c, c);
          if (a !== 1) M(c, c, i);
        }
        for (a = 0; a < 16; a++) o[a] = c[a];
      }
      function crypto_scalarmult(q, n, p) {
        var z = new Uint8Array(32);
        var x = new Float64Array(80), r, i;
        var a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf();
        for (i = 0; i < 31; i++) z[i] = n[i];
        z[31] = n[31] & 127 | 64;
        z[0] &= 248;
        unpack25519(x, p);
        for (i = 0; i < 16; i++) {
          b[i] = x[i];
          d[i] = a[i] = c[i] = 0;
        }
        a[0] = d[0] = 1;
        for (i = 254; i >= 0; --i) {
          r = z[i >>> 3] >>> (i & 7) & 1;
          sel25519(a, b, r);
          sel25519(c, d, r);
          A(e, a, c);
          Z(a, a, c);
          A(c, b, d);
          Z(b, b, d);
          S(d, e);
          S(f, a);
          M(a, c, a);
          M(c, b, e);
          A(e, a, c);
          Z(a, a, c);
          S(b, a);
          Z(c, d, f);
          M(a, c, _121665);
          A(a, a, d);
          M(c, c, a);
          M(a, d, f);
          M(d, b, x);
          S(b, e);
          sel25519(a, b, r);
          sel25519(c, d, r);
        }
        for (i = 0; i < 16; i++) {
          x[i + 16] = a[i];
          x[i + 32] = c[i];
          x[i + 48] = b[i];
          x[i + 64] = d[i];
        }
        var x32 = x.subarray(32);
        var x16 = x.subarray(16);
        inv25519(x32, x32);
        M(x16, x16, x32);
        pack25519(q, x16);
        return 0;
      }
      function crypto_scalarmult_base(q, n) {
        return crypto_scalarmult(q, n, _9);
      }
      function crypto_box_keypair(y, x) {
        randombytes(x, 32);
        return crypto_scalarmult_base(y, x);
      }
      function crypto_box_beforenm(k, y, x) {
        var s = new Uint8Array(32);
        crypto_scalarmult(s, x, y);
        return crypto_core_hsalsa20(k, _0, s, sigma);
      }
      var crypto_box_afternm = crypto_secretbox;
      var crypto_box_open_afternm = crypto_secretbox_open;
      function crypto_box(c, m, d, n, y, x) {
        var k = new Uint8Array(32);
        crypto_box_beforenm(k, y, x);
        return crypto_box_afternm(c, m, d, n, k);
      }
      function crypto_box_open(m, c, d, n, y, x) {
        var k = new Uint8Array(32);
        crypto_box_beforenm(k, y, x);
        return crypto_box_open_afternm(m, c, d, n, k);
      }
      var K2 = [
        1116352408,
        3609767458,
        1899447441,
        602891725,
        3049323471,
        3964484399,
        3921009573,
        2173295548,
        961987163,
        4081628472,
        1508970993,
        3053834265,
        2453635748,
        2937671579,
        2870763221,
        3664609560,
        3624381080,
        2734883394,
        310598401,
        1164996542,
        607225278,
        1323610764,
        1426881987,
        3590304994,
        1925078388,
        4068182383,
        2162078206,
        991336113,
        2614888103,
        633803317,
        3248222580,
        3479774868,
        3835390401,
        2666613458,
        4022224774,
        944711139,
        264347078,
        2341262773,
        604807628,
        2007800933,
        770255983,
        1495990901,
        1249150122,
        1856431235,
        1555081692,
        3175218132,
        1996064986,
        2198950837,
        2554220882,
        3999719339,
        2821834349,
        766784016,
        2952996808,
        2566594879,
        3210313671,
        3203337956,
        3336571891,
        1034457026,
        3584528711,
        2466948901,
        113926993,
        3758326383,
        338241895,
        168717936,
        666307205,
        1188179964,
        773529912,
        1546045734,
        1294757372,
        1522805485,
        1396182291,
        2643833823,
        1695183700,
        2343527390,
        1986661051,
        1014477480,
        2177026350,
        1206759142,
        2456956037,
        344077627,
        2730485921,
        1290863460,
        2820302411,
        3158454273,
        3259730800,
        3505952657,
        3345764771,
        106217008,
        3516065817,
        3606008344,
        3600352804,
        1432725776,
        4094571909,
        1467031594,
        275423344,
        851169720,
        430227734,
        3100823752,
        506948616,
        1363258195,
        659060556,
        3750685593,
        883997877,
        3785050280,
        958139571,
        3318307427,
        1322822218,
        3812723403,
        1537002063,
        2003034995,
        1747873779,
        3602036899,
        1955562222,
        1575990012,
        2024104815,
        1125592928,
        2227730452,
        2716904306,
        2361852424,
        442776044,
        2428436474,
        593698344,
        2756734187,
        3733110249,
        3204031479,
        2999351573,
        3329325298,
        3815920427,
        3391569614,
        3928383900,
        3515267271,
        566280711,
        3940187606,
        3454069534,
        4118630271,
        4000239992,
        116418474,
        1914138554,
        174292421,
        2731055270,
        289380356,
        3203993006,
        460393269,
        320620315,
        685471733,
        587496836,
        852142971,
        1086792851,
        1017036298,
        365543100,
        1126000580,
        2618297676,
        1288033470,
        3409855158,
        1501505948,
        4234509866,
        1607167915,
        987167468,
        1816402316,
        1246189591
      ];
      function crypto_hashblocks_hl(hh, hl, m, n) {
        var wh = new Int32Array(16), wl = new Int32Array(16), bh0, bh1, bh2, bh3, bh4, bh5, bh6, bh7, bl0, bl1, bl2, bl3, bl4, bl5, bl6, bl7, th, tl, i, j, h, l, a, b, c, d;
        var ah0 = hh[0], ah1 = hh[1], ah2 = hh[2], ah3 = hh[3], ah4 = hh[4], ah5 = hh[5], ah6 = hh[6], ah7 = hh[7], al0 = hl[0], al1 = hl[1], al2 = hl[2], al3 = hl[3], al4 = hl[4], al5 = hl[5], al6 = hl[6], al7 = hl[7];
        var pos = 0;
        while (n >= 128) {
          for (i = 0; i < 16; i++) {
            j = 8 * i + pos;
            wh[i] = m[j + 0] << 24 | m[j + 1] << 16 | m[j + 2] << 8 | m[j + 3];
            wl[i] = m[j + 4] << 24 | m[j + 5] << 16 | m[j + 6] << 8 | m[j + 7];
          }
          for (i = 0; i < 80; i++) {
            bh0 = ah0;
            bh1 = ah1;
            bh2 = ah2;
            bh3 = ah3;
            bh4 = ah4;
            bh5 = ah5;
            bh6 = ah6;
            bh7 = ah7;
            bl0 = al0;
            bl1 = al1;
            bl2 = al2;
            bl3 = al3;
            bl4 = al4;
            bl5 = al5;
            bl6 = al6;
            bl7 = al7;
            h = ah7;
            l = al7;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = (ah4 >>> 14 | al4 << 32 - 14) ^ (ah4 >>> 18 | al4 << 32 - 18) ^ (al4 >>> 41 - 32 | ah4 << 32 - (41 - 32));
            l = (al4 >>> 14 | ah4 << 32 - 14) ^ (al4 >>> 18 | ah4 << 32 - 18) ^ (ah4 >>> 41 - 32 | al4 << 32 - (41 - 32));
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = ah4 & ah5 ^ ~ah4 & ah6;
            l = al4 & al5 ^ ~al4 & al6;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = K2[i * 2];
            l = K2[i * 2 + 1];
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = wh[i % 16];
            l = wl[i % 16];
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            th = c & 65535 | d << 16;
            tl = a & 65535 | b << 16;
            h = th;
            l = tl;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = (ah0 >>> 28 | al0 << 32 - 28) ^ (al0 >>> 34 - 32 | ah0 << 32 - (34 - 32)) ^ (al0 >>> 39 - 32 | ah0 << 32 - (39 - 32));
            l = (al0 >>> 28 | ah0 << 32 - 28) ^ (ah0 >>> 34 - 32 | al0 << 32 - (34 - 32)) ^ (ah0 >>> 39 - 32 | al0 << 32 - (39 - 32));
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            h = ah0 & ah1 ^ ah0 & ah2 ^ ah1 & ah2;
            l = al0 & al1 ^ al0 & al2 ^ al1 & al2;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            bh7 = c & 65535 | d << 16;
            bl7 = a & 65535 | b << 16;
            h = bh3;
            l = bl3;
            a = l & 65535;
            b = l >>> 16;
            c = h & 65535;
            d = h >>> 16;
            h = th;
            l = tl;
            a += l & 65535;
            b += l >>> 16;
            c += h & 65535;
            d += h >>> 16;
            b += a >>> 16;
            c += b >>> 16;
            d += c >>> 16;
            bh3 = c & 65535 | d << 16;
            bl3 = a & 65535 | b << 16;
            ah1 = bh0;
            ah2 = bh1;
            ah3 = bh2;
            ah4 = bh3;
            ah5 = bh4;
            ah6 = bh5;
            ah7 = bh6;
            ah0 = bh7;
            al1 = bl0;
            al2 = bl1;
            al3 = bl2;
            al4 = bl3;
            al5 = bl4;
            al6 = bl5;
            al7 = bl6;
            al0 = bl7;
            if (i % 16 === 15) {
              for (j = 0; j < 16; j++) {
                h = wh[j];
                l = wl[j];
                a = l & 65535;
                b = l >>> 16;
                c = h & 65535;
                d = h >>> 16;
                h = wh[(j + 9) % 16];
                l = wl[(j + 9) % 16];
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                th = wh[(j + 1) % 16];
                tl = wl[(j + 1) % 16];
                h = (th >>> 1 | tl << 32 - 1) ^ (th >>> 8 | tl << 32 - 8) ^ th >>> 7;
                l = (tl >>> 1 | th << 32 - 1) ^ (tl >>> 8 | th << 32 - 8) ^ (tl >>> 7 | th << 32 - 7);
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                th = wh[(j + 14) % 16];
                tl = wl[(j + 14) % 16];
                h = (th >>> 19 | tl << 32 - 19) ^ (tl >>> 61 - 32 | th << 32 - (61 - 32)) ^ th >>> 6;
                l = (tl >>> 19 | th << 32 - 19) ^ (th >>> 61 - 32 | tl << 32 - (61 - 32)) ^ (tl >>> 6 | th << 32 - 6);
                a += l & 65535;
                b += l >>> 16;
                c += h & 65535;
                d += h >>> 16;
                b += a >>> 16;
                c += b >>> 16;
                d += c >>> 16;
                wh[j] = c & 65535 | d << 16;
                wl[j] = a & 65535 | b << 16;
              }
            }
          }
          h = ah0;
          l = al0;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[0];
          l = hl[0];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[0] = ah0 = c & 65535 | d << 16;
          hl[0] = al0 = a & 65535 | b << 16;
          h = ah1;
          l = al1;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[1];
          l = hl[1];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[1] = ah1 = c & 65535 | d << 16;
          hl[1] = al1 = a & 65535 | b << 16;
          h = ah2;
          l = al2;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[2];
          l = hl[2];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[2] = ah2 = c & 65535 | d << 16;
          hl[2] = al2 = a & 65535 | b << 16;
          h = ah3;
          l = al3;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[3];
          l = hl[3];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[3] = ah3 = c & 65535 | d << 16;
          hl[3] = al3 = a & 65535 | b << 16;
          h = ah4;
          l = al4;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[4];
          l = hl[4];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[4] = ah4 = c & 65535 | d << 16;
          hl[4] = al4 = a & 65535 | b << 16;
          h = ah5;
          l = al5;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[5];
          l = hl[5];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[5] = ah5 = c & 65535 | d << 16;
          hl[5] = al5 = a & 65535 | b << 16;
          h = ah6;
          l = al6;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[6];
          l = hl[6];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[6] = ah6 = c & 65535 | d << 16;
          hl[6] = al6 = a & 65535 | b << 16;
          h = ah7;
          l = al7;
          a = l & 65535;
          b = l >>> 16;
          c = h & 65535;
          d = h >>> 16;
          h = hh[7];
          l = hl[7];
          a += l & 65535;
          b += l >>> 16;
          c += h & 65535;
          d += h >>> 16;
          b += a >>> 16;
          c += b >>> 16;
          d += c >>> 16;
          hh[7] = ah7 = c & 65535 | d << 16;
          hl[7] = al7 = a & 65535 | b << 16;
          pos += 128;
          n -= 128;
        }
        return n;
      }
      function crypto_hash(out, m, n) {
        var hh = new Int32Array(8), hl = new Int32Array(8), x = new Uint8Array(256), i, b = n;
        hh[0] = 1779033703;
        hh[1] = 3144134277;
        hh[2] = 1013904242;
        hh[3] = 2773480762;
        hh[4] = 1359893119;
        hh[5] = 2600822924;
        hh[6] = 528734635;
        hh[7] = 1541459225;
        hl[0] = 4089235720;
        hl[1] = 2227873595;
        hl[2] = 4271175723;
        hl[3] = 1595750129;
        hl[4] = 2917565137;
        hl[5] = 725511199;
        hl[6] = 4215389547;
        hl[7] = 327033209;
        crypto_hashblocks_hl(hh, hl, m, n);
        n %= 128;
        for (i = 0; i < n; i++) x[i] = m[b - n + i];
        x[n] = 128;
        n = 256 - 128 * (n < 112 ? 1 : 0);
        x[n - 9] = 0;
        ts64(x, n - 8, b / 536870912 | 0, b << 3);
        crypto_hashblocks_hl(hh, hl, x, n);
        for (i = 0; i < 8; i++) ts64(out, 8 * i, hh[i], hl[i]);
        return 0;
      }
      function add(p, q) {
        var a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), g = gf(), h = gf(), t = gf();
        Z(a, p[1], p[0]);
        Z(t, q[1], q[0]);
        M(a, a, t);
        A(b, p[0], p[1]);
        A(t, q[0], q[1]);
        M(b, b, t);
        M(c, p[3], q[3]);
        M(c, c, D2);
        M(d, p[2], q[2]);
        A(d, d, d);
        Z(e, b, a);
        Z(f, d, c);
        A(g, d, c);
        A(h, b, a);
        M(p[0], e, f);
        M(p[1], h, g);
        M(p[2], g, f);
        M(p[3], e, h);
      }
      function cswap(p, q, b) {
        var i;
        for (i = 0; i < 4; i++) {
          sel25519(p[i], q[i], b);
        }
      }
      function pack(r, p) {
        var tx = gf(), ty = gf(), zi = gf();
        inv25519(zi, p[2]);
        M(tx, p[0], zi);
        M(ty, p[1], zi);
        pack25519(r, ty);
        r[31] ^= par25519(tx) << 7;
      }
      function scalarmult(p, q, s) {
        var b, i;
        set25519(p[0], gf0);
        set25519(p[1], gf1);
        set25519(p[2], gf1);
        set25519(p[3], gf0);
        for (i = 255; i >= 0; --i) {
          b = s[i / 8 | 0] >> (i & 7) & 1;
          cswap(p, q, b);
          add(q, p);
          add(p, p);
          cswap(p, q, b);
        }
      }
      function scalarbase(p, s) {
        var q = [gf(), gf(), gf(), gf()];
        set25519(q[0], X);
        set25519(q[1], Y);
        set25519(q[2], gf1);
        M(q[3], X, Y);
        scalarmult(p, q, s);
      }
      function crypto_sign_keypair(pk, sk, seeded) {
        var d = new Uint8Array(64);
        var p = [gf(), gf(), gf(), gf()];
        var i;
        if (!seeded) randombytes(sk, 32);
        crypto_hash(d, sk, 32);
        d[0] &= 248;
        d[31] &= 127;
        d[31] |= 64;
        scalarbase(p, d);
        pack(pk, p);
        for (i = 0; i < 32; i++) sk[i + 32] = pk[i];
        return 0;
      }
      var L = new Float64Array([237, 211, 245, 92, 26, 99, 18, 88, 214, 156, 247, 162, 222, 249, 222, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16]);
      function modL(r, x) {
        var carry, i, j, k;
        for (i = 63; i >= 32; --i) {
          carry = 0;
          for (j = i - 32, k = i - 12; j < k; ++j) {
            x[j] += carry - 16 * x[i] * L[j - (i - 32)];
            carry = Math.floor((x[j] + 128) / 256);
            x[j] -= carry * 256;
          }
          x[j] += carry;
          x[i] = 0;
        }
        carry = 0;
        for (j = 0; j < 32; j++) {
          x[j] += carry - (x[31] >> 4) * L[j];
          carry = x[j] >> 8;
          x[j] &= 255;
        }
        for (j = 0; j < 32; j++) x[j] -= carry * L[j];
        for (i = 0; i < 32; i++) {
          x[i + 1] += x[i] >> 8;
          r[i] = x[i] & 255;
        }
      }
      function reduce(r) {
        var x = new Float64Array(64), i;
        for (i = 0; i < 64; i++) x[i] = r[i];
        for (i = 0; i < 64; i++) r[i] = 0;
        modL(r, x);
      }
      function crypto_sign(sm, m, n, sk) {
        var d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
        var i, j, x = new Float64Array(64);
        var p = [gf(), gf(), gf(), gf()];
        crypto_hash(d, sk, 32);
        d[0] &= 248;
        d[31] &= 127;
        d[31] |= 64;
        var smlen = n + 64;
        for (i = 0; i < n; i++) sm[64 + i] = m[i];
        for (i = 0; i < 32; i++) sm[32 + i] = d[32 + i];
        crypto_hash(r, sm.subarray(32), n + 32);
        reduce(r);
        scalarbase(p, r);
        pack(sm, p);
        for (i = 32; i < 64; i++) sm[i] = sk[i];
        crypto_hash(h, sm, n + 64);
        reduce(h);
        for (i = 0; i < 64; i++) x[i] = 0;
        for (i = 0; i < 32; i++) x[i] = r[i];
        for (i = 0; i < 32; i++) {
          for (j = 0; j < 32; j++) {
            x[i + j] += h[i] * d[j];
          }
        }
        modL(sm.subarray(32), x);
        return smlen;
      }
      function unpackneg(r, p) {
        var t = gf(), chk = gf(), num = gf(), den = gf(), den2 = gf(), den4 = gf(), den6 = gf();
        set25519(r[2], gf1);
        unpack25519(r[1], p);
        S(num, r[1]);
        M(den, num, D);
        Z(num, num, r[2]);
        A(den, r[2], den);
        S(den2, den);
        S(den4, den2);
        M(den6, den4, den2);
        M(t, den6, num);
        M(t, t, den);
        pow2523(t, t);
        M(t, t, num);
        M(t, t, den);
        M(t, t, den);
        M(r[0], t, den);
        S(chk, r[0]);
        M(chk, chk, den);
        if (neq25519(chk, num)) M(r[0], r[0], I);
        S(chk, r[0]);
        M(chk, chk, den);
        if (neq25519(chk, num)) return -1;
        if (par25519(r[0]) === p[31] >> 7) Z(r[0], gf0, r[0]);
        M(r[3], r[0], r[1]);
        return 0;
      }
      function crypto_sign_open(m, sm, n, pk) {
        var i;
        var t = new Uint8Array(32), h = new Uint8Array(64);
        var p = [gf(), gf(), gf(), gf()], q = [gf(), gf(), gf(), gf()];
        if (n < 64) return -1;
        if (unpackneg(q, pk)) return -1;
        for (i = 0; i < n; i++) m[i] = sm[i];
        for (i = 0; i < 32; i++) m[i + 32] = pk[i];
        crypto_hash(h, m, n);
        reduce(h);
        scalarmult(p, q, h);
        scalarbase(q, sm.subarray(32));
        add(p, q);
        pack(t, p);
        n -= 64;
        if (crypto_verify_32(sm, 0, t, 0)) {
          for (i = 0; i < n; i++) m[i] = 0;
          return -1;
        }
        for (i = 0; i < n; i++) m[i] = sm[i + 64];
        return n;
      }
      var crypto_secretbox_KEYBYTES = 32, crypto_secretbox_NONCEBYTES = 24, crypto_secretbox_ZEROBYTES = 32, crypto_secretbox_BOXZEROBYTES = 16, crypto_scalarmult_BYTES = 32, crypto_scalarmult_SCALARBYTES = 32, crypto_box_PUBLICKEYBYTES = 32, crypto_box_SECRETKEYBYTES = 32, crypto_box_BEFORENMBYTES = 32, crypto_box_NONCEBYTES = crypto_secretbox_NONCEBYTES, crypto_box_ZEROBYTES = crypto_secretbox_ZEROBYTES, crypto_box_BOXZEROBYTES = crypto_secretbox_BOXZEROBYTES, crypto_sign_BYTES = 64, crypto_sign_PUBLICKEYBYTES = 32, crypto_sign_SECRETKEYBYTES = 64, crypto_sign_SEEDBYTES = 32, crypto_hash_BYTES = 64;
      nacl3.lowlevel = {
        crypto_core_hsalsa20,
        crypto_stream_xor,
        crypto_stream,
        crypto_stream_salsa20_xor,
        crypto_stream_salsa20,
        crypto_onetimeauth,
        crypto_onetimeauth_verify,
        crypto_verify_16,
        crypto_verify_32,
        crypto_secretbox,
        crypto_secretbox_open,
        crypto_scalarmult,
        crypto_scalarmult_base,
        crypto_box_beforenm,
        crypto_box_afternm,
        crypto_box,
        crypto_box_open,
        crypto_box_keypair,
        crypto_hash,
        crypto_sign,
        crypto_sign_keypair,
        crypto_sign_open,
        crypto_secretbox_KEYBYTES,
        crypto_secretbox_NONCEBYTES,
        crypto_secretbox_ZEROBYTES,
        crypto_secretbox_BOXZEROBYTES,
        crypto_scalarmult_BYTES,
        crypto_scalarmult_SCALARBYTES,
        crypto_box_PUBLICKEYBYTES,
        crypto_box_SECRETKEYBYTES,
        crypto_box_BEFORENMBYTES,
        crypto_box_NONCEBYTES,
        crypto_box_ZEROBYTES,
        crypto_box_BOXZEROBYTES,
        crypto_sign_BYTES,
        crypto_sign_PUBLICKEYBYTES,
        crypto_sign_SECRETKEYBYTES,
        crypto_sign_SEEDBYTES,
        crypto_hash_BYTES,
        gf,
        D,
        L,
        pack25519,
        unpack25519,
        M,
        A,
        S,
        Z,
        pow2523,
        add,
        set25519,
        modL,
        scalarmult,
        scalarbase
      };
      function checkLengths(k, n) {
        if (k.length !== crypto_secretbox_KEYBYTES) throw new Error("bad key size");
        if (n.length !== crypto_secretbox_NONCEBYTES) throw new Error("bad nonce size");
      }
      function checkBoxLengths(pk, sk) {
        if (pk.length !== crypto_box_PUBLICKEYBYTES) throw new Error("bad public key size");
        if (sk.length !== crypto_box_SECRETKEYBYTES) throw new Error("bad secret key size");
      }
      function checkArrayTypes() {
        for (var i = 0; i < arguments.length; i++) {
          if (!(arguments[i] instanceof Uint8Array))
            throw new TypeError("unexpected type, use Uint8Array");
        }
      }
      function cleanup(arr) {
        for (var i = 0; i < arr.length; i++) arr[i] = 0;
      }
      nacl3.randomBytes = function(n) {
        var b = new Uint8Array(n);
        randombytes(b, n);
        return b;
      };
      nacl3.secretbox = function(msg, nonce, key) {
        checkArrayTypes(msg, nonce, key);
        checkLengths(key, nonce);
        var m = new Uint8Array(crypto_secretbox_ZEROBYTES + msg.length);
        var c = new Uint8Array(m.length);
        for (var i = 0; i < msg.length; i++) m[i + crypto_secretbox_ZEROBYTES] = msg[i];
        crypto_secretbox(c, m, m.length, nonce, key);
        return c.subarray(crypto_secretbox_BOXZEROBYTES);
      };
      nacl3.secretbox.open = function(box, nonce, key) {
        checkArrayTypes(box, nonce, key);
        checkLengths(key, nonce);
        var c = new Uint8Array(crypto_secretbox_BOXZEROBYTES + box.length);
        var m = new Uint8Array(c.length);
        for (var i = 0; i < box.length; i++) c[i + crypto_secretbox_BOXZEROBYTES] = box[i];
        if (c.length < 32) return null;
        if (crypto_secretbox_open(m, c, c.length, nonce, key) !== 0) return null;
        return m.subarray(crypto_secretbox_ZEROBYTES);
      };
      nacl3.secretbox.keyLength = crypto_secretbox_KEYBYTES;
      nacl3.secretbox.nonceLength = crypto_secretbox_NONCEBYTES;
      nacl3.secretbox.overheadLength = crypto_secretbox_BOXZEROBYTES;
      nacl3.scalarMult = function(n, p) {
        checkArrayTypes(n, p);
        if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error("bad n size");
        if (p.length !== crypto_scalarmult_BYTES) throw new Error("bad p size");
        var q = new Uint8Array(crypto_scalarmult_BYTES);
        crypto_scalarmult(q, n, p);
        return q;
      };
      nacl3.scalarMult.base = function(n) {
        checkArrayTypes(n);
        if (n.length !== crypto_scalarmult_SCALARBYTES) throw new Error("bad n size");
        var q = new Uint8Array(crypto_scalarmult_BYTES);
        crypto_scalarmult_base(q, n);
        return q;
      };
      nacl3.scalarMult.scalarLength = crypto_scalarmult_SCALARBYTES;
      nacl3.scalarMult.groupElementLength = crypto_scalarmult_BYTES;
      nacl3.box = function(msg, nonce, publicKey, secretKey) {
        var k = nacl3.box.before(publicKey, secretKey);
        return nacl3.secretbox(msg, nonce, k);
      };
      nacl3.box.before = function(publicKey, secretKey) {
        checkArrayTypes(publicKey, secretKey);
        checkBoxLengths(publicKey, secretKey);
        var k = new Uint8Array(crypto_box_BEFORENMBYTES);
        crypto_box_beforenm(k, publicKey, secretKey);
        return k;
      };
      nacl3.box.after = nacl3.secretbox;
      nacl3.box.open = function(msg, nonce, publicKey, secretKey) {
        var k = nacl3.box.before(publicKey, secretKey);
        return nacl3.secretbox.open(msg, nonce, k);
      };
      nacl3.box.open.after = nacl3.secretbox.open;
      nacl3.box.keyPair = function() {
        var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_box_SECRETKEYBYTES);
        crypto_box_keypair(pk, sk);
        return { publicKey: pk, secretKey: sk };
      };
      nacl3.box.keyPair.fromSecretKey = function(secretKey) {
        checkArrayTypes(secretKey);
        if (secretKey.length !== crypto_box_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var pk = new Uint8Array(crypto_box_PUBLICKEYBYTES);
        crypto_scalarmult_base(pk, secretKey);
        return { publicKey: pk, secretKey: new Uint8Array(secretKey) };
      };
      nacl3.box.publicKeyLength = crypto_box_PUBLICKEYBYTES;
      nacl3.box.secretKeyLength = crypto_box_SECRETKEYBYTES;
      nacl3.box.sharedKeyLength = crypto_box_BEFORENMBYTES;
      nacl3.box.nonceLength = crypto_box_NONCEBYTES;
      nacl3.box.overheadLength = nacl3.secretbox.overheadLength;
      nacl3.sign = function(msg, secretKey) {
        checkArrayTypes(msg, secretKey);
        if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var signedMsg = new Uint8Array(crypto_sign_BYTES + msg.length);
        crypto_sign(signedMsg, msg, msg.length, secretKey);
        return signedMsg;
      };
      nacl3.sign.open = function(signedMsg, publicKey) {
        checkArrayTypes(signedMsg, publicKey);
        if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
          throw new Error("bad public key size");
        var tmp = new Uint8Array(signedMsg.length);
        var mlen = crypto_sign_open(tmp, signedMsg, signedMsg.length, publicKey);
        if (mlen < 0) return null;
        var m = new Uint8Array(mlen);
        for (var i = 0; i < m.length; i++) m[i] = tmp[i];
        return m;
      };
      nacl3.sign.detached = function(msg, secretKey) {
        var signedMsg = nacl3.sign(msg, secretKey);
        var sig = new Uint8Array(crypto_sign_BYTES);
        for (var i = 0; i < sig.length; i++) sig[i] = signedMsg[i];
        return sig;
      };
      nacl3.sign.detached.verify = function(msg, sig, publicKey) {
        checkArrayTypes(msg, sig, publicKey);
        if (sig.length !== crypto_sign_BYTES)
          throw new Error("bad signature size");
        if (publicKey.length !== crypto_sign_PUBLICKEYBYTES)
          throw new Error("bad public key size");
        var sm = new Uint8Array(crypto_sign_BYTES + msg.length);
        var m = new Uint8Array(crypto_sign_BYTES + msg.length);
        var i;
        for (i = 0; i < crypto_sign_BYTES; i++) sm[i] = sig[i];
        for (i = 0; i < msg.length; i++) sm[i + crypto_sign_BYTES] = msg[i];
        return crypto_sign_open(m, sm, sm.length, publicKey) >= 0;
      };
      nacl3.sign.keyPair = function() {
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
        crypto_sign_keypair(pk, sk);
        return { publicKey: pk, secretKey: sk };
      };
      nacl3.sign.keyPair.fromSecretKey = function(secretKey) {
        checkArrayTypes(secretKey);
        if (secretKey.length !== crypto_sign_SECRETKEYBYTES)
          throw new Error("bad secret key size");
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        for (var i = 0; i < pk.length; i++) pk[i] = secretKey[32 + i];
        return { publicKey: pk, secretKey: new Uint8Array(secretKey) };
      };
      nacl3.sign.keyPair.fromSeed = function(seed) {
        checkArrayTypes(seed);
        if (seed.length !== crypto_sign_SEEDBYTES)
          throw new Error("bad seed size");
        var pk = new Uint8Array(crypto_sign_PUBLICKEYBYTES);
        var sk = new Uint8Array(crypto_sign_SECRETKEYBYTES);
        for (var i = 0; i < 32; i++) sk[i] = seed[i];
        crypto_sign_keypair(pk, sk, true);
        return { publicKey: pk, secretKey: sk };
      };
      nacl3.sign.publicKeyLength = crypto_sign_PUBLICKEYBYTES;
      nacl3.sign.secretKeyLength = crypto_sign_SECRETKEYBYTES;
      nacl3.sign.seedLength = crypto_sign_SEEDBYTES;
      nacl3.sign.signatureLength = crypto_sign_BYTES;
      nacl3.hash = function(msg) {
        checkArrayTypes(msg);
        var h = new Uint8Array(crypto_hash_BYTES);
        crypto_hash(h, msg, msg.length);
        return h;
      };
      nacl3.hash.hashLength = crypto_hash_BYTES;
      nacl3.verify = function(x, y) {
        checkArrayTypes(x, y);
        if (x.length === 0 || y.length === 0) return false;
        if (x.length !== y.length) return false;
        return vn(x, 0, y, 0, x.length) === 0 ? true : false;
      };
      nacl3.setPRNG = function(fn) {
        randombytes = fn;
      };
      (function() {
        var crypto2 = typeof self !== "undefined" ? self.crypto || self.msCrypto : null;
        if (crypto2 && crypto2.getRandomValues) {
          var QUOTA = 65536;
          nacl3.setPRNG(function(x, n) {
            var i, v = new Uint8Array(n);
            for (i = 0; i < n; i += QUOTA) {
              crypto2.getRandomValues(v.subarray(i, i + Math.min(n - i, QUOTA)));
            }
            for (i = 0; i < n; i++) x[i] = v[i];
            cleanup(v);
          });
        } else if (typeof __require !== "undefined") {
          crypto2 = require_crypto();
          if (crypto2 && crypto2.randomBytes) {
            nacl3.setPRNG(function(x, n) {
              var i, v = crypto2.randomBytes(n);
              for (i = 0; i < n; i++) x[i] = v[i];
              cleanup(v);
            });
          }
        }
      })();
    })(typeof module !== "undefined" && module.exports ? module.exports : self.nacl = self.nacl || {});
  }
});

// ../../vendor/chisacode-remote/node_modules/base64-js/index.js
var require_base64_js = __commonJS({
  "../../vendor/chisacode-remote/node_modules/base64-js/index.js"(exports) {
    "use strict";
    exports.byteLength = byteLength;
    exports.toByteArray = toByteArray3;
    exports.fromByteArray = fromByteArray3;
    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
    var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i = 0, len = code.length; i < len; ++i) {
      lookup[i] = code[i];
      revLookup[code.charCodeAt(i)] = i;
    }
    var i;
    var len;
    revLookup["-".charCodeAt(0)] = 62;
    revLookup["_".charCodeAt(0)] = 63;
    function getLens(b64) {
      var len2 = b64.length;
      if (len2 % 4 > 0) {
        throw new Error("Invalid string. Length must be a multiple of 4");
      }
      var validLen = b64.indexOf("=");
      if (validLen === -1) validLen = len2;
      var placeHoldersLen = validLen === len2 ? 0 : 4 - validLen % 4;
      return [validLen, placeHoldersLen];
    }
    function byteLength(b64) {
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function _byteLength(b64, validLen, placeHoldersLen) {
      return (validLen + placeHoldersLen) * 3 / 4 - placeHoldersLen;
    }
    function toByteArray3(b64) {
      var tmp;
      var lens = getLens(b64);
      var validLen = lens[0];
      var placeHoldersLen = lens[1];
      var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen));
      var curByte = 0;
      var len2 = placeHoldersLen > 0 ? validLen - 4 : validLen;
      var i2;
      for (i2 = 0; i2 < len2; i2 += 4) {
        tmp = revLookup[b64.charCodeAt(i2)] << 18 | revLookup[b64.charCodeAt(i2 + 1)] << 12 | revLookup[b64.charCodeAt(i2 + 2)] << 6 | revLookup[b64.charCodeAt(i2 + 3)];
        arr[curByte++] = tmp >> 16 & 255;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 2) {
        tmp = revLookup[b64.charCodeAt(i2)] << 2 | revLookup[b64.charCodeAt(i2 + 1)] >> 4;
        arr[curByte++] = tmp & 255;
      }
      if (placeHoldersLen === 1) {
        tmp = revLookup[b64.charCodeAt(i2)] << 10 | revLookup[b64.charCodeAt(i2 + 1)] << 4 | revLookup[b64.charCodeAt(i2 + 2)] >> 2;
        arr[curByte++] = tmp >> 8 & 255;
        arr[curByte++] = tmp & 255;
      }
      return arr;
    }
    function tripletToBase64(num) {
      return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[num & 63];
    }
    function encodeChunk(uint8, start, end) {
      var tmp;
      var output = [];
      for (var i2 = start; i2 < end; i2 += 3) {
        tmp = (uint8[i2] << 16 & 16711680) + (uint8[i2 + 1] << 8 & 65280) + (uint8[i2 + 2] & 255);
        output.push(tripletToBase64(tmp));
      }
      return output.join("");
    }
    function fromByteArray3(uint8) {
      var tmp;
      var len2 = uint8.length;
      var extraBytes = len2 % 3;
      var parts = [];
      var maxChunkLength = 16383;
      for (var i2 = 0, len22 = len2 - extraBytes; i2 < len22; i2 += maxChunkLength) {
        parts.push(encodeChunk(uint8, i2, i2 + maxChunkLength > len22 ? len22 : i2 + maxChunkLength));
      }
      if (extraBytes === 1) {
        tmp = uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 2] + lookup[tmp << 4 & 63] + "=="
        );
      } else if (extraBytes === 2) {
        tmp = (uint8[len2 - 2] << 8) + uint8[len2 - 1];
        parts.push(
          lookup[tmp >> 10] + lookup[tmp >> 4 & 63] + lookup[tmp << 2 & 63] + "="
        );
      }
      return parts.join("");
    }
  }
});

// ../../vendor/chisacode-remote/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../vendor/chisacode-remote/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../vendor/chisacode-remote/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = /* @__PURE__ */ Object.create(null);
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../vendor/chisacode-remote/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../vendor/chisacode-remote/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../vendor/chisacode-remote/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../vendor/chisacode-remote/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../vendor/chisacode-remote/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// vendor/chisacode-remote/packages/protocol/dist/client-capabilities.js
var CLIENT_CAPS = {
  reasoningMergeEnum: "reasoning_merge_enum",
  // COMPAT(customModeIcons): added in v0.1.84. Old clients pin AgentModeIcon to
  // a closed enum and crash rendering unknown values; daemon downgrades icons
  // outside the legacy set to "ShieldCheck" when this cap is absent. Drop the
  // gate when floor >= v0.1.84.
  customModeIcons: "custom_mode_icons",
  // COMPAT(generativeUiWireCapability): added in v0.1.101; remove the gate no earlier than 2027-01-11 when client/daemon floor >= v0.1.101.
  generativeUi: "generative_ui",
  // COMPAT(cindyModules): added in v0.1.102; remove the gate no earlier than 2027-07-29 when client/daemon floor >= v0.1.102.
  cindyModules: "cindy_modules"
};

// vendor/chisacode-remote/packages/protocol/dist/provider-manifest.js
var CLAUDE_MODES = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission the first time a tool is used",
    icon: "ShieldCheck",
    colorTier: "safe"
  },
  {
    id: "auto",
    label: "Auto mode",
    description: "Uses a model classifier to review permission prompts automatically",
    icon: "ShieldQuestionMark",
    colorTier: "moderate"
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves edit-focused tools without prompting",
    icon: "ShieldAlert",
    colorTier: "moderate"
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Analyze the codebase without executing tools or edits",
    icon: "ShieldCheck",
    colorTier: "planning"
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
    icon: "ShieldAlert",
    colorTier: "dangerous",
    isUnattended: true
  }
];
var CODEX_MODES = [
  {
    id: "auto",
    label: "Default Permissions",
    description: "Edit files and run commands with Codex's default approval flow.",
    icon: "ShieldAlert",
    colorTier: "moderate"
  },
  {
    id: "auto-review",
    label: "Auto-review",
    description: "Same workspace-write permissions as Default, but eligible `on-request` approvals are routed through the auto-reviewer subagent.",
    icon: "ShieldQuestionMark",
    colorTier: "moderate"
  },
  {
    id: "full-access",
    label: "Full Access",
    description: "Edit files, run commands, and access the network without additional prompts.",
    icon: "ShieldAlert",
    colorTier: "dangerous",
    isUnattended: true
  }
];
var OPENCODE_MODES = [
  {
    id: "build",
    label: "Build",
    description: "Allows edits and tool execution for implementation work",
    icon: "Bot",
    colorTier: "moderate"
  },
  {
    id: "plan",
    label: "Plan",
    description: "Read-only planning mode that avoids file edits",
    icon: "Bot",
    colorTier: "planning"
  }
];
var MOCK_LOAD_TEST_MODES = [
  {
    id: "load-test",
    label: "Load Test",
    description: "Streams repeated markdown, reasoning, and tool calls for app stress testing",
    icon: "ShieldOff",
    colorTier: "dangerous"
  }
];
var MOCK_SLOW_MODES = [
  {
    id: "default",
    label: "Default",
    description: "Dev-only mode for the mock slow provider",
    icon: "ShieldOff",
    colorTier: "dangerous"
  }
];
var KIMI_MODES = [
  {
    id: "default",
    label: "Default",
    description: "Default Kimi Code agent mode",
    icon: "Bot",
    colorTier: "moderate"
  }
];
var DSH_MODES = [
  {
    id: "default",
    label: "Default",
    description: "Default DeepSeek Harness mode",
    icon: "Bot",
    colorTier: "moderate"
  }
];
var AGENT_PROVIDER_DEFINITIONS = [
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic's multi-tool assistant with MCP support, streaming, and deep reasoning",
    defaultModeId: "default",
    modes: CLAUDE_MODES,
    voice: {
      enabled: true,
      defaultModeId: "default",
      defaultModel: "haiku"
    }
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI's Codex workspace agent with sandbox controls and optional network access",
    defaultModeId: "auto",
    modes: CODEX_MODES,
    voice: {
      enabled: true,
      defaultModeId: "auto",
      defaultModel: "gpt-5.4-mini"
    }
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Open-source coding assistant with multi-provider model support",
    defaultModeId: "build",
    modes: OPENCODE_MODES,
    voice: {
      enabled: true,
      defaultModeId: "build"
    }
  },
  {
    id: "pi",
    label: "Pi",
    description: "Minimal terminal-based coding agent with multi-provider LLM support",
    defaultModeId: null,
    modes: []
  },
  {
    id: "kimi",
    label: "Kimi Code",
    description: "Moonshot AI's open-source terminal coding agent via ACP",
    defaultModeId: "default",
    modes: KIMI_MODES
  },
  {
    id: "grokbuild",
    label: "Grok Build",
    description: "xAI's terminal coding agent via ACP",
    defaultModeId: null,
    modes: []
  },
  {
    id: "dsh",
    label: "DeepSeek Harness",
    description: "DeepSeek's official coding-agent harness via ACP (automation transport)",
    defaultModeId: "default",
    modes: DSH_MODES
  }
];
var DEV_AGENT_PROVIDER_DEFINITIONS = [
  {
    id: "mock",
    label: "Mock Load Test",
    description: "Development-only provider that emits synthetic agent traffic for performance tests",
    defaultModeId: "load-test",
    modes: MOCK_LOAD_TEST_MODES
  },
  {
    id: "mock-slow",
    label: "Mock Slow Provider",
    description: "Dev-only: hangs during model discovery to test loading and timeout UI",
    defaultModeId: "default",
    modes: MOCK_SLOW_MODES
  }
];
var BUILTIN_PROVIDER_IDS = AGENT_PROVIDER_DEFINITIONS.map((d) => d.id);
var AgentProviderSchema = external_exports.string();

// vendor/chisacode-remote/packages/protocol/dist/provider-config.js
var ProviderCommandDefaultSchema = external_exports.object({
  mode: external_exports.literal("default")
}).strict();
var ProviderCommandAppendSchema = external_exports.object({
  mode: external_exports.literal("append"),
  args: external_exports.array(external_exports.string()).optional()
}).strict();
var ProviderCommandReplaceSchema = external_exports.object({
  mode: external_exports.literal("replace"),
  argv: external_exports.array(external_exports.string().min(1)).min(1)
}).strict();
var ProviderCommandSchema = external_exports.discriminatedUnion("mode", [
  ProviderCommandDefaultSchema,
  ProviderCommandAppendSchema,
  ProviderCommandReplaceSchema
]);
var ProviderRuntimeSettingsSchema = external_exports.object({
  command: ProviderCommandSchema.optional(),
  env: external_exports.record(external_exports.string()).optional(),
  disallowedTools: external_exports.array(external_exports.string()).optional()
}).strict();
var ProviderProfileThinkingOptionSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  isDefault: external_exports.boolean().optional()
}).strict();
var ProviderProfileModelSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().min(1),
  description: external_exports.string().optional(),
  isDefault: external_exports.boolean().optional(),
  contextWindowMaxTokens: external_exports.number().int().positive().optional(),
  supportsImages: external_exports.boolean().optional(),
  supportsTools: external_exports.boolean().optional(),
  thinkingOptions: external_exports.array(ProviderProfileThinkingOptionSchema).optional()
}).strict();
var ProviderSSHConfigSchema = external_exports.object({
  host: external_exports.string().min(1),
  user: external_exports.string().optional(),
  port: external_exports.number().int().positive().optional(),
  identityFile: external_exports.string().optional(),
  sshOptions: external_exports.array(external_exports.string()).optional()
}).strict();
var ProviderOverrideSchema = external_exports.object({
  extends: external_exports.string().optional(),
  label: external_exports.string().optional(),
  description: external_exports.string().optional(),
  command: external_exports.array(external_exports.string().min(1)).min(1).optional(),
  env: external_exports.record(external_exports.string()).optional(),
  models: external_exports.array(ProviderProfileModelSchema).optional(),
  additionalModels: external_exports.array(ProviderProfileModelSchema).optional(),
  disallowedTools: external_exports.array(external_exports.string()).optional(),
  enabled: external_exports.boolean().optional(),
  order: external_exports.number().optional(),
  ssh: ProviderSSHConfigSchema.optional()
}).strict();
var ModelGatewayUpstreamSchema = external_exports.object({
  enabled: external_exports.boolean().default(false),
  baseUrl: external_exports.string().default(""),
  apiKey: external_exports.string().default("")
}).strict();
var SyntheticModelReferenceSchema = external_exports.object({
  model: external_exports.string().min(1)
}).strict();
var SyntheticModelParametersSchema = external_exports.object({
  temperature: external_exports.number().min(0).max(2).optional(),
  maxTokens: external_exports.number().int().positive().optional(),
  systemPrompt: external_exports.string().optional()
}).strict();
var SyntheticModelNodeSchema = external_exports.object({
  id: external_exports.string().min(1).optional(),
  model: external_exports.string().min(1),
  label: external_exports.string().optional(),
  parameters: SyntheticModelParametersSchema.optional()
}).strict();
var SyntheticModelLayerSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().optional(),
  nodes: external_exports.array(SyntheticModelNodeSchema),
  parameters: SyntheticModelParametersSchema.optional()
}).strict();
var SyntheticModelAggregatorSchema = external_exports.object({
  model: external_exports.string().min(1),
  parameters: SyntheticModelParametersSchema.optional()
}).strict();
var SyntheticModelMoaSchema = external_exports.object({
  defaults: SyntheticModelParametersSchema.optional(),
  layers: external_exports.array(SyntheticModelLayerSchema).min(1),
  aggregator: SyntheticModelAggregatorSchema
}).strict();
var SyntheticModelConfigSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().min(1),
  description: external_exports.string().optional(),
  references: external_exports.array(SyntheticModelReferenceSchema).min(1),
  aggregatorModel: external_exports.string().min(1),
  rounds: external_exports.number().int().positive().max(4).default(1),
  moa: SyntheticModelMoaSchema.optional()
}).strict();
var ModelGatewayProtocolPresetSchema = external_exports.enum(["claude", "codex", "openai", "all"]);
var ModelGatewaySupplyScopeSchema = external_exports.enum(["all", "matched"]);
var ModelGatewayConfigSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().min(1),
  models: external_exports.array(ProviderProfileModelSchema).default([]),
  syntheticModels: external_exports.array(SyntheticModelConfigSchema).default([]),
  enabled: external_exports.boolean().default(true),
  /**
   * Preferred agent attachment / upstream preset. Optional for backward
   * compatibility; when omitted the registry infers from enabled upstreams.
   */
  protocolPreset: ModelGatewayProtocolPresetSchema.optional(),
  /**
   * Explicit supply scope for this gateway. Optional for backward
   * compatibility; when omitted the registry derives the scope from
   * `attachToAllAgents` / `protocolPreset` / enabled upstreams.
   */
  supplyScope: ModelGatewaySupplyScopeSchema.optional(),
  /**
   * When true, generate every agent face even if protocolPreset is a single
   * protocol (gateway format conversion bridges the rest).
   * @deprecated Prefer `supplyScope: "all"`; kept for backward compatibility
   * with configs written by older clients. When both are present, supplyScope
   * takes precedence.
   */
  attachToAllAgents: external_exports.boolean().optional(),
  upstreams: external_exports.object({
    anthropic: ModelGatewayUpstreamSchema.default({}),
    chatCompletions: ModelGatewayUpstreamSchema.default({}),
    responses: ModelGatewayUpstreamSchema.default({})
  }).strict(),
  generatedProviderIds: external_exports.object({
    claude: external_exports.string().min(1),
    codex: external_exports.string().min(1),
    opencode: external_exports.string().min(1),
    pi: external_exports.string().min(1).optional(),
    kimi: external_exports.string().min(1).optional(),
    grokbuild: external_exports.string().min(1).optional(),
    dsh: external_exports.string().min(1).optional()
  }).strict().optional(),
  generatedModels: external_exports.object({
    opencode: external_exports.array(ProviderProfileModelSchema).optional(),
    pi: external_exports.array(ProviderProfileModelSchema).optional(),
    kimi: external_exports.array(ProviderProfileModelSchema).optional(),
    grokbuild: external_exports.array(ProviderProfileModelSchema).optional(),
    dsh: external_exports.array(ProviderProfileModelSchema).optional()
  }).strict().optional()
}).strict();
var MODEL_GATEWAY_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
var ModelGatewayConfigsSchema = external_exports.record(ModelGatewayConfigSchema).superRefine((gateways, ctx) => {
  for (const [gatewayId, gateway] of Object.entries(gateways)) {
    if (!MODEL_GATEWAY_ID_PATTERN.test(gatewayId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [gatewayId],
        message: `Model gateway ID "${gatewayId}" must match ${MODEL_GATEWAY_ID_PATTERN}.`
      });
    }
    if (gateway.id !== gatewayId) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [gatewayId, "id"],
        message: `Model gateway "${gatewayId}" must repeat the same id in its config.`
      });
    }
    const hasEnabledUpstream = Object.values(gateway.upstreams).some((upstream) => upstream.enabled === true);
    if (gateway.enabled !== false && !hasEnabledUpstream) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [gatewayId, "upstreams"],
        message: `Model gateway "${gatewayId}" must enable at least one upstream.`
      });
    }
  }
});
var BUILTIN_PROVIDER_IDS2 = [
  ...AGENT_PROVIDER_DEFINITIONS.map((definition) => definition.id),
  ...DEV_AGENT_PROVIDER_DEFINITIONS.map((definition) => definition.id)
];
var PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
var ProviderOverridesSchema = external_exports.record(ProviderOverrideSchema).superRefine((providers, ctx) => {
  const builtinProviderIdSet = new Set(BUILTIN_PROVIDER_IDS2);
  const validExtendsValues = /* @__PURE__ */ new Set([...BUILTIN_PROVIDER_IDS2, "acp"]);
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId],
        message: `Provider ID "${providerId}" must match ${PROVIDER_ID_PATTERN}.`
      });
    }
    const isBuiltinProvider = builtinProviderIdSet.has(providerId);
    if (!isBuiltinProvider && !provider.extends) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId, "extends"],
        message: `Custom provider "${providerId}" must declare extends.`
      });
    }
    if (!isBuiltinProvider && !provider.label) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId, "label"],
        message: `Custom provider "${providerId}" must declare label.`
      });
    }
    if (provider.extends && !validExtendsValues.has(provider.extends)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId, "extends"],
        message: `Provider "${providerId}" extends unknown provider "${provider.extends}".`
      });
    }
    if (provider.extends === "acp" && (!provider.command || provider.command.length === 0)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId, "command"],
        message: `ACP provider "${providerId}" must declare command.`
      });
    }
  }
});
var AgentProviderRuntimeSettingsMapSchema = external_exports.record(ProviderRuntimeSettingsSchema).superRefine((providers, ctx) => {
  for (const providerId of Object.keys(providers)) {
    const parsedProviderId = AgentProviderSchema.safeParse(providerId);
    if (!parsedProviderId.success) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [providerId],
        message: `Invalid agent provider "${providerId}".`
      });
    }
  }
});

// vendor/chisacode-remote/packages/protocol/dist/chat/types.js
var ChatRoomSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string(),
  purpose: external_exports.string().nullable(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var ChatMessageSchema = external_exports.object({
  id: external_exports.string(),
  roomId: external_exports.string(),
  authorAgentId: external_exports.string(),
  body: external_exports.string(),
  replyToMessageId: external_exports.string().nullable(),
  mentionAgentIds: external_exports.array(external_exports.string()),
  createdAt: external_exports.string()
});
var ChatRoomDetailSchema = ChatRoomSchema.extend({
  messageCount: external_exports.number().int().nonnegative(),
  lastMessageAt: external_exports.string().nullable()
});

// vendor/chisacode-remote/packages/protocol/dist/chat/rpc-schemas.js
var CHAT_WAIT_MAX_TIMEOUT_MS = 5 * 60 * 1e3;
var ChatCreateRequestSchema = external_exports.object({
  type: external_exports.literal("chat/create"),
  requestId: external_exports.string(),
  name: external_exports.string(),
  purpose: external_exports.string().optional()
});
var ChatListRequestSchema = external_exports.object({
  type: external_exports.literal("chat/list"),
  requestId: external_exports.string()
});
var ChatInspectRequestSchema = external_exports.object({
  type: external_exports.literal("chat/inspect"),
  requestId: external_exports.string(),
  room: external_exports.string()
});
var ChatDeleteRequestSchema = external_exports.object({
  type: external_exports.literal("chat/delete"),
  requestId: external_exports.string(),
  room: external_exports.string()
});
var ChatPostRequestSchema = external_exports.object({
  type: external_exports.literal("chat/post"),
  requestId: external_exports.string(),
  room: external_exports.string(),
  body: external_exports.string(),
  authorAgentId: external_exports.string().optional(),
  replyToMessageId: external_exports.string().optional()
});
var ChatReadRequestSchema = external_exports.object({
  type: external_exports.literal("chat/read"),
  requestId: external_exports.string(),
  room: external_exports.string(),
  limit: external_exports.number().int().nonnegative().optional(),
  since: external_exports.string().optional(),
  authorAgentId: external_exports.string().optional()
});
var ChatWaitRequestSchema = external_exports.object({
  type: external_exports.literal("chat/wait"),
  requestId: external_exports.string(),
  room: external_exports.string(),
  afterMessageId: external_exports.string().optional(),
  timeoutMs: external_exports.number().int().nonnegative().max(CHAT_WAIT_MAX_TIMEOUT_MS).optional()
});
var ChatCreateResponseSchema = external_exports.object({
  type: external_exports.literal("chat/create/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ChatListResponseSchema = external_exports.object({
  type: external_exports.literal("chat/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    rooms: external_exports.array(ChatRoomDetailSchema),
    error: external_exports.string().nullable()
  })
});
var ChatInspectResponseSchema = external_exports.object({
  type: external_exports.literal("chat/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ChatDeleteResponseSchema = external_exports.object({
  type: external_exports.literal("chat/delete/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    room: ChatRoomDetailSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ChatPostResponseSchema = external_exports.object({
  type: external_exports.literal("chat/post/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    message: ChatMessageSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ChatReadResponseSchema = external_exports.object({
  type: external_exports.literal("chat/read/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    messages: external_exports.array(ChatMessageSchema),
    error: external_exports.string().nullable()
  })
});
var ChatWaitResponseSchema = external_exports.object({
  type: external_exports.literal("chat/wait/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    messages: external_exports.array(ChatMessageSchema),
    timedOut: external_exports.boolean(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/loop/rpc-schemas.js
var LoopLogEntrySchema = external_exports.object({
  seq: external_exports.number().int().positive(),
  timestamp: external_exports.string(),
  iteration: external_exports.number().int().positive().nullable(),
  source: external_exports.enum(["loop", "worker", "verifier", "verify-check"]),
  level: external_exports.enum(["info", "error"]),
  text: external_exports.string()
});
var LoopVerifyCheckResultSchema = external_exports.object({
  command: external_exports.string(),
  exitCode: external_exports.number().int(),
  passed: external_exports.boolean(),
  stdout: external_exports.string(),
  stderr: external_exports.string(),
  startedAt: external_exports.string(),
  completedAt: external_exports.string()
});
var LoopVerifyPromptResultSchema = external_exports.object({
  passed: external_exports.boolean(),
  reason: external_exports.string(),
  verifierAgentId: external_exports.string().nullable(),
  startedAt: external_exports.string(),
  completedAt: external_exports.string()
});
var LoopIterationRecordSchema = external_exports.object({
  index: external_exports.number().int().positive(),
  workerAgentId: external_exports.string().nullable(),
  workerStartedAt: external_exports.string(),
  workerCompletedAt: external_exports.string().nullable(),
  verifierAgentId: external_exports.string().nullable(),
  status: external_exports.enum(["running", "succeeded", "failed", "stopped"]),
  workerOutcome: external_exports.enum(["completed", "failed", "canceled"]).nullable(),
  failureReason: external_exports.string().nullable(),
  verifyChecks: external_exports.array(LoopVerifyCheckResultSchema),
  verifyPrompt: LoopVerifyPromptResultSchema.nullable()
});
var LoopRecordSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string().nullable(),
  prompt: external_exports.string(),
  cwd: external_exports.string(),
  provider: AgentProviderSchema,
  model: external_exports.string().nullable(),
  modeId: external_exports.string().nullable().default(null),
  workerProvider: AgentProviderSchema.nullable(),
  workerModel: external_exports.string().nullable(),
  verifierProvider: AgentProviderSchema.nullable(),
  verifierModel: external_exports.string().nullable(),
  verifierModeId: external_exports.string().nullable().default(null),
  verifyPrompt: external_exports.string().nullable(),
  verifyChecks: external_exports.array(external_exports.string()),
  archive: external_exports.boolean(),
  sleepMs: external_exports.number().int().nonnegative(),
  maxIterations: external_exports.number().int().positive().nullable(),
  maxTimeMs: external_exports.number().int().positive().nullable(),
  status: external_exports.enum(["running", "succeeded", "failed", "stopped"]),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  startedAt: external_exports.string(),
  completedAt: external_exports.string().nullable(),
  stopRequestedAt: external_exports.string().nullable(),
  iterations: external_exports.array(LoopIterationRecordSchema),
  logs: external_exports.array(LoopLogEntrySchema),
  nextLogSeq: external_exports.number().int().positive(),
  activeIteration: external_exports.number().int().positive().nullable(),
  activeWorkerAgentId: external_exports.string().nullable(),
  activeVerifierAgentId: external_exports.string().nullable()
});
var LoopListItemSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string().nullable(),
  status: external_exports.enum(["running", "succeeded", "failed", "stopped"]),
  cwd: external_exports.string(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  activeIteration: external_exports.number().int().positive().nullable()
});
var LoopRunRequestSchema = external_exports.object({
  type: external_exports.literal("loop/run"),
  requestId: external_exports.string(),
  prompt: external_exports.string().trim().min(1),
  cwd: external_exports.string(),
  provider: AgentProviderSchema.optional(),
  model: external_exports.string().trim().min(1).optional(),
  modeId: external_exports.string().trim().min(1).optional(),
  workerProvider: AgentProviderSchema.optional(),
  workerModel: external_exports.string().trim().min(1).optional(),
  verifierProvider: AgentProviderSchema.optional(),
  verifierModel: external_exports.string().trim().min(1).optional(),
  verifierModeId: external_exports.string().trim().min(1).optional(),
  verifyPrompt: external_exports.string().trim().min(1).optional(),
  verifyChecks: external_exports.array(external_exports.string().trim().min(1)).optional(),
  archive: external_exports.boolean().optional(),
  name: external_exports.string().trim().min(1).optional(),
  sleepMs: external_exports.number().int().nonnegative().optional(),
  maxIterations: external_exports.number().int().positive().optional(),
  maxTimeMs: external_exports.number().int().positive().optional()
});
var LoopListRequestSchema = external_exports.object({
  type: external_exports.literal("loop/list"),
  requestId: external_exports.string()
});
var LoopInspectRequestSchema = external_exports.object({
  type: external_exports.literal("loop/inspect"),
  requestId: external_exports.string(),
  id: external_exports.string().trim().min(1)
});
var LoopLogsRequestSchema = external_exports.object({
  type: external_exports.literal("loop/logs"),
  requestId: external_exports.string(),
  id: external_exports.string().trim().min(1),
  afterSeq: external_exports.number().int().nonnegative().optional()
});
var LoopStopRequestSchema = external_exports.object({
  type: external_exports.literal("loop/stop"),
  requestId: external_exports.string(),
  id: external_exports.string().trim().min(1)
});
var LoopRunResponseSchema = external_exports.object({
  type: external_exports.literal("loop/run/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    loop: LoopRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var LoopListResponseSchema = external_exports.object({
  type: external_exports.literal("loop/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    loops: external_exports.array(LoopListItemSchema),
    error: external_exports.string().nullable()
  })
});
var LoopInspectResponseSchema = external_exports.object({
  type: external_exports.literal("loop/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    loop: LoopRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var LoopLogsResponseSchema = external_exports.object({
  type: external_exports.literal("loop/logs/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    loop: LoopRecordSchema.nullable(),
    entries: external_exports.array(LoopLogEntrySchema),
    nextCursor: external_exports.number().int().nonnegative(),
    error: external_exports.string().nullable()
  })
});
var LoopStopResponseSchema = external_exports.object({
  type: external_exports.literal("loop/stop/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    loop: LoopRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/schedule/types.js
var ScheduleStatusSchema = external_exports.enum(["active", "paused", "completed"]);
var ScheduleCadenceSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("every"),
    everyMs: external_exports.number().int().positive()
  }),
  external_exports.object({
    type: external_exports.literal("cron"),
    expression: external_exports.string().trim().min(1)
  })
]);
var ScheduleTargetSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string().uuid()
  }),
  external_exports.object({
    type: external_exports.literal("new-agent"),
    config: external_exports.object({
      provider: AgentProviderSchema,
      cwd: external_exports.string().trim().min(1),
      modeId: external_exports.string().trim().min(1).optional(),
      model: external_exports.string().trim().min(1).optional(),
      thinkingOptionId: external_exports.string().trim().min(1).optional(),
      title: external_exports.string().trim().min(1).nullable().optional(),
      approvalPolicy: external_exports.string().trim().min(1).optional(),
      sandboxMode: external_exports.string().trim().min(1).optional(),
      networkAccess: external_exports.boolean().optional(),
      webSearch: external_exports.boolean().optional(),
      featureValues: external_exports.record(external_exports.unknown()).optional(),
      extra: external_exports.object({
        codex: external_exports.record(external_exports.unknown()).optional(),
        claude: external_exports.record(external_exports.unknown()).optional()
      }).partial().optional(),
      systemPrompt: external_exports.string().optional(),
      mcpServers: external_exports.record(external_exports.unknown()).optional()
    })
  })
]);
var ScheduleRunSchema = external_exports.object({
  id: external_exports.string(),
  scheduledFor: external_exports.string(),
  startedAt: external_exports.string(),
  endedAt: external_exports.string().nullable(),
  status: external_exports.enum(["running", "succeeded", "failed"]),
  agentId: external_exports.string().uuid().nullable(),
  output: external_exports.string().nullable(),
  error: external_exports.string().nullable()
});
var StoredScheduleSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string().nullable(),
  prompt: external_exports.string().min(1),
  cadence: ScheduleCadenceSchema,
  target: ScheduleTargetSchema,
  status: ScheduleStatusSchema,
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  nextRunAt: external_exports.string().nullable(),
  lastRunAt: external_exports.string().nullable(),
  pausedAt: external_exports.string().nullable(),
  expiresAt: external_exports.string().nullable(),
  maxRuns: external_exports.number().int().positive().nullable(),
  runs: external_exports.array(ScheduleRunSchema)
});
var ScheduleSummarySchema = StoredScheduleSchema.omit({
  runs: true
});

// vendor/chisacode-remote/packages/protocol/dist/schedule/rpc-schemas.js
var ScheduleCreateTargetSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("self"),
    agentId: external_exports.string().uuid()
  }),
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string().uuid()
  }),
  external_exports.object({
    type: external_exports.literal("new-agent"),
    config: ScheduleTargetSchema.options[1].shape.config
  })
]);
var ScheduleIdSchema = external_exports.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
var ScheduleCreateRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/create"),
  requestId: external_exports.string(),
  prompt: external_exports.string().min(1),
  name: external_exports.string().optional(),
  cadence: ScheduleCadenceSchema,
  target: ScheduleCreateTargetSchema,
  maxRuns: external_exports.number().int().positive().optional(),
  expiresAt: external_exports.string().optional(),
  runOnCreate: external_exports.boolean().optional()
});
var ScheduleListRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/list"),
  requestId: external_exports.string()
});
var ScheduleInspectRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/inspect"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var ScheduleLogsRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/logs"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var SchedulePauseRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/pause"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var ScheduleResumeRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/resume"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var ScheduleDeleteRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/delete"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var ScheduleRunOnceRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/run-once"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema
});
var ScheduleUpdateNewAgentConfigSchema = external_exports.object({
  provider: external_exports.string().trim().min(1).optional(),
  model: external_exports.string().trim().min(1).nullable().optional(),
  modeId: external_exports.string().trim().min(1).nullable().optional(),
  cwd: external_exports.string().trim().min(1).optional()
});
var ScheduleUpdateRequestSchema = external_exports.object({
  type: external_exports.literal("schedule/update"),
  requestId: external_exports.string(),
  scheduleId: ScheduleIdSchema,
  name: external_exports.string().nullable().optional(),
  prompt: external_exports.string().min(1).optional(),
  cadence: ScheduleCadenceSchema.optional(),
  newAgentConfig: ScheduleUpdateNewAgentConfigSchema.optional(),
  maxRuns: external_exports.number().int().positive().nullable().optional(),
  expiresAt: external_exports.string().nullable().optional()
});
var ScheduleCreateResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/create/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: ScheduleSummarySchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ScheduleListResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedules: external_exports.array(ScheduleSummarySchema),
    error: external_exports.string().nullable()
  })
});
var ScheduleInspectResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: StoredScheduleSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ScheduleLogsResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/logs/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    runs: external_exports.array(ScheduleRunSchema),
    error: external_exports.string().nullable()
  })
});
var SchedulePauseResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/pause/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: ScheduleSummarySchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ScheduleResumeResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/resume/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: ScheduleSummarySchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ScheduleDeleteResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/delete/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    scheduleId: external_exports.string(),
    error: external_exports.string().nullable()
  })
});
var ScheduleRunOnceResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/run-once/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: StoredScheduleSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ScheduleUpdateResponseSchema = external_exports.object({
  type: external_exports.literal("schedule/update/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    schedule: StoredScheduleSchema.nullable(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/automation/messages.js
var AutomationInboundMessageSchemas = [
  ChatCreateRequestSchema,
  ChatListRequestSchema,
  ChatInspectRequestSchema,
  ChatDeleteRequestSchema,
  ChatPostRequestSchema,
  ChatReadRequestSchema,
  ChatWaitRequestSchema,
  ScheduleCreateRequestSchema,
  ScheduleListRequestSchema,
  ScheduleInspectRequestSchema,
  ScheduleLogsRequestSchema,
  SchedulePauseRequestSchema,
  ScheduleResumeRequestSchema,
  ScheduleDeleteRequestSchema,
  ScheduleRunOnceRequestSchema,
  ScheduleUpdateRequestSchema,
  LoopRunRequestSchema,
  LoopListRequestSchema,
  LoopInspectRequestSchema,
  LoopLogsRequestSchema,
  LoopStopRequestSchema
];
var AutomationOutboundMessageSchemas = [
  ChatCreateResponseSchema,
  ChatListResponseSchema,
  ChatInspectResponseSchema,
  ChatDeleteResponseSchema,
  ChatPostResponseSchema,
  ChatReadResponseSchema,
  ChatWaitResponseSchema,
  ScheduleCreateResponseSchema,
  ScheduleListResponseSchema,
  ScheduleInspectResponseSchema,
  ScheduleLogsResponseSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeResponseSchema,
  ScheduleDeleteResponseSchema,
  ScheduleRunOnceResponseSchema,
  ScheduleUpdateResponseSchema,
  LoopRunResponseSchema,
  LoopListResponseSchema,
  LoopInspectResponseSchema,
  LoopLogsResponseSchema,
  LoopStopResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/generative-ui/rpc-schemas.js
var GenerativeUiActionRequestPayloadShape = {
  requestId: external_exports.string(),
  /** Target agent session */
  agentId: external_exports.string(),
  /** Match against generative_ui timeline item instanceId */
  instanceId: external_exports.string(),
  /** Action name as defined in the component's actions array */
  action: external_exports.string(),
  /** Action-specific payload */
  payload: external_exports.unknown(),
  /** Event timestamp (client-side) */
  timestamp: external_exports.number()
};
var GenerativeUiActionRequestSchema = external_exports.object({
  type: external_exports.literal("generative_ui.action.request"),
  ...GenerativeUiActionRequestPayloadShape
});
var LegacyGenerativeUiActionRequestSchema = external_exports.object({
  type: external_exports.literal("generative_ui.action"),
  ...GenerativeUiActionRequestPayloadShape
});
var GenerativeUiActionResponseSchema = external_exports.object({
  type: external_exports.literal("generative_ui.action.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    received: external_exports.boolean(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/terminal/messages.js
var ListTerminalsRequestSchema = external_exports.object({
  type: external_exports.literal("list_terminals_request"),
  cwd: external_exports.string().optional(),
  requestId: external_exports.string()
});
var SubscribeTerminalsRequestSchema = external_exports.object({
  type: external_exports.literal("subscribe_terminals_request"),
  cwd: external_exports.string()
});
var UnsubscribeTerminalsRequestSchema = external_exports.object({
  type: external_exports.literal("unsubscribe_terminals_request"),
  cwd: external_exports.string()
});
var CreateTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("create_terminal_request"),
  cwd: external_exports.string(),
  name: external_exports.string().optional(),
  agentId: external_exports.string().optional(),
  command: external_exports.string().optional(),
  args: external_exports.array(external_exports.string()).optional(),
  requestId: external_exports.string()
});
var RenameTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("terminal.rename.request"),
  terminalId: external_exports.string(),
  title: external_exports.string(),
  requestId: external_exports.string()
});
var StartWorkspaceScriptRequestSchema = external_exports.object({
  type: external_exports.literal("start_workspace_script_request"),
  workspaceId: external_exports.string(),
  scriptName: external_exports.string(),
  requestId: external_exports.string()
});
var SubscribeTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("subscribe_terminal_request"),
  terminalId: external_exports.string(),
  requestId: external_exports.string(),
  restore: external_exports.object({
    mode: external_exports.enum(["live", "visible-snapshot", "full-snapshot"]),
    scrollbackLines: external_exports.number().int().nonnegative().optional(),
    size: external_exports.object({
      rows: external_exports.number().int().positive(),
      cols: external_exports.number().int().positive()
    }).strict().optional()
  }).strict().optional()
});
var UnsubscribeTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("unsubscribe_terminal_request"),
  terminalId: external_exports.string()
});
var TerminalClientMessageSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("input"), data: external_exports.string() }),
  external_exports.object({ type: external_exports.literal("resize"), rows: external_exports.number(), cols: external_exports.number() }),
  external_exports.object({
    type: external_exports.literal("mouse"),
    row: external_exports.number(),
    col: external_exports.number(),
    button: external_exports.number(),
    action: external_exports.enum(["down", "up", "move"])
  })
]);
var TerminalInputSchema = external_exports.object({
  type: external_exports.literal("terminal_input"),
  terminalId: external_exports.string(),
  message: TerminalClientMessageSchema
});
var KillTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("kill_terminal_request"),
  terminalId: external_exports.string(),
  requestId: external_exports.string()
});
var CaptureTerminalRequestSchema = external_exports.object({
  type: external_exports.literal("capture_terminal_request"),
  terminalId: external_exports.string(),
  start: external_exports.number().int().optional(),
  end: external_exports.number().int().optional(),
  stripAnsi: external_exports.boolean().default(true),
  requestId: external_exports.string()
});
var TerminalInfoSchema = external_exports.object({
  id: external_exports.string(),
  name: external_exports.string(),
  cwd: external_exports.string(),
  title: external_exports.string().optional()
});
var TerminalCellSchema = external_exports.object({
  char: external_exports.string(),
  fg: external_exports.number().optional(),
  bg: external_exports.number().optional(),
  fgMode: external_exports.number().optional(),
  bgMode: external_exports.number().optional(),
  bold: external_exports.boolean().optional(),
  italic: external_exports.boolean().optional(),
  underline: external_exports.boolean().optional(),
  dim: external_exports.boolean().optional(),
  inverse: external_exports.boolean().optional(),
  strikethrough: external_exports.boolean().optional()
}).strict();
var TerminalCursorStyleSchema = external_exports.enum(["block", "underline", "bar"]);
var TerminalCursorSchema = external_exports.object({
  row: external_exports.number(),
  col: external_exports.number(),
  hidden: external_exports.boolean().optional(),
  style: TerminalCursorStyleSchema.optional(),
  blink: external_exports.boolean().optional()
}).strict();
var TerminalStateSchema = external_exports.object({
  rows: external_exports.number(),
  cols: external_exports.number(),
  grid: external_exports.array(external_exports.array(TerminalCellSchema)),
  scrollback: external_exports.array(external_exports.array(TerminalCellSchema)),
  cursor: TerminalCursorSchema,
  title: external_exports.string().optional()
}).strict();
var ListTerminalsResponseSchema = external_exports.object({
  type: external_exports.literal("list_terminals_response"),
  payload: external_exports.object({
    cwd: external_exports.string().optional(),
    terminals: external_exports.array(TerminalInfoSchema.omit({ cwd: true })),
    requestId: external_exports.string()
  })
});
var TerminalsChangedSchema = external_exports.object({
  type: external_exports.literal("terminals_changed"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    terminals: external_exports.array(TerminalInfoSchema.omit({ cwd: true }))
  })
});
var CreateTerminalResponseSchema = external_exports.object({
  type: external_exports.literal("create_terminal_response"),
  payload: external_exports.object({
    terminal: TerminalInfoSchema.nullable(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var RenameTerminalResponseSchema = external_exports.object({
  type: external_exports.literal("terminal.rename.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    success: external_exports.boolean(),
    error: external_exports.string().nullable()
  })
});
var SubscribeTerminalResponseSchema = external_exports.object({
  type: external_exports.literal("subscribe_terminal_response"),
  payload: external_exports.union([
    external_exports.object({
      terminalId: external_exports.string(),
      slot: external_exports.number().int().min(0).max(255),
      error: external_exports.null(),
      requestId: external_exports.string()
    }),
    external_exports.object({
      terminalId: external_exports.string(),
      error: external_exports.string(),
      requestId: external_exports.string()
    })
  ])
});
var KillTerminalResponseSchema = external_exports.object({
  type: external_exports.literal("kill_terminal_response"),
  payload: external_exports.object({
    terminalId: external_exports.string(),
    success: external_exports.boolean(),
    requestId: external_exports.string()
  })
});
var CaptureTerminalResponseSchema = external_exports.object({
  type: external_exports.literal("capture_terminal_response"),
  payload: external_exports.object({
    terminalId: external_exports.string(),
    lines: external_exports.array(external_exports.string()),
    totalLines: external_exports.number().int().nonnegative(),
    requestId: external_exports.string()
  })
});
var TerminalStreamExitSchema = external_exports.object({
  type: external_exports.literal("terminal_stream_exit"),
  payload: external_exports.object({ terminalId: external_exports.string() })
});
var TerminalInboundMessageSchemas = [
  ListTerminalsRequestSchema,
  SubscribeTerminalsRequestSchema,
  UnsubscribeTerminalsRequestSchema,
  CreateTerminalRequestSchema,
  RenameTerminalRequestSchema,
  StartWorkspaceScriptRequestSchema,
  SubscribeTerminalRequestSchema,
  UnsubscribeTerminalRequestSchema,
  TerminalInputSchema,
  KillTerminalRequestSchema,
  CaptureTerminalRequestSchema
];
var TerminalOutboundMessageSchemas = [
  ListTerminalsResponseSchema,
  TerminalsChangedSchema,
  CreateTerminalResponseSchema,
  RenameTerminalResponseSchema,
  SubscribeTerminalResponseSchema,
  KillTerminalResponseSchema,
  CaptureTerminalResponseSchema,
  TerminalStreamExitSchema
];

// vendor/chisacode-remote/packages/protocol/dist/checkout/messages.js
var CheckoutErrorCodeSchema = external_exports.enum([
  "NOT_GIT_REPO",
  "NOT_ALLOWED",
  "MERGE_CONFLICT",
  "UNKNOWN"
]);
var CheckoutErrorSchema = external_exports.object({
  code: CheckoutErrorCodeSchema,
  message: external_exports.string()
});
var CheckoutDiffCompareSchema = external_exports.object({
  mode: external_exports.enum(["uncommitted", "base"]),
  baseRef: external_exports.string().optional(),
  ignoreWhitespace: external_exports.boolean().optional()
});
var CheckoutStatusRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_status_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var SubscribeCheckoutDiffRequestSchema = external_exports.object({
  type: external_exports.literal("subscribe_checkout_diff_request"),
  subscriptionId: external_exports.string(),
  cwd: external_exports.string(),
  compare: CheckoutDiffCompareSchema,
  requestId: external_exports.string()
});
var UnsubscribeCheckoutDiffRequestSchema = external_exports.object({
  type: external_exports.literal("unsubscribe_checkout_diff_request"),
  subscriptionId: external_exports.string()
});
var CheckoutCommitRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_commit_request"),
  cwd: external_exports.string(),
  message: external_exports.string().optional(),
  addAll: external_exports.boolean().optional(),
  requestId: external_exports.string()
});
var CheckoutMergeRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_merge_request"),
  cwd: external_exports.string(),
  baseRef: external_exports.string().optional(),
  strategy: external_exports.enum(["merge", "squash"]).optional(),
  requireCleanTarget: external_exports.boolean().optional(),
  requestId: external_exports.string()
});
var CheckoutMergeFromBaseRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_merge_from_base_request"),
  cwd: external_exports.string(),
  baseRef: external_exports.string().optional(),
  requireCleanTarget: external_exports.boolean().optional(),
  requestId: external_exports.string()
});
var CheckoutPullRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_pull_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var CheckoutPushRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_push_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var CheckoutRefreshRequestSchema = external_exports.object({
  type: external_exports.literal("checkout.refresh.request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var CheckoutPrCreateRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_create_request"),
  cwd: external_exports.string(),
  title: external_exports.string().optional(),
  body: external_exports.string().optional(),
  baseRef: external_exports.string().optional(),
  requestId: external_exports.string()
});
var CheckoutPrMergeRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_merge_request"),
  cwd: external_exports.string(),
  mergeMethod: external_exports.enum(["merge", "squash", "rebase"]),
  requestId: external_exports.string()
});
var CheckoutGithubSetAutoMergeRequestSchema = external_exports.object({
  type: external_exports.literal("checkout.github.set_auto_merge.request"),
  cwd: external_exports.string(),
  enabled: external_exports.boolean(),
  mergeMethod: external_exports.enum(["merge", "squash", "rebase"]).optional(),
  requestId: external_exports.string()
});
var CheckoutPrStatusRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_status_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var PullRequestTimelineRequestSchema = external_exports.object({
  type: external_exports.literal("pull_request_timeline_request"),
  cwd: external_exports.string(),
  prNumber: external_exports.number(),
  repoOwner: external_exports.string(),
  repoName: external_exports.string(),
  requestId: external_exports.string()
});
var ValidateBranchRequestSchema = external_exports.object({
  type: external_exports.literal("validate_branch_request"),
  cwd: external_exports.string(),
  branchName: external_exports.string(),
  requestId: external_exports.string()
});
var CheckoutSwitchBranchRequestSchema = external_exports.object({
  type: external_exports.literal("checkout_switch_branch_request"),
  cwd: external_exports.string(),
  branch: external_exports.string(),
  requestId: external_exports.string()
});
var CheckoutRenameBranchRequestSchema = external_exports.object({
  type: external_exports.literal("checkout.rename_branch.request"),
  cwd: external_exports.string(),
  branch: external_exports.string(),
  requestId: external_exports.string()
});
var StashSaveRequestSchema = external_exports.object({
  type: external_exports.literal("stash_save_request"),
  cwd: external_exports.string(),
  /** Branch name to tag the stash with for later identification. */
  branch: external_exports.string().optional(),
  requestId: external_exports.string()
});
var StashPopRequestSchema = external_exports.object({
  type: external_exports.literal("stash_pop_request"),
  cwd: external_exports.string(),
  /** Zero-based index from stash_list_response. */
  stashIndex: external_exports.number().int().min(0),
  requestId: external_exports.string()
});
var StashListRequestSchema = external_exports.object({
  type: external_exports.literal("stash_list_request"),
  cwd: external_exports.string(),
  /** If true, only return chisacode-created stashes. Default true. */
  chisacodeOnly: external_exports.boolean().optional(),
  requestId: external_exports.string()
});
var BranchSuggestionsRequestSchema = external_exports.object({
  type: external_exports.literal("branch_suggestions_request"),
  cwd: external_exports.string(),
  query: external_exports.string().optional(),
  limit: external_exports.number().int().min(1).max(200).optional(),
  requestId: external_exports.string()
});
var GitHubSearchItemSchema = external_exports.object({
  kind: external_exports.enum(["issue", "pr"]),
  number: external_exports.number(),
  title: external_exports.string(),
  url: external_exports.string(),
  state: external_exports.string(),
  body: external_exports.string().nullable(),
  labels: external_exports.array(external_exports.string()),
  baseRefName: external_exports.string().nullable().optional(),
  headRefName: external_exports.string().nullable().optional(),
  updatedAt: external_exports.string().optional()
});
var GitHubSearchKindSchema = external_exports.enum(["github-issue", "github-pr"]);
var GitHubSearchRequestSchema = external_exports.object({
  type: external_exports.literal("github_search_request"),
  cwd: external_exports.string(),
  query: external_exports.string(),
  limit: external_exports.number().int().min(1).max(50).optional(),
  kinds: external_exports.array(GitHubSearchKindSchema).optional(),
  requestId: external_exports.string()
});
var HighlightTokenSchema = external_exports.object({
  text: external_exports.string(),
  style: external_exports.string().nullable()
});
var DiffLineSchema = external_exports.object({
  type: external_exports.enum(["add", "remove", "context", "header"]),
  content: external_exports.string(),
  tokens: external_exports.array(HighlightTokenSchema).optional()
});
var DiffHunkSchema = external_exports.object({
  oldStart: external_exports.number(),
  oldCount: external_exports.number(),
  newStart: external_exports.number(),
  newCount: external_exports.number(),
  lines: external_exports.array(DiffLineSchema)
});
var ParsedDiffFileSchema = external_exports.object({
  path: external_exports.string(),
  isNew: external_exports.boolean(),
  isDeleted: external_exports.boolean(),
  additions: external_exports.number(),
  deletions: external_exports.number(),
  hunks: external_exports.array(DiffHunkSchema),
  status: external_exports.enum(["ok", "too_large", "binary"]).optional()
});
var AheadBehindSchema = external_exports.object({
  ahead: external_exports.number(),
  behind: external_exports.number()
});
var CheckoutStatusCommonSchema = external_exports.object({
  cwd: external_exports.string(),
  error: CheckoutErrorSchema.nullable(),
  requestId: external_exports.string()
});
var CheckoutStatusNotGitSchema = CheckoutStatusCommonSchema.extend({
  isGit: external_exports.literal(false),
  isChisaCodeOwnedWorktree: external_exports.literal(false),
  repoRoot: external_exports.null(),
  currentBranch: external_exports.null(),
  isDirty: external_exports.null(),
  baseRef: external_exports.null(),
  aheadBehind: external_exports.null(),
  aheadOfOrigin: external_exports.null(),
  behindOfOrigin: external_exports.null(),
  hasRemote: external_exports.boolean(),
  remoteUrl: external_exports.null()
});
var CheckoutStatusGitNonChisaCodeSchema = CheckoutStatusCommonSchema.extend({
  isGit: external_exports.literal(true),
  isChisaCodeOwnedWorktree: external_exports.literal(false),
  repoRoot: external_exports.string(),
  mainRepoRoot: external_exports.string().nullable().optional().default(null),
  currentBranch: external_exports.string().nullable(),
  isDirty: external_exports.boolean(),
  baseRef: external_exports.string().nullable(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: external_exports.number().nullable(),
  behindOfOrigin: external_exports.number().nullable(),
  hasRemote: external_exports.boolean(),
  remoteUrl: external_exports.string().nullable()
});
var CheckoutStatusGitChisaCodeSchema = CheckoutStatusCommonSchema.extend({
  isGit: external_exports.literal(true),
  isChisaCodeOwnedWorktree: external_exports.literal(true),
  repoRoot: external_exports.string(),
  mainRepoRoot: external_exports.string(),
  currentBranch: external_exports.string().nullable(),
  isDirty: external_exports.boolean(),
  baseRef: external_exports.string(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: external_exports.number().nullable(),
  behindOfOrigin: external_exports.number().nullable(),
  hasRemote: external_exports.boolean(),
  remoteUrl: external_exports.string().nullable()
});
var CheckoutStatusResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_status_response"),
  payload: external_exports.union([
    CheckoutStatusNotGitSchema,
    CheckoutStatusGitNonChisaCodeSchema,
    CheckoutStatusGitChisaCodeSchema
  ])
});
var CheckoutPrGithubAutoMergeRequestSchema = external_exports.object({
  enabledAt: external_exports.string().nullable().optional().default(null),
  mergeMethod: external_exports.string().nullable().optional().default(null),
  enabledBy: external_exports.string().nullable().optional().default(null)
}).nullable().optional().default(null);
var CheckoutPrGithubRepositoryPolicySchema = external_exports.object({
  autoMergeAllowed: external_exports.boolean().optional().default(false),
  mergeCommitAllowed: external_exports.boolean().optional().default(false),
  squashMergeAllowed: external_exports.boolean().optional().default(false),
  rebaseMergeAllowed: external_exports.boolean().optional().default(false),
  viewerDefaultMergeMethod: external_exports.string().nullable().optional().default(null)
}).optional().default({
  autoMergeAllowed: false,
  mergeCommitAllowed: false,
  squashMergeAllowed: false,
  rebaseMergeAllowed: false,
  viewerDefaultMergeMethod: null
});
var CheckoutPrGithubStatusSchema = external_exports.object({
  mergeStateStatus: external_exports.string().nullable().optional().default(null),
  autoMergeRequest: CheckoutPrGithubAutoMergeRequestSchema,
  viewerCanEnableAutoMerge: external_exports.boolean().optional().default(false),
  viewerCanDisableAutoMerge: external_exports.boolean().optional().default(false),
  viewerCanMergeAsAdmin: external_exports.boolean().optional().default(false),
  viewerCanUpdateBranch: external_exports.boolean().optional().default(false),
  repository: CheckoutPrGithubRepositoryPolicySchema,
  isMergeQueueEnabled: external_exports.boolean().optional().default(false),
  isInMergeQueue: external_exports.boolean().optional().default(false)
}).optional();
var CheckoutPrStatusSchema = external_exports.object({
  number: external_exports.number().optional(),
  url: external_exports.string(),
  title: external_exports.string(),
  state: external_exports.string(),
  baseRefName: external_exports.string(),
  headRefName: external_exports.string(),
  isMerged: external_exports.boolean(),
  isDraft: external_exports.boolean().optional().default(false),
  mergeable: external_exports.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN").optional().default("UNKNOWN"),
  checks: external_exports.array(external_exports.object({
    name: external_exports.string(),
    status: external_exports.string(),
    url: external_exports.string().nullable(),
    workflow: external_exports.string().optional(),
    duration: external_exports.string().optional()
  })).optional().default([]),
  checksStatus: external_exports.string().optional(),
  reviewDecision: external_exports.string().nullable().optional(),
  repoOwner: external_exports.string().optional(),
  repoName: external_exports.string().optional(),
  github: CheckoutPrGithubStatusSchema
});
var CheckoutPrStatusPayloadSchema = external_exports.object({
  cwd: external_exports.string(),
  status: CheckoutPrStatusSchema.nullable(),
  githubFeaturesEnabled: external_exports.boolean(),
  error: CheckoutErrorSchema.nullable(),
  requestId: external_exports.string()
});
var CheckoutStatusUpdateMetadataSchema = external_exports.object({
  prStatus: CheckoutPrStatusPayloadSchema.optional()
});
var CheckoutStatusUpdateSchema = external_exports.object({
  type: external_exports.literal("checkout_status_update"),
  payload: external_exports.union([
    CheckoutStatusNotGitSchema,
    CheckoutStatusGitNonChisaCodeSchema,
    CheckoutStatusGitChisaCodeSchema
  ]).and(CheckoutStatusUpdateMetadataSchema)
});
var CheckoutDiffSubscriptionPayloadSchema = external_exports.object({
  subscriptionId: external_exports.string(),
  cwd: external_exports.string(),
  files: external_exports.array(ParsedDiffFileSchema),
  error: CheckoutErrorSchema.nullable()
});
var SubscribeCheckoutDiffResponseSchema = external_exports.object({
  type: external_exports.literal("subscribe_checkout_diff_response"),
  payload: CheckoutDiffSubscriptionPayloadSchema.extend({
    requestId: external_exports.string()
  })
});
var CheckoutDiffUpdateSchema = external_exports.object({
  type: external_exports.literal("checkout_diff_update"),
  payload: CheckoutDiffSubscriptionPayloadSchema
});
var CheckoutCommitResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_commit_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutMergeResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_merge_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutMergeFromBaseResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_merge_from_base_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutPullResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_pull_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutPushResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_push_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutRefreshResponseSchema = external_exports.object({
  type: external_exports.literal("checkout.refresh.response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutPrCreateResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_create_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    url: external_exports.string().nullable(),
    number: external_exports.number().nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutPrMergeResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_merge_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutGithubSetAutoMergeResponseSchema = external_exports.object({
  type: external_exports.literal("checkout.github.set_auto_merge.response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    enabled: external_exports.boolean(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutPrStatusResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_pr_status_response"),
  payload: CheckoutPrStatusPayloadSchema
});
var PullRequestTimelineKnownErrorSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({
    kind: external_exports.literal("not_found"),
    message: external_exports.string().optional().default("")
  }),
  external_exports.object({
    kind: external_exports.literal("forbidden"),
    message: external_exports.string().optional().default("")
  }),
  external_exports.object({
    kind: external_exports.literal("unknown"),
    message: external_exports.string().optional().default("")
  })
]);
var PullRequestTimelineErrorSchema = external_exports.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "unknown", message: "" };
  }
  const error = value;
  if (error.kind === "not_found" || error.kind === "forbidden" || error.kind === "unknown") {
    return error;
  }
  return { ...error, kind: "unknown" };
}, PullRequestTimelineKnownErrorSchema);
var PullRequestTimelineReviewItemSchema = external_exports.object({
  id: external_exports.string().optional().default(""),
  kind: external_exports.literal("review"),
  author: external_exports.string().optional().default("unknown"),
  body: external_exports.string().optional().default(""),
  createdAt: external_exports.number().optional().default(0),
  url: external_exports.string().optional().default(""),
  reviewState: external_exports.enum(["approved", "changes_requested", "commented"]).optional().default("commented")
});
var PullRequestTimelineCommentItemSchema = external_exports.object({
  id: external_exports.string().optional().default(""),
  kind: external_exports.literal("comment"),
  author: external_exports.string().optional().default("unknown"),
  body: external_exports.string().optional().default(""),
  createdAt: external_exports.number().optional().default(0),
  url: external_exports.string().optional().default("")
});
var PullRequestTimelineItemSchema = external_exports.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const item = value;
  if (item.kind === "review" || item.kind === "comment") {
    return item;
  }
  return { ...item, kind: "comment" };
}, external_exports.discriminatedUnion("kind", [
  PullRequestTimelineReviewItemSchema,
  PullRequestTimelineCommentItemSchema
]));
var PullRequestTimelineResponseSchema = external_exports.object({
  type: external_exports.literal("pull_request_timeline_response"),
  payload: external_exports.object({
    cwd: external_exports.string().optional().default(""),
    prNumber: external_exports.number().nullable().optional().default(null),
    items: external_exports.array(PullRequestTimelineItemSchema).optional().default([]),
    truncated: external_exports.boolean().optional().default(false),
    error: PullRequestTimelineErrorSchema.nullable().optional().default(null),
    requestId: external_exports.string().optional().default(""),
    githubFeaturesEnabled: external_exports.boolean().optional().default(true)
  }).optional().default({})
});
var CheckoutSwitchBranchResponseSchema = external_exports.object({
  type: external_exports.literal("checkout_switch_branch_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    branch: external_exports.string(),
    source: external_exports.enum(["local", "remote"]).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutRenameBranchResponseSchema = external_exports.object({
  type: external_exports.literal("checkout.rename_branch.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    success: external_exports.boolean(),
    cwd: external_exports.string(),
    currentBranch: external_exports.string().nullable(),
    error: CheckoutErrorSchema.nullable()
  })
});
var StashEntrySchema = external_exports.object({
  index: external_exports.number().int().min(0),
  message: external_exports.string(),
  branch: external_exports.string().nullable(),
  isChisaCode: external_exports.boolean()
});
var StashSaveResponseSchema = external_exports.object({
  type: external_exports.literal("stash_save_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var StashPopResponseSchema = external_exports.object({
  type: external_exports.literal("stash_pop_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    success: external_exports.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var StashListResponseSchema = external_exports.object({
  type: external_exports.literal("stash_list_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    entries: external_exports.array(StashEntrySchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var ValidateBranchResponseSchema = external_exports.object({
  type: external_exports.literal("validate_branch_response"),
  payload: external_exports.object({
    exists: external_exports.boolean(),
    resolvedRef: external_exports.string().nullable(),
    isRemote: external_exports.boolean(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var BranchSuggestionsResponseSchema = external_exports.object({
  type: external_exports.literal("branch_suggestions_response"),
  payload: external_exports.object({
    branches: external_exports.array(external_exports.string()),
    branchDetails: external_exports.array(external_exports.object({
      name: external_exports.string(),
      committerDate: external_exports.number(),
      hasLocal: external_exports.boolean().optional(),
      hasRemote: external_exports.boolean().optional()
    })).optional(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var GitHubSearchResponseSchema = external_exports.object({
  type: external_exports.literal("github_search_response"),
  payload: external_exports.object({
    items: external_exports.array(GitHubSearchItemSchema),
    githubFeaturesEnabled: external_exports.boolean(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var CheckoutInboundMessageSchemas = [
  CheckoutStatusRequestSchema,
  SubscribeCheckoutDiffRequestSchema,
  UnsubscribeCheckoutDiffRequestSchema,
  CheckoutCommitRequestSchema,
  CheckoutMergeRequestSchema,
  CheckoutMergeFromBaseRequestSchema,
  CheckoutPullRequestSchema,
  CheckoutPushRequestSchema,
  CheckoutRefreshRequestSchema,
  CheckoutPrCreateRequestSchema,
  CheckoutPrMergeRequestSchema,
  CheckoutGithubSetAutoMergeRequestSchema,
  CheckoutPrStatusRequestSchema,
  PullRequestTimelineRequestSchema,
  ValidateBranchRequestSchema,
  CheckoutSwitchBranchRequestSchema,
  CheckoutRenameBranchRequestSchema,
  StashSaveRequestSchema,
  StashPopRequestSchema,
  StashListRequestSchema,
  BranchSuggestionsRequestSchema,
  GitHubSearchRequestSchema
];
var CheckoutOutboundMessageSchemas = [
  CheckoutStatusResponseSchema,
  CheckoutStatusUpdateSchema,
  SubscribeCheckoutDiffResponseSchema,
  CheckoutDiffUpdateSchema,
  CheckoutCommitResponseSchema,
  CheckoutMergeResponseSchema,
  CheckoutMergeFromBaseResponseSchema,
  CheckoutPullResponseSchema,
  CheckoutPushResponseSchema,
  CheckoutRefreshResponseSchema,
  CheckoutPrCreateResponseSchema,
  CheckoutPrMergeResponseSchema,
  CheckoutGithubSetAutoMergeResponseSchema,
  CheckoutPrStatusResponseSchema,
  PullRequestTimelineResponseSchema,
  CheckoutSwitchBranchResponseSchema,
  CheckoutRenameBranchResponseSchema,
  StashSaveResponseSchema,
  StashPopResponseSchema,
  StashListResponseSchema,
  ValidateBranchResponseSchema,
  BranchSuggestionsResponseSchema,
  GitHubSearchResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/agent/attachments.js
var GitHubPrAttachmentSchema = external_exports.object({
  type: external_exports.literal("github_pr"),
  mimeType: external_exports.literal("application/github-pr"),
  number: external_exports.number().int().positive(),
  title: external_exports.string(),
  url: external_exports.string(),
  body: external_exports.string().nullable().optional(),
  baseRefName: external_exports.string().nullable().optional(),
  headRefName: external_exports.string().nullable().optional()
});
var GitHubIssueAttachmentSchema = external_exports.object({
  type: external_exports.literal("github_issue"),
  mimeType: external_exports.literal("application/github-issue"),
  number: external_exports.number().int().positive(),
  title: external_exports.string(),
  url: external_exports.string(),
  body: external_exports.string().nullable().optional()
});
var TextAttachmentSchema = external_exports.object({
  type: external_exports.literal("text"),
  mimeType: external_exports.literal("text/plain"),
  title: external_exports.string().nullable().optional(),
  text: external_exports.string()
});
var ReviewAttachmentContextLineSchema = external_exports.object({
  oldLineNumber: external_exports.number().int().positive().nullable(),
  newLineNumber: external_exports.number().int().positive().nullable(),
  type: external_exports.enum(["add", "remove", "context"]),
  content: external_exports.string()
});
var ReviewAttachmentCommentSchema = external_exports.object({
  filePath: external_exports.string(),
  side: external_exports.enum(["old", "new"]),
  lineNumber: external_exports.number().int().positive(),
  body: external_exports.string(),
  context: external_exports.object({
    hunkHeader: external_exports.string(),
    targetLine: ReviewAttachmentContextLineSchema,
    lines: external_exports.array(ReviewAttachmentContextLineSchema)
  })
});
var REVIEW_ATTACHMENT_MIME_TYPE = "application/chisacode-review";
var LEGACY_REVIEW_ATTACHMENT_MIME_TYPE = "application/chisacode-review";
var ReviewAttachmentSchema = external_exports.object({
  type: external_exports.literal("review"),
  mimeType: external_exports.enum([REVIEW_ATTACHMENT_MIME_TYPE, LEGACY_REVIEW_ATTACHMENT_MIME_TYPE]),
  cwd: external_exports.string(),
  mode: external_exports.enum(["uncommitted", "base"]),
  baseRef: external_exports.string().nullable().optional(),
  comments: external_exports.array(ReviewAttachmentCommentSchema)
});
var AgentAttachmentSchema = external_exports.discriminatedUnion("type", [
  GitHubPrAttachmentSchema,
  GitHubIssueAttachmentSchema,
  TextAttachmentSchema,
  ReviewAttachmentSchema
]);
function normalizeAgentAttachments(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = [];
  for (const item of input) {
    const parsed = AgentAttachmentSchema.safeParse(item);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}
var AgentAttachmentsSchema = external_exports.unknown().transform(normalizeAgentAttachments).optional();

// vendor/chisacode-remote/packages/protocol/dist/workspace/messages.js
var WorktreeSetupCommandSnapshotSchema = external_exports.object({
  index: external_exports.number().int().positive(),
  command: external_exports.string(),
  cwd: external_exports.string(),
  log: external_exports.string().optional().default(""),
  status: external_exports.enum(["running", "completed", "failed"]),
  exitCode: external_exports.number().nullable(),
  durationMs: external_exports.number().nonnegative().optional()
});
var WorktreeSetupDetailPayloadSchema = external_exports.object({
  type: external_exports.literal("worktree_setup"),
  worktreePath: external_exports.string(),
  branchName: external_exports.string(),
  log: external_exports.string(),
  commands: external_exports.array(WorktreeSetupCommandSnapshotSchema),
  truncated: external_exports.boolean().optional()
});
var WorkspaceStateBucketSchema = external_exports.enum([
  "needs_input",
  "failed",
  "running",
  "attention",
  "done"
]);
var FetchWorkspacesRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_workspaces_request"),
  requestId: external_exports.string(),
  filter: external_exports.object({
    query: external_exports.string().optional(),
    projectId: external_exports.string().optional(),
    idPrefix: external_exports.string().optional()
  }).optional(),
  sort: external_exports.array(external_exports.object({
    key: external_exports.enum(["status_priority", "activity_at", "name", "project_id"]),
    direction: external_exports.enum(["asc", "desc"])
  })).optional(),
  page: external_exports.object({
    limit: external_exports.number().int().positive().max(200),
    cursor: external_exports.string().min(1).optional()
  }).optional(),
  subscribe: external_exports.object({
    subscriptionId: external_exports.string().optional()
  }).optional()
});
var DirectorySuggestionsRequestSchema = external_exports.object({
  type: external_exports.literal("directory_suggestions_request"),
  query: external_exports.string(),
  cwd: external_exports.string().optional(),
  includeFiles: external_exports.boolean().optional(),
  includeDirectories: external_exports.boolean().optional(),
  matchMode: external_exports.enum(["fuzzy", "suffix"]).optional(),
  limit: external_exports.number().int().min(1).max(100).optional(),
  requestId: external_exports.string()
});
var ChisaCodeWorktreeListRequestSchema = external_exports.object({
  type: external_exports.literal("chisacode_worktree_list_request"),
  cwd: external_exports.string().optional(),
  repoRoot: external_exports.string().optional(),
  requestId: external_exports.string()
});
var ChisaCodeWorktreeArchiveRequestSchema = external_exports.object({
  type: external_exports.literal("chisacode_worktree_archive_request"),
  worktreePath: external_exports.string().optional(),
  repoRoot: external_exports.string().optional(),
  branchName: external_exports.string().optional(),
  requestId: external_exports.string()
});
var FirstAgentContextSchema = external_exports.object({
  prompt: external_exports.string().optional(),
  attachments: AgentAttachmentsSchema
});
var CreateChisaCodeWorktreeRequestSchema = external_exports.object({
  type: external_exports.literal("create_chisacode_worktree_request"),
  cwd: external_exports.string(),
  projectId: external_exports.string().optional(),
  worktreeSlug: external_exports.string().optional(),
  nameContext: external_exports.string().optional(),
  attachments: AgentAttachmentsSchema.optional(),
  firstAgentContext: FirstAgentContextSchema.optional(),
  refName: external_exports.string().min(1).optional(),
  action: external_exports.enum(["branch-off", "checkout"]).optional(),
  githubPrNumber: external_exports.number().int().positive().optional(),
  requestId: external_exports.string()
});
var WorkspaceSetupStatusRequestSchema = external_exports.object({
  type: external_exports.literal("workspace_setup_status_request"),
  workspaceId: external_exports.string(),
  requestId: external_exports.string()
});
var LEGACY_EDITOR_TARGET_IDS = [
  "cursor",
  "vscode",
  "zed",
  "finder",
  "explorer",
  "file-manager"
];
var KNOWN_EDITOR_TARGET_IDS = [...LEGACY_EDITOR_TARGET_IDS, "webstorm"];
var KnownEditorTargetIdSchema = external_exports.enum(KNOWN_EDITOR_TARGET_IDS);
var LegacyEditorTargetIdSchema = external_exports.enum(LEGACY_EDITOR_TARGET_IDS);
var EditorTargetIdSchema = external_exports.string().trim().min(1);
var KNOWN_EDITOR_TARGET_ID_SET = new Set(KNOWN_EDITOR_TARGET_IDS);
var LEGACY_EDITOR_TARGET_ID_SET = new Set(LEGACY_EDITOR_TARGET_IDS);
var EditorTargetDescriptorPayloadSchema = external_exports.object({
  id: EditorTargetIdSchema,
  label: external_exports.string()
});
var ListAvailableEditorsRequestSchema = external_exports.object({
  type: external_exports.literal("list_available_editors_request"),
  requestId: external_exports.string()
});
var OpenInEditorRequestSchema = external_exports.object({
  type: external_exports.literal("open_in_editor_request"),
  path: external_exports.string(),
  editorId: EditorTargetIdSchema,
  requestId: external_exports.string()
});
var OpenProjectRequestSchema = external_exports.object({
  type: external_exports.literal("open_project_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var ArchiveWorkspaceRequestSchema = external_exports.object({
  type: external_exports.literal("archive_workspace_request"),
  workspaceId: external_exports.string(),
  requestId: external_exports.string()
});
var WorkspaceCreateRequestSchema = external_exports.object({
  type: external_exports.literal("workspace.create.request"),
  requestId: external_exports.string(),
  title: external_exports.string().optional(),
  firstAgentContext: FirstAgentContextSchema.optional(),
  source: external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("directory"),
      path: external_exports.string(),
      projectId: external_exports.string().optional()
    }),
    external_exports.object({
      kind: external_exports.literal("worktree"),
      cwd: external_exports.string().optional(),
      projectId: external_exports.string().optional(),
      action: external_exports.enum(["branch-off", "checkout"]).optional(),
      refName: external_exports.string().min(1).optional(),
      baseBranch: external_exports.string().optional(),
      githubPrNumber: external_exports.number().int().positive().optional(),
      worktreeSlug: external_exports.string().optional()
    })
  ])
});
var FileExplorerEntrySchema = external_exports.object({
  name: external_exports.string(),
  path: external_exports.string(),
  kind: external_exports.enum(["file", "directory"]),
  size: external_exports.number(),
  modifiedAt: external_exports.string()
});
var FileExplorerFileSchema = external_exports.object({
  path: external_exports.string(),
  kind: external_exports.enum(["text", "image", "binary"]),
  encoding: external_exports.enum(["utf-8", "base64", "none"]),
  content: external_exports.string().optional(),
  mimeType: external_exports.string().optional(),
  size: external_exports.number(),
  modifiedAt: external_exports.string()
});
var FileExplorerDirectorySchema = external_exports.object({
  path: external_exports.string(),
  entries: external_exports.array(FileExplorerEntrySchema)
});
var FileExplorerRequestSchema = external_exports.object({
  type: external_exports.literal("file_explorer_request"),
  cwd: external_exports.string(),
  path: external_exports.string().optional(),
  mode: external_exports.enum(["list", "file"]),
  requestId: external_exports.string(),
  acceptBinary: external_exports.boolean().optional()
});
var ProjectIconRequestSchema = external_exports.object({
  type: external_exports.literal("project_icon_request"),
  cwd: external_exports.string(),
  requestId: external_exports.string()
});
var FileDownloadTokenRequestSchema = external_exports.object({
  type: external_exports.literal("file_download_token_request"),
  cwd: external_exports.string(),
  path: external_exports.string(),
  requestId: external_exports.string()
});
var ProjectCheckoutLiteNotGitPayloadSchema = external_exports.object({
  cwd: external_exports.string(),
  isGit: external_exports.literal(false),
  currentBranch: external_exports.null(),
  remoteUrl: external_exports.null(),
  worktreeRoot: external_exports.null().optional(),
  isChisaCodeOwnedWorktree: external_exports.literal(false),
  mainRepoRoot: external_exports.null()
}).transform((value) => ({
  ...value,
  worktreeRoot: null
}));
var ProjectCheckoutLiteGitNonChisaCodePayloadSchema = external_exports.object({
  cwd: external_exports.string(),
  isGit: external_exports.literal(true),
  currentBranch: external_exports.string().nullable(),
  remoteUrl: external_exports.string().nullable(),
  worktreeRoot: external_exports.string().optional(),
  isChisaCodeOwnedWorktree: external_exports.literal(false),
  mainRepoRoot: external_exports.string().nullable().optional().default(null)
}).transform((value) => ({
  ...value,
  worktreeRoot: value.worktreeRoot ?? value.cwd
}));
var ProjectCheckoutLiteGitChisaCodePayloadSchema = external_exports.object({
  cwd: external_exports.string(),
  isGit: external_exports.literal(true),
  currentBranch: external_exports.string().nullable(),
  remoteUrl: external_exports.string().nullable(),
  worktreeRoot: external_exports.string().optional(),
  isChisaCodeOwnedWorktree: external_exports.literal(true),
  mainRepoRoot: external_exports.string()
}).transform((value) => ({
  ...value,
  worktreeRoot: value.worktreeRoot ?? value.cwd
}));
var ProjectCheckoutLitePayloadSchema = external_exports.union([
  ProjectCheckoutLiteNotGitPayloadSchema,
  ProjectCheckoutLiteGitNonChisaCodePayloadSchema,
  ProjectCheckoutLiteGitChisaCodePayloadSchema
]);
var ProjectPlacementPayloadSchema = external_exports.object({
  projectKey: external_exports.string(),
  projectName: external_exports.string(),
  checkout: ProjectCheckoutLitePayloadSchema
});
var WorkspaceScriptLifecycleSchema = external_exports.enum(["running", "stopped"]);
var WorkspaceScriptHealthSchema = external_exports.enum(["healthy", "unhealthy"]);
var WorkspaceScriptPayloadSchema = external_exports.object({
  scriptName: external_exports.string(),
  type: external_exports.enum(["script", "service"]).optional().default("service"),
  hostname: external_exports.string(),
  port: external_exports.number().int().positive().nullable(),
  proxyUrl: external_exports.string().nullable().optional().default(null),
  lifecycle: WorkspaceScriptLifecycleSchema,
  health: WorkspaceScriptHealthSchema.nullable(),
  exitCode: external_exports.number().nullable().optional().default(null),
  terminalId: external_exports.string().nullable().optional().default(null)
});
var WorkspaceGitRuntimePayloadSchema = external_exports.object({
  currentBranch: external_exports.string().nullable().optional(),
  remoteUrl: external_exports.string().nullable().optional(),
  isChisaCodeOwnedWorktree: external_exports.boolean().optional(),
  isDirty: external_exports.boolean().nullable().optional(),
  aheadBehind: external_exports.object({
    ahead: external_exports.number(),
    behind: external_exports.number()
  }).nullable().optional(),
  aheadOfOrigin: external_exports.number().nullable().optional(),
  behindOfOrigin: external_exports.number().nullable().optional()
}).optional().nullable();
var WorkspaceGitHubRuntimePayloadSchema = external_exports.object({
  featuresEnabled: external_exports.boolean().optional(),
  pullRequest: external_exports.object({
    number: external_exports.number().optional(),
    url: external_exports.string(),
    title: external_exports.string(),
    state: external_exports.string(),
    baseRefName: external_exports.string(),
    headRefName: external_exports.string(),
    isMerged: external_exports.boolean(),
    isDraft: external_exports.boolean().optional(),
    mergeable: external_exports.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN").optional(),
    checks: external_exports.array(external_exports.object({
      name: external_exports.string(),
      status: external_exports.enum(["success", "failure", "pending", "skipped", "cancelled"]),
      url: external_exports.string().nullable(),
      workflow: external_exports.string().optional(),
      duration: external_exports.string().optional()
    })).optional(),
    checksStatus: external_exports.enum(["none", "pending", "success", "failure"]).optional(),
    reviewDecision: external_exports.enum(["approved", "changes_requested", "pending"]).nullable().optional(),
    repoOwner: external_exports.string().optional(),
    repoName: external_exports.string().optional(),
    github: external_exports.unknown().optional()
  }).nullable().optional(),
  error: external_exports.object({
    message: external_exports.string()
  }).nullable().optional(),
  refreshedAt: external_exports.string().nullable().optional()
}).optional().nullable();
var WorkspaceDescriptorPayloadSchema = external_exports.object({
  id: external_exports.string(),
  projectId: external_exports.string(),
  projectDisplayName: external_exports.string(),
  // COMPAT(projectCustomName): added in v0.1.76, drop the optional gate when floor >= v0.1.76.
  // When the user has renamed a project, projectDisplayName carries the resolved
  // value (customName) and projectCustomName mirrors the raw override so the
  // settings UI can prefill its input and offer a "reset" action.
  projectCustomName: external_exports.string().nullable().optional(),
  projectRootPath: external_exports.string(),
  workspaceDirectory: external_exports.string().optional(),
  projectKind: external_exports.enum(["git", "non_git", "directory"]),
  // COMPAT(workspaces): keep legacy directory workspace kind parseable.
  workspaceKind: external_exports.enum(["directory", "local_checkout", "checkout", "worktree"]),
  name: external_exports.string(),
  archivingAt: external_exports.string().nullable().optional().default(null),
  status: WorkspaceStateBucketSchema,
  activityAt: external_exports.string().nullable(),
  diffStat: external_exports.object({
    additions: external_exports.number(),
    deletions: external_exports.number()
  }).nullable().optional(),
  scripts: external_exports.array(WorkspaceScriptPayloadSchema).default([]),
  gitRuntime: WorkspaceGitRuntimePayloadSchema,
  githubRuntime: WorkspaceGitHubRuntimePayloadSchema,
  project: ProjectPlacementPayloadSchema.optional()
}).transform((workspace) => ({
  ...workspace,
  workspaceDirectory: workspace.workspaceDirectory ?? workspace.projectRootPath
}));
var FetchWorkspacesResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_workspaces_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    subscriptionId: external_exports.string().nullable().optional(),
    entries: external_exports.array(WorkspaceDescriptorPayloadSchema),
    pageInfo: external_exports.object({
      nextCursor: external_exports.string().nullable(),
      prevCursor: external_exports.string().nullable(),
      hasMore: external_exports.boolean()
    })
  })
});
var WorkspaceUpdateMessageSchema = external_exports.object({
  type: external_exports.literal("workspace_update"),
  payload: external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("upsert"),
      workspace: WorkspaceDescriptorPayloadSchema
    }),
    external_exports.object({
      kind: external_exports.literal("remove"),
      id: external_exports.string()
    })
  ])
});
var ScriptStatusUpdateMessageSchema = external_exports.object({
  type: external_exports.literal("script_status_update"),
  payload: external_exports.object({
    workspaceId: external_exports.string(),
    scripts: external_exports.array(WorkspaceScriptPayloadSchema)
  })
});
var WorkspaceSetupProgressMessageSchema = external_exports.object({
  type: external_exports.literal("workspace_setup_progress"),
  payload: external_exports.object({
    workspaceId: external_exports.string(),
    status: external_exports.enum(["running", "completed", "failed"]),
    detail: WorktreeSetupDetailPayloadSchema,
    error: external_exports.string().nullable()
  })
});
var WorkspaceSetupSnapshotSchema = external_exports.object({
  status: external_exports.enum(["running", "completed", "failed"]),
  detail: WorktreeSetupDetailPayloadSchema,
  error: external_exports.string().nullable()
});
var WorkspaceSetupStatusResponseMessageSchema = external_exports.object({
  type: external_exports.literal("workspace_setup_status_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    workspaceId: external_exports.string(),
    snapshot: WorkspaceSetupSnapshotSchema.nullable()
  })
});
var OpenProjectResponseMessageSchema = external_exports.object({
  type: external_exports.literal("open_project_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var StartWorkspaceScriptResponseMessageSchema = external_exports.object({
  type: external_exports.literal("start_workspace_script_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    workspaceId: external_exports.string(),
    scriptName: external_exports.string(),
    terminalId: external_exports.string().nullable(),
    error: external_exports.string().nullable()
  })
});
var ListAvailableEditorsResponseMessageSchema = external_exports.object({
  type: external_exports.literal("list_available_editors_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    editors: external_exports.array(EditorTargetDescriptorPayloadSchema),
    error: external_exports.string().nullable()
  })
});
var OpenInEditorResponseMessageSchema = external_exports.object({
  type: external_exports.literal("open_in_editor_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    error: external_exports.string().nullable()
  })
});
var ArchiveWorkspaceResponseMessageSchema = external_exports.object({
  type: external_exports.literal("archive_workspace_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    workspaceId: external_exports.string(),
    archivedAt: external_exports.string().nullable(),
    error: external_exports.string().nullable()
  })
});
var WorkspaceCreateResponseSchema = external_exports.object({
  type: external_exports.literal("workspace.create.response"),
  payload: external_exports.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    setupTerminalId: external_exports.string().nullable(),
    error: external_exports.string().nullable(),
    errorCode: external_exports.string().optional(),
    requestId: external_exports.string()
  })
});
var DirectorySuggestionsResponseSchema = external_exports.object({
  type: external_exports.literal("directory_suggestions_response"),
  payload: external_exports.object({
    directories: external_exports.array(external_exports.string()),
    entries: external_exports.array(external_exports.object({
      path: external_exports.string(),
      kind: external_exports.enum(["file", "directory"])
    })).optional().default([]),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var ChisaCodeWorktreeSchema = external_exports.object({
  worktreePath: external_exports.string(),
  createdAt: external_exports.string(),
  branchName: external_exports.string().nullable().optional(),
  head: external_exports.string().nullable().optional()
});
var ChisaCodeWorktreeListResponseSchema = external_exports.object({
  type: external_exports.literal("chisacode_worktree_list_response"),
  payload: external_exports.object({
    worktrees: external_exports.array(ChisaCodeWorktreeSchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var ChisaCodeWorktreeArchiveResponseSchema = external_exports.object({
  type: external_exports.literal("chisacode_worktree_archive_response"),
  payload: external_exports.object({
    success: external_exports.boolean(),
    removedAgents: external_exports.array(external_exports.string()).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: external_exports.string()
  })
});
var CreateChisaCodeWorktreeResponseSchema = external_exports.object({
  type: external_exports.literal("create_chisacode_worktree_response"),
  payload: external_exports.object({
    workspace: WorkspaceDescriptorPayloadSchema.nullable(),
    error: external_exports.string().nullable(),
    errorCode: external_exports.string().optional(),
    setupTerminalId: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var FileExplorerResponseSchema = external_exports.object({
  type: external_exports.literal("file_explorer_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    path: external_exports.string(),
    mode: external_exports.enum(["list", "file"]),
    directory: FileExplorerDirectorySchema.nullable(),
    file: FileExplorerFileSchema.nullable(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var ProjectIconSchema = external_exports.object({
  data: external_exports.string(),
  mimeType: external_exports.string()
});
var ProjectIconResponseSchema = external_exports.object({
  type: external_exports.literal("project_icon_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    icon: ProjectIconSchema.nullable(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var FileDownloadTokenResponseSchema = external_exports.object({
  type: external_exports.literal("file_download_token_response"),
  payload: external_exports.object({
    cwd: external_exports.string(),
    path: external_exports.string(),
    token: external_exports.string().nullable(),
    fileName: external_exports.string().nullable(),
    mimeType: external_exports.string().nullable(),
    size: external_exports.number().nullable(),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var WorkspaceInboundMessageSchemas = [
  FetchWorkspacesRequestMessageSchema,
  DirectorySuggestionsRequestSchema,
  ChisaCodeWorktreeListRequestSchema,
  ChisaCodeWorktreeArchiveRequestSchema,
  CreateChisaCodeWorktreeRequestSchema,
  WorkspaceSetupStatusRequestSchema,
  ListAvailableEditorsRequestSchema,
  OpenInEditorRequestSchema,
  OpenProjectRequestSchema,
  ArchiveWorkspaceRequestSchema,
  WorkspaceCreateRequestSchema,
  FileExplorerRequestSchema,
  ProjectIconRequestSchema,
  FileDownloadTokenRequestSchema
];
var WorkspaceOutboundMessageSchemas = [
  WorkspaceUpdateMessageSchema,
  ScriptStatusUpdateMessageSchema,
  WorkspaceSetupProgressMessageSchema,
  WorkspaceSetupStatusResponseMessageSchema,
  FetchWorkspacesResponseMessageSchema,
  OpenProjectResponseMessageSchema,
  StartWorkspaceScriptResponseMessageSchema,
  ListAvailableEditorsResponseMessageSchema,
  OpenInEditorResponseMessageSchema,
  ArchiveWorkspaceResponseMessageSchema,
  WorkspaceCreateResponseSchema,
  DirectorySuggestionsResponseSchema,
  ChisaCodeWorktreeListResponseSchema,
  ChisaCodeWorktreeArchiveResponseSchema,
  CreateChisaCodeWorktreeResponseSchema,
  FileExplorerResponseSchema,
  ProjectIconResponseSchema,
  FileDownloadTokenResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/agent-types.js
function normalizeAgentModelDefinition(model) {
  const defaultThinkingOptionId = model.defaultThinkingOptionId ?? model.thinkingOptions?.find((option) => option.isDefault)?.id;
  if (!defaultThinkingOptionId || defaultThinkingOptionId === model.defaultThinkingOptionId) {
    return model;
  }
  return { ...model, defaultThinkingOptionId };
}
var TOOL_CALL_ICON_NAMES = [
  "wrench",
  "square_terminal",
  "eye",
  "pencil",
  "search",
  "bot",
  "sparkles",
  "brain",
  "mic_vocal"
];

// vendor/chisacode-remote/packages/protocol/dist/provider/messages.js
var AgentModeSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  icon: external_exports.string().optional(),
  colorTier: external_exports.string().optional()
});
var ProviderStatusSchema = external_exports.enum([
  "ready",
  "loading",
  "error",
  "unavailable"
]);
var AgentSelectOptionSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  isDefault: external_exports.boolean().optional(),
  metadata: external_exports.record(external_exports.unknown()).optional()
});
var AgentFeatureToggleSchema = external_exports.object({
  type: external_exports.literal("toggle"),
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  tooltip: external_exports.string().optional(),
  icon: external_exports.string().optional(),
  value: external_exports.boolean()
});
var AgentFeatureSelectSchema = external_exports.object({
  type: external_exports.literal("select"),
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  tooltip: external_exports.string().optional(),
  icon: external_exports.string().optional(),
  value: external_exports.string().nullable(),
  options: external_exports.array(AgentSelectOptionSchema)
});
var AgentFeatureSchema = external_exports.discriminatedUnion("type", [
  AgentFeatureToggleSchema,
  AgentFeatureSelectSchema
]);
var AgentModelDefinitionSchema = external_exports.object({
  provider: AgentProviderSchema,
  id: external_exports.string(),
  label: external_exports.string(),
  description: external_exports.string().optional(),
  isDefault: external_exports.boolean().optional(),
  metadata: external_exports.record(external_exports.unknown()).optional(),
  thinkingOptions: external_exports.array(AgentSelectOptionSchema).optional(),
  defaultThinkingOptionId: external_exports.string().optional()
}).transform(normalizeAgentModelDefinition);
var ProviderSnapshotEntrySchema = external_exports.object({
  provider: AgentProviderSchema,
  status: ProviderStatusSchema,
  statusReason: external_exports.enum([
    "disabled",
    "command_unavailable",
    "runtime_unavailable",
    "model_discovery_failed",
    "refresh_failed",
    "configuration_changed"
  ]).optional(),
  enabled: external_exports.boolean().optional().default(true),
  error: external_exports.string().optional(),
  models: external_exports.array(AgentModelDefinitionSchema).optional(),
  modes: external_exports.array(AgentModeSchema).optional(),
  fetchedAt: external_exports.string().optional(),
  label: external_exports.string().optional(),
  description: external_exports.string().optional(),
  defaultModeId: external_exports.string().nullable().optional(),
  derivedFromProviderId: AgentProviderSchema.nullable().optional(),
  modelGatewayId: external_exports.string().nullable().optional(),
  installedVersion: external_exports.string().nullable().optional(),
  latestVersion: external_exports.string().nullable().optional(),
  versionStatus: external_exports.enum(["unknown", "not-installed", "current", "outdated"]).optional(),
  packageName: external_exports.string().optional(),
  checkedAt: external_exports.string().optional(),
  installAvailable: external_exports.boolean().optional(),
  updateAvailable: external_exports.boolean().optional()
});
var ProviderDiagnosticDetailsSchema = external_exports.object({
  provider: AgentProviderSchema,
  effectiveCommand: external_exports.object({
    argv: external_exports.array(external_exports.string()),
    source: external_exports.enum(["default", "append", "override", "custom", "unknown"]),
    resolvedPath: external_exports.string().nullable(),
    available: external_exports.boolean()
  }).optional(),
  cwd: external_exports.string().optional(),
  env: external_exports.array(external_exports.object({
    name: external_exports.string(),
    present: external_exports.boolean(),
    source: external_exports.enum(["process", "provider-config"])
  })).optional(),
  mcpInjection: external_exports.object({
    supported: external_exports.boolean(),
    enabled: external_exports.boolean(),
    reason: external_exports.string()
  }).optional(),
  tooling: ProviderSnapshotEntrySchema.pick({
    installedVersion: true,
    latestVersion: true,
    versionStatus: true,
    packageName: true,
    installAvailable: true,
    updateAvailable: true,
    checkedAt: true
  }).partial().optional()
});
var RecentProviderSessionDescriptorPayloadSchema = external_exports.object({
  providerId: external_exports.string(),
  providerLabel: external_exports.string(),
  providerHandleId: external_exports.string(),
  cwd: external_exports.string(),
  title: external_exports.string().nullable(),
  firstPromptPreview: external_exports.string().nullable(),
  lastPromptPreview: external_exports.string().nullable(),
  lastActivityAt: external_exports.string()
});
var FetchRecentProviderSessionsRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_recent_provider_sessions_request"),
  requestId: external_exports.string(),
  cwd: external_exports.string().optional(),
  providers: external_exports.array(external_exports.string()).optional(),
  since: external_exports.string().optional(),
  limit: external_exports.number().int().positive().max(200).optional()
});
var ListProviderModelsRequestMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_models_request"),
  provider: AgentProviderSchema,
  cwd: external_exports.string().optional(),
  requestId: external_exports.string()
});
var ListProviderModesRequestMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_modes_request"),
  provider: AgentProviderSchema,
  cwd: external_exports.string().optional(),
  requestId: external_exports.string()
});
var ListAvailableProvidersRequestMessageSchema = external_exports.object({
  type: external_exports.literal("list_available_providers_request"),
  requestId: external_exports.string()
});
var GetProvidersSnapshotRequestMessageSchema = external_exports.object({
  type: external_exports.literal("get_providers_snapshot_request"),
  cwd: external_exports.string().optional(),
  requestId: external_exports.string()
});
var RefreshProvidersSnapshotRequestMessageSchema = external_exports.object({
  type: external_exports.literal("refresh_providers_snapshot_request"),
  cwd: external_exports.string().optional(),
  providers: external_exports.array(AgentProviderSchema).optional(),
  requestId: external_exports.string()
});
var ProviderDiagnosticRequestMessageSchema = external_exports.object({
  type: external_exports.literal("provider_diagnostic_request"),
  provider: AgentProviderSchema,
  requestId: external_exports.string()
});
var ProviderUsageListRequestMessageSchema = external_exports.object({
  type: external_exports.literal("provider.usage.list.request"),
  requestId: external_exports.string()
});
var DiagnosticsRequestSchema = external_exports.object({
  type: external_exports.literal("diagnostics.request"),
  requestId: external_exports.string(),
  includeLogs: external_exports.boolean().optional(),
  maxLogLines: external_exports.number().int().positive().max(200).optional()
});
var ProviderToolingActionRequestMessageSchema = external_exports.object({
  type: external_exports.literal("provider.tooling.run.request"),
  provider: AgentProviderSchema,
  action: external_exports.enum(["install", "update", "reinstall"]),
  requestId: external_exports.string()
});
var ListCommandsDraftConfigSchema = external_exports.object({
  provider: AgentProviderSchema,
  cwd: external_exports.string(),
  modeId: external_exports.string().optional(),
  model: external_exports.string().optional(),
  thinkingOptionId: external_exports.string().optional(),
  featureValues: external_exports.record(external_exports.unknown()).optional()
});
var ListProviderFeaturesRequestMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_features_request"),
  draftConfig: ListCommandsDraftConfigSchema,
  requestId: external_exports.string()
});
var FetchRecentProviderSessionsResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_recent_provider_sessions_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    entries: external_exports.array(RecentProviderSessionDescriptorPayloadSchema),
    filteredAlreadyImportedCount: external_exports.number().int().nonnegative().optional()
  })
});
var DiagnosticsResponseSchema = external_exports.object({
  type: external_exports.literal("diagnostics.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    diagnostic: external_exports.string()
  }).passthrough()
});
var ListProviderModelsResponseMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_models_response"),
  payload: external_exports.object({
    provider: AgentProviderSchema,
    models: external_exports.array(AgentModelDefinitionSchema).optional(),
    error: external_exports.string().nullable().optional(),
    fetchedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var ListProviderModesResponseMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_modes_response"),
  payload: external_exports.object({
    provider: AgentProviderSchema,
    modes: external_exports.array(AgentModeSchema).optional(),
    error: external_exports.string().nullable().optional(),
    fetchedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var ListProviderFeaturesResponseMessageSchema = external_exports.object({
  type: external_exports.literal("list_provider_features_response"),
  payload: external_exports.object({
    provider: AgentProviderSchema,
    features: external_exports.array(AgentFeatureSchema).optional(),
    error: external_exports.string().nullable().optional(),
    fetchedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var ProviderAvailabilitySchema = external_exports.object({
  provider: AgentProviderSchema,
  available: external_exports.boolean(),
  error: external_exports.string().nullable().optional()
});
var ListAvailableProvidersResponseSchema = external_exports.object({
  type: external_exports.literal("list_available_providers_response"),
  payload: external_exports.object({
    providers: external_exports.array(ProviderAvailabilitySchema),
    error: external_exports.string().nullable().optional(),
    fetchedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var GetProvidersSnapshotResponseMessageSchema = external_exports.object({
  type: external_exports.literal("get_providers_snapshot_response"),
  payload: external_exports.object({
    cwd: external_exports.string().optional(),
    entries: external_exports.array(ProviderSnapshotEntrySchema),
    generatedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var ProvidersSnapshotUpdateMessageSchema = external_exports.object({
  type: external_exports.literal("providers_snapshot_update"),
  payload: external_exports.object({
    cwd: external_exports.string().optional(),
    entries: external_exports.array(ProviderSnapshotEntrySchema),
    generatedAt: external_exports.string()
  })
});
var RefreshProvidersSnapshotResponseMessageSchema = external_exports.object({
  type: external_exports.literal("refresh_providers_snapshot_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    acknowledged: external_exports.boolean()
  })
});
var ProviderDiagnosticResponseMessageSchema = external_exports.object({
  type: external_exports.literal("provider_diagnostic_response"),
  payload: external_exports.object({
    provider: AgentProviderSchema,
    diagnostic: external_exports.string(),
    details: ProviderDiagnosticDetailsSchema.optional(),
    requestId: external_exports.string()
  })
});
var ProviderUsageToneSchema = external_exports.enum(["default", "ok", "warning", "danger"]);
var ProviderUsageStatusSchema = external_exports.enum(["available", "unavailable", "error"]);
var ProviderUsageWindowSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  usedPct: external_exports.number().nullable().optional(),
  remainingPct: external_exports.number().nullable().optional(),
  resetsAt: external_exports.string().nullable().optional(),
  runsOutAt: external_exports.string().nullable().optional(),
  shortfallPct: external_exports.number().nullable().optional(),
  tone: ProviderUsageToneSchema.optional()
});
var ProviderUsageBalanceSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  used: external_exports.number().nullable().optional(),
  remaining: external_exports.number().nullable().optional(),
  limit: external_exports.number().nullable().optional(),
  unit: external_exports.enum(["usd", "credits", "requests", "tokens"]),
  resetsAt: external_exports.string().nullable().optional(),
  tone: ProviderUsageToneSchema.optional()
});
var ProviderUsageDetailSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  value: external_exports.string(),
  tone: ProviderUsageToneSchema.optional()
});
var ProviderUsageSchema = external_exports.object({
  providerId: external_exports.string(),
  displayName: external_exports.string(),
  status: ProviderUsageStatusSchema,
  planLabel: external_exports.string().nullable(),
  sourceLabel: external_exports.string().nullable().optional(),
  fetchedAt: external_exports.string().nullable().optional(),
  nextRefreshAt: external_exports.string().nullable().optional(),
  windows: external_exports.array(ProviderUsageWindowSchema),
  balances: external_exports.array(ProviderUsageBalanceSchema).optional(),
  details: external_exports.array(ProviderUsageDetailSchema).optional(),
  error: external_exports.string().nullable().optional()
});
var ProviderUsageListResponseMessageSchema = external_exports.object({
  type: external_exports.literal("provider.usage.list.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    fetchedAt: external_exports.string(),
    providers: external_exports.array(ProviderUsageSchema)
  })
});
var ProviderToolingActionResponseMessageSchema = external_exports.object({
  type: external_exports.literal("provider.tooling.run.response"),
  payload: external_exports.object({
    provider: AgentProviderSchema,
    action: external_exports.enum(["install", "update", "reinstall"]),
    exitCode: external_exports.number().nullable(),
    stdout: external_exports.string(),
    stderr: external_exports.string(),
    success: external_exports.boolean(),
    requestId: external_exports.string()
  })
});
var ProviderInboundMessageSchemas = [
  FetchRecentProviderSessionsRequestMessageSchema,
  ListProviderModelsRequestMessageSchema,
  ListProviderModesRequestMessageSchema,
  ListProviderFeaturesRequestMessageSchema,
  ListAvailableProvidersRequestMessageSchema,
  GetProvidersSnapshotRequestMessageSchema,
  RefreshProvidersSnapshotRequestMessageSchema,
  ProviderDiagnosticRequestMessageSchema,
  ProviderUsageListRequestMessageSchema,
  DiagnosticsRequestSchema,
  ProviderToolingActionRequestMessageSchema
];
var ProviderOutboundMessageSchemas = [
  FetchRecentProviderSessionsResponseMessageSchema,
  ListProviderModelsResponseMessageSchema,
  ListProviderModesResponseMessageSchema,
  ListProviderFeaturesResponseMessageSchema,
  ListAvailableProvidersResponseSchema,
  GetProvidersSnapshotResponseMessageSchema,
  ProvidersSnapshotUpdateMessageSchema,
  RefreshProvidersSnapshotResponseMessageSchema,
  ProviderDiagnosticResponseMessageSchema,
  ProviderUsageListResponseMessageSchema,
  DiagnosticsResponseSchema,
  ProviderToolingActionResponseMessageSchema
];

// vendor/chisacode-remote/packages/protocol/dist/agent/extensions.js
var McpStdioServerConfigSchema = external_exports.object({
  type: external_exports.literal("stdio"),
  command: external_exports.string(),
  args: external_exports.array(external_exports.string()).optional(),
  env: external_exports.record(external_exports.string()).optional()
});
var McpHttpServerConfigSchema = external_exports.object({
  type: external_exports.literal("http"),
  url: external_exports.string(),
  headers: external_exports.record(external_exports.string()).optional()
});
var McpSseServerConfigSchema = external_exports.object({
  type: external_exports.literal("sse"),
  url: external_exports.string(),
  headers: external_exports.record(external_exports.string()).optional()
});
var McpServerConfigSchema = external_exports.discriminatedUnion("type", [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema
]);
var SkillPolicyGlobalConfigSchema = external_exports.object({
  disabledSkillNames: external_exports.array(external_exports.string().min(1)).default([])
}).passthrough();
var SkillPolicyAgentConfigSchema = external_exports.object({
  enabledSkillNames: external_exports.array(external_exports.string().min(1)).default([]),
  disabledSkillNames: external_exports.array(external_exports.string().min(1)).default([])
}).passthrough();
var SkillPolicyProviderConfigSchema = SkillPolicyAgentConfigSchema;
var InstalledSkillSourceSchema = external_exports.object({
  id: external_exports.string().min(1),
  type: external_exports.enum(["github", "local"]),
  url: external_exports.string().min(1).optional(),
  localPath: external_exports.string().min(1).optional(),
  installedAt: external_exports.string().min(1),
  skillNames: external_exports.array(external_exports.string().min(1)).default([])
}).passthrough();
var SkillManagementConfigSchema = external_exports.object({
  global: SkillPolicyGlobalConfigSchema.default({ disabledSkillNames: [] }),
  providers: external_exports.record(external_exports.string(), SkillPolicyProviderConfigSchema).default({}),
  agents: external_exports.record(external_exports.string(), SkillPolicyAgentConfigSchema).default({}),
  installedSources: external_exports.record(external_exports.string(), InstalledSkillSourceSchema).default({})
}).passthrough();
var McpServerPolicyGlobalConfigSchema = external_exports.object({
  disabledServerNames: external_exports.array(external_exports.string().min(1)).default([])
}).passthrough();
var McpServerPolicyAgentConfigSchema = external_exports.object({
  enabledServerNames: external_exports.array(external_exports.string().min(1)).default([]),
  disabledServerNames: external_exports.array(external_exports.string().min(1)).default([])
}).passthrough();
var McpServerPolicyProviderConfigSchema = McpServerPolicyAgentConfigSchema;
var ManagedMcpServerConfigSchema = external_exports.object({
  name: external_exports.string().min(1),
  label: external_exports.string().min(1).optional(),
  description: external_exports.string().optional(),
  config: McpServerConfigSchema,
  createdAt: external_exports.string().min(1).optional(),
  updatedAt: external_exports.string().min(1).optional()
}).passthrough();
var McpServerManagementConfigSchema = external_exports.object({
  servers: external_exports.record(external_exports.string(), ManagedMcpServerConfigSchema).default({}),
  global: McpServerPolicyGlobalConfigSchema.default({ disabledServerNames: [] }),
  providers: external_exports.record(external_exports.string(), McpServerPolicyProviderConfigSchema).default({}),
  agents: external_exports.record(external_exports.string(), McpServerPolicyAgentConfigSchema).default({})
}).passthrough();
var AgentSkillManagementScopeSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("global")
  }),
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string().min(1)
  }),
  external_exports.object({
    type: external_exports.literal("provider"),
    provider: AgentProviderSchema
  })
]);
var AgentSkillsListRequestSchema = external_exports.object({
  type: external_exports.literal("agent.skills.list.request"),
  requestId: external_exports.string()
});
var AgentSkillsPolicyPatchRequestSchema = external_exports.object({
  type: external_exports.literal("agent.skills.policy.patch.request"),
  requestId: external_exports.string(),
  scope: AgentSkillManagementScopeSchema,
  policy: external_exports.object({
    disabledSkillNames: external_exports.array(external_exports.string().min(1)).optional(),
    enabledSkillNames: external_exports.array(external_exports.string().min(1)).optional()
  }).passthrough()
});
var AgentSkillsInstallSourceSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("github"),
    value: external_exports.string().min(1)
  }),
  external_exports.object({
    type: external_exports.literal("local"),
    path: external_exports.string().min(1)
  })
]);
var AgentSkillsInstallRequestSchema = external_exports.object({
  type: external_exports.literal("agent.skills.install.request"),
  requestId: external_exports.string(),
  source: AgentSkillsInstallSourceSchema,
  replace: external_exports.boolean().optional().default(false)
});
var AgentSkillsUninstallRequestSchema = external_exports.object({
  type: external_exports.literal("agent.skills.uninstall.request"),
  requestId: external_exports.string(),
  sourceId: external_exports.string().min(1)
});
var AgentMcpServerManagementScopeSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("global")
  }),
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string().min(1)
  }),
  external_exports.object({
    type: external_exports.literal("provider"),
    provider: AgentProviderSchema
  })
]);
var AgentMcpServersListRequestSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.list.request"),
  requestId: external_exports.string()
});
var AgentMcpServersUpsertRequestSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.upsert.request"),
  requestId: external_exports.string(),
  server: ManagedMcpServerConfigSchema,
  originalName: external_exports.string().min(1).optional()
});
var AgentMcpServersPolicyPatchRequestSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.policy.patch.request"),
  requestId: external_exports.string(),
  scope: AgentMcpServerManagementScopeSchema,
  policy: external_exports.object({
    disabledServerNames: external_exports.array(external_exports.string().min(1)).optional(),
    enabledServerNames: external_exports.array(external_exports.string().min(1)).optional()
  }).passthrough()
});
var AgentMcpServersDeleteRequestSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.delete.request"),
  requestId: external_exports.string(),
  name: external_exports.string().min(1)
});
var AgentSkillSourcePayloadSchema = external_exports.object({
  id: external_exports.string(),
  type: external_exports.enum(["project", "agents-home", "codex-home", "claude-home", "bundled", "unknown"]),
  path: external_exports.string(),
  installedSourceId: external_exports.string().optional(),
  removable: external_exports.boolean().default(false)
}).passthrough();
var AgentSkillStatusSchema = external_exports.enum([
  "enabled",
  "global-disabled",
  "agent-enabled",
  "agent-disabled"
]);
var AgentSkillPayloadSchema = external_exports.object({
  name: external_exports.string(),
  description: external_exports.string().optional(),
  sources: external_exports.array(AgentSkillSourcePayloadSchema),
  statusByScope: external_exports.object({
    global: AgentSkillStatusSchema,
    providers: external_exports.record(external_exports.string(), AgentSkillStatusSchema).default({}),
    agents: external_exports.record(external_exports.string(), AgentSkillStatusSchema).default({})
  }),
  errors: external_exports.array(external_exports.string()).default([])
}).passthrough();
var AgentSkillScopePayloadSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("global"),
    label: external_exports.string()
  }),
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string(),
    label: external_exports.string(),
    status: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("provider"),
    provider: AgentProviderSchema,
    label: external_exports.string(),
    status: external_exports.string().optional()
  })
]);
var AgentSkillsListResponseSchema = external_exports.object({
  type: external_exports.literal("agent.skills.list.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    scopes: external_exports.array(AgentSkillScopePayloadSchema),
    skills: external_exports.array(AgentSkillPayloadSchema),
    policy: SkillManagementConfigSchema,
    errors: external_exports.array(external_exports.string()).default([])
  })
});
var AgentSkillsPolicyPatchResponseSchema = external_exports.object({
  type: external_exports.literal("agent.skills.policy.patch.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    policy: SkillManagementConfigSchema,
    error: external_exports.string().nullable()
  })
});
var AgentSkillsInstallResponseSchema = external_exports.object({
  type: external_exports.literal("agent.skills.install.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    installedSource: InstalledSkillSourceSchema.nullable(),
    skills: external_exports.array(external_exports.string()).default([]),
    error: external_exports.string().nullable()
  })
});
var AgentSkillsUninstallResponseSchema = external_exports.object({
  type: external_exports.literal("agent.skills.uninstall.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    removedSkillNames: external_exports.array(external_exports.string()).default([]),
    policy: SkillManagementConfigSchema,
    error: external_exports.string().nullable()
  })
});
var AgentMcpServerStatusSchema = external_exports.enum([
  "enabled",
  "global-disabled",
  "provider-enabled",
  "provider-disabled",
  "agent-enabled",
  "agent-disabled"
]);
var AgentMcpServerSourceSchema = external_exports.enum(["system", "user"]);
var AgentMcpServerScopePayloadSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("global"),
    label: external_exports.string(),
    status: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("agent"),
    agentId: external_exports.string(),
    label: external_exports.string(),
    provider: AgentProviderSchema.optional(),
    status: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("provider"),
    provider: AgentProviderSchema,
    label: external_exports.string(),
    status: external_exports.string().optional()
  })
]);
var AgentMcpServerPayloadSchema = external_exports.object({
  name: external_exports.string(),
  label: external_exports.string().optional(),
  description: external_exports.string().optional(),
  source: AgentMcpServerSourceSchema,
  removable: external_exports.boolean(),
  editable: external_exports.boolean(),
  config: McpServerConfigSchema,
  statusByScope: external_exports.object({
    global: AgentMcpServerStatusSchema,
    providers: external_exports.record(external_exports.string(), AgentMcpServerStatusSchema).default({}),
    agents: external_exports.record(external_exports.string(), AgentMcpServerStatusSchema).default({})
  }),
  errors: external_exports.array(external_exports.string()).default([])
});
var AgentMcpServersListResponseSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.list.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    scopes: external_exports.array(AgentMcpServerScopePayloadSchema),
    servers: external_exports.array(AgentMcpServerPayloadSchema),
    policy: McpServerManagementConfigSchema,
    errors: external_exports.array(external_exports.string()).default([])
  })
});
var AgentMcpServersUpsertResponseSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.upsert.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    server: ManagedMcpServerConfigSchema.nullable(),
    policy: McpServerManagementConfigSchema,
    error: external_exports.string().nullable()
  })
});
var AgentMcpServersPolicyPatchResponseSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.policy.patch.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    policy: McpServerManagementConfigSchema,
    error: external_exports.string().nullable()
  })
});
var AgentMcpServersDeleteResponseSchema = external_exports.object({
  type: external_exports.literal("agent.mcp_servers.delete.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    removedServerName: external_exports.string().nullable(),
    policy: McpServerManagementConfigSchema,
    error: external_exports.string().nullable()
  })
});
var AgentExtensionInboundMessageSchemas = [
  AgentSkillsListRequestSchema,
  AgentSkillsPolicyPatchRequestSchema,
  AgentSkillsInstallRequestSchema,
  AgentSkillsUninstallRequestSchema,
  AgentMcpServersListRequestSchema,
  AgentMcpServersUpsertRequestSchema,
  AgentMcpServersPolicyPatchRequestSchema,
  AgentMcpServersDeleteRequestSchema
];
var AgentExtensionOutboundMessageSchemas = [
  AgentSkillsListResponseSchema,
  AgentSkillsPolicyPatchResponseSchema,
  AgentSkillsInstallResponseSchema,
  AgentSkillsUninstallResponseSchema,
  AgentMcpServersListResponseSchema,
  AgentMcpServersUpsertResponseSchema,
  AgentMcpServersPolicyPatchResponseSchema,
  AgentMcpServersDeleteResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/chisacode-config-schema.js
function normalizeLifecycleCommands(commands) {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command) => {
    return typeof command === "string" && command.trim().length > 0;
  });
}
var ChisaCodeLifecycleCommandRawSchema = external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]);
var ChisaCodeScriptEntryRawSchema = external_exports.object({
  type: external_exports.unknown().optional(),
  command: external_exports.unknown().optional(),
  port: external_exports.unknown().optional()
}).passthrough();
var ChisaCodeWorktreeConfigRawSchema = external_exports.object({
  setup: ChisaCodeLifecycleCommandRawSchema.optional(),
  teardown: ChisaCodeLifecycleCommandRawSchema.optional(),
  terminals: external_exports.unknown().optional()
}).passthrough();
var ChisaCodeMetadataGenerationEntrySchema = external_exports.object({
  instructions: external_exports.string().optional()
}).passthrough().catch({});
var ChisaCodeMetadataGenerationSchema = external_exports.object({
  agentTitle: ChisaCodeMetadataGenerationEntrySchema.optional(),
  branchName: ChisaCodeMetadataGenerationEntrySchema.optional(),
  commitMessage: ChisaCodeMetadataGenerationEntrySchema.optional(),
  pullRequest: ChisaCodeMetadataGenerationEntrySchema.optional()
}).passthrough().catch({});
var ChisaCodeConfigRawSchema = external_exports.object({
  worktree: ChisaCodeWorktreeConfigRawSchema.optional(),
  scripts: external_exports.record(external_exports.string(), ChisaCodeScriptEntryRawSchema).optional(),
  metadataGeneration: ChisaCodeMetadataGenerationSchema.optional()
}).passthrough();
var WorktreeConfigSchema = ChisaCodeWorktreeConfigRawSchema.extend({
  setup: external_exports.unknown().transform(normalizeLifecycleCommands),
  teardown: external_exports.unknown().transform(normalizeLifecycleCommands)
}).passthrough().catch({ setup: [], teardown: [] });
var ScriptEntrySchema = ChisaCodeScriptEntryRawSchema.catch({});
var ChisaCodeConfigSchema = ChisaCodeConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: external_exports.record(external_exports.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: ChisaCodeMetadataGenerationSchema.optional()
}).passthrough().catch({});
var ChisaCodeConfigRevisionSchema = external_exports.object({
  mtimeMs: external_exports.number(),
  size: external_exports.number()
});
var ProjectConfigRpcErrorSchema = external_exports.discriminatedUnion("code", [
  external_exports.object({ code: external_exports.literal("project_not_found") }),
  external_exports.object({ code: external_exports.literal("invalid_project_config") }),
  external_exports.object({
    code: external_exports.literal("stale_project_config"),
    currentRevision: ChisaCodeConfigRevisionSchema.nullable()
  }),
  external_exports.object({ code: external_exports.literal("write_failed") })
]);

// vendor/chisacode-remote/packages/protocol/dist/daemon/messages.js
var MutableDaemonProviderModelSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().min(1),
  description: external_exports.string().optional(),
  isDefault: external_exports.boolean().optional()
}).passthrough();
var MutableDaemonProviderConfigSchema = external_exports.object({
  enabled: external_exports.boolean().optional(),
  additionalModels: external_exports.array(MutableDaemonProviderModelSchema).optional()
}).passthrough();
var MutableStructuredGenerationProviderSchema = external_exports.object({
  provider: external_exports.string().min(1),
  model: external_exports.string().min(1).optional(),
  thinkingOptionId: external_exports.string().min(1).optional()
}).passthrough();
var MutableMetadataGenerationConfigSchema = external_exports.object({
  providers: external_exports.array(MutableStructuredGenerationProviderSchema).default([])
}).passthrough();
var VisionFallbackModelSchema = external_exports.object({
  provider: external_exports.string().min(1),
  modelId: external_exports.string().min(1)
}).strict();
var MutableDaemonConfigSchema = external_exports.object({
  mcp: external_exports.object({
    injectIntoAgents: external_exports.boolean()
  }).passthrough(),
  providers: external_exports.record(external_exports.string(), MutableDaemonProviderConfigSchema).default({}),
  modelGateways: ModelGatewayConfigsSchema.default({}),
  /**
   * When set, prompts that attach images while the main model has
   * `supportsImages !== true` are preprocessed: the vision model describes
   * each image and the descriptions are injected as text for the main model.
   */
  visionFallbackModel: VisionFallbackModelSchema.nullable().default(null),
  metadataGeneration: MutableMetadataGenerationConfigSchema.default({ providers: [] }),
  autoArchiveAfterMerge: external_exports.boolean().default(false),
  appendSystemPrompt: external_exports.string().default(""),
  skills: SkillManagementConfigSchema.default({
    global: { disabledSkillNames: [] },
    providers: {},
    agents: {},
    installedSources: {}
  }),
  mcpServers: McpServerManagementConfigSchema.default({
    servers: {},
    global: { disabledServerNames: [] },
    providers: {},
    agents: {}
  })
}).passthrough();
var MutableDaemonConfigPatchSchema = external_exports.object({
  mcp: MutableDaemonConfigSchema.shape.mcp.partial().optional(),
  providers: external_exports.record(external_exports.string(), MutableDaemonProviderConfigSchema.partial().passthrough()).optional(),
  modelGateways: external_exports.record(external_exports.string(), ModelGatewayConfigSchema.partial()).optional(),
  visionFallbackModel: VisionFallbackModelSchema.nullable().optional(),
  metadataGeneration: MutableMetadataGenerationConfigSchema.partial().optional(),
  autoArchiveAfterMerge: external_exports.boolean().optional(),
  appendSystemPrompt: external_exports.string().optional(),
  skills: SkillManagementConfigSchema.partial().optional(),
  mcpServers: McpServerManagementConfigSchema.partial().optional()
}).partial().passthrough();
var DaemonGetStatusRequestSchema = external_exports.object({
  type: external_exports.literal("daemon.get_status.request"),
  requestId: external_exports.string()
});
var DaemonGetPairingOfferRequestSchema = external_exports.object({
  type: external_exports.literal("daemon.get_pairing_offer.request"),
  requestId: external_exports.string()
});
var GetDaemonConfigRequestMessageSchema = external_exports.object({
  type: external_exports.literal("get_daemon_config_request"),
  requestId: external_exports.string()
});
var SetDaemonConfigRequestMessageSchema = external_exports.object({
  type: external_exports.literal("set_daemon_config_request"),
  requestId: external_exports.string(),
  config: MutableDaemonConfigPatchSchema
});
var ReadProjectConfigRequestMessageSchema = external_exports.object({
  type: external_exports.literal("read_project_config_request"),
  requestId: external_exports.string(),
  repoRoot: external_exports.string()
});
var WriteProjectConfigRequestMessageSchema = external_exports.object({
  type: external_exports.literal("write_project_config_request"),
  requestId: external_exports.string(),
  repoRoot: external_exports.string(),
  config: ChisaCodeConfigRawSchema,
  expectedRevision: ChisaCodeConfigRevisionSchema.nullable()
});
var RestartServerRequestMessageSchema = external_exports.object({
  type: external_exports.literal("restart_server_request"),
  reason: external_exports.string().optional(),
  requestId: external_exports.string()
});
var ShutdownServerRequestMessageSchema = external_exports.object({
  type: external_exports.literal("shutdown_server_request"),
  requestId: external_exports.string()
});
var RestartRequestedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("restart_requested"),
  clientId: external_exports.string(),
  reason: external_exports.string().optional(),
  requestId: external_exports.string()
});
var ShutdownRequestedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("shutdown_requested"),
  clientId: external_exports.string(),
  requestId: external_exports.string()
});
var DaemonConfigChangedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("daemon_config_changed"),
  config: MutableDaemonConfigSchema
}).passthrough();
var GetDaemonConfigResponseMessageSchema = external_exports.object({
  type: external_exports.literal("get_daemon_config_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    config: MutableDaemonConfigSchema
  }).passthrough()
});
var DaemonGetStatusResponseSchema = external_exports.object({
  type: external_exports.literal("daemon.get_status.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    serverId: external_exports.string(),
    version: external_exports.string().nullable().optional(),
    pid: external_exports.number(),
    nodePath: external_exports.string(),
    startedAt: external_exports.string().nullable().optional(),
    listen: external_exports.string().nullable(),
    relay: external_exports.object({
      enabled: external_exports.boolean(),
      endpoint: external_exports.string(),
      publicEndpoint: external_exports.string(),
      useTls: external_exports.boolean(),
      publicUseTls: external_exports.boolean()
    }).nullable().optional(),
    providers: external_exports.array(external_exports.object({
      provider: external_exports.string(),
      available: external_exports.boolean(),
      error: external_exports.string().nullable().optional()
    }))
  }).passthrough()
});
var DaemonGetPairingOfferResponseSchema = external_exports.object({
  type: external_exports.literal("daemon.get_pairing_offer.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    url: external_exports.string(),
    qr: external_exports.string().nullable().optional(),
    relayEnabled: external_exports.boolean()
  }).passthrough()
});
var SetDaemonConfigResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_daemon_config_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    config: MutableDaemonConfigSchema
  }).passthrough()
});
var ReadProjectConfigResponseMessageSchema = external_exports.object({
  type: external_exports.literal("read_project_config_response"),
  payload: external_exports.discriminatedUnion("ok", [
    external_exports.object({
      requestId: external_exports.string(),
      repoRoot: external_exports.string(),
      ok: external_exports.literal(true),
      config: ChisaCodeConfigRawSchema.nullable(),
      revision: ChisaCodeConfigRevisionSchema.nullable()
    }),
    external_exports.object({
      requestId: external_exports.string(),
      repoRoot: external_exports.string(),
      ok: external_exports.literal(false),
      error: ProjectConfigRpcErrorSchema
    })
  ])
});
var WriteProjectConfigResponseMessageSchema = external_exports.object({
  type: external_exports.literal("write_project_config_response"),
  payload: external_exports.discriminatedUnion("ok", [
    external_exports.object({
      requestId: external_exports.string(),
      repoRoot: external_exports.string(),
      ok: external_exports.literal(true),
      config: ChisaCodeConfigRawSchema,
      revision: ChisaCodeConfigRevisionSchema
    }),
    external_exports.object({
      requestId: external_exports.string(),
      repoRoot: external_exports.string(),
      ok: external_exports.literal(false),
      error: ProjectConfigRpcErrorSchema
    })
  ])
});
var DaemonInboundMessageSchemas = [
  DaemonGetStatusRequestSchema,
  DaemonGetPairingOfferRequestSchema,
  GetDaemonConfigRequestMessageSchema,
  SetDaemonConfigRequestMessageSchema,
  ReadProjectConfigRequestMessageSchema,
  WriteProjectConfigRequestMessageSchema,
  RestartServerRequestMessageSchema,
  ShutdownServerRequestMessageSchema
];
var DaemonOutboundMessageSchemas = [
  DaemonGetStatusResponseSchema,
  DaemonGetPairingOfferResponseSchema,
  GetDaemonConfigResponseMessageSchema,
  SetDaemonConfigResponseMessageSchema,
  ReadProjectConfigResponseMessageSchema,
  WriteProjectConfigResponseMessageSchema
];
var DaemonStatusPayloadSchemas = [
  ShutdownRequestedStatusPayloadSchema,
  RestartRequestedStatusPayloadSchema,
  DaemonConfigChangedStatusPayloadSchema
];

// vendor/chisacode-remote/packages/protocol/dist/usage/messages.js
var UsageRangeDaysSchema = external_exports.union([external_exports.literal(7), external_exports.literal(30), external_exports.literal(180)]);
var UsageExportFormatSchema = external_exports.enum(["json", "csv"]);
var UsageSummaryGetRequestMessageSchema = external_exports.object({
  type: external_exports.literal("usage.summary.get.request"),
  requestId: external_exports.string(),
  rangeDays: UsageRangeDaysSchema.default(30)
});
var UsageExportRequestMessageSchema = external_exports.object({
  type: external_exports.literal("usage.export.request"),
  requestId: external_exports.string(),
  format: UsageExportFormatSchema.default("json")
});
var UsageClearRequestMessageSchema = external_exports.object({
  type: external_exports.literal("usage.clear.request"),
  requestId: external_exports.string()
});
var UsageModelSummaryPayloadSchema = external_exports.object({
  model: external_exports.string(),
  totalTokens: external_exports.number().nonnegative(),
  turnCount: external_exports.number().int().nonnegative(),
  percentage: external_exports.number().int().nonnegative()
});
var UsageDailySummaryPayloadSchema = external_exports.object({
  date: external_exports.string(),
  inputTokens: external_exports.number().nonnegative(),
  cachedInputTokens: external_exports.number().nonnegative(),
  outputTokens: external_exports.number().nonnegative(),
  totalTokens: external_exports.number().nonnegative(),
  turnCount: external_exports.number().int().nonnegative(),
  messageCount: external_exports.number().int().nonnegative(),
  topModel: external_exports.string().nullable(),
  models: external_exports.array(UsageModelSummaryPayloadSchema)
});
var UsageSummaryPayloadSchema = external_exports.object({
  rangeDays: UsageRangeDaysSchema,
  generatedAt: external_exports.string(),
  totals: external_exports.object({
    inputTokens: external_exports.number().nonnegative(),
    cachedInputTokens: external_exports.number().nonnegative(),
    outputTokens: external_exports.number().nonnegative(),
    totalTokens: external_exports.number().nonnegative(),
    turnCount: external_exports.number().int().nonnegative(),
    messageCount: external_exports.number().int().nonnegative(),
    activeDays: external_exports.number().int().nonnegative(),
    currentStreakDays: external_exports.number().int().nonnegative()
  }),
  mostUsedModel: UsageModelSummaryPayloadSchema.nullable(),
  daily: external_exports.array(UsageDailySummaryPayloadSchema),
  models: external_exports.array(UsageModelSummaryPayloadSchema)
});
var UsageSummaryGetResponseMessageSchema = external_exports.object({
  type: external_exports.literal("usage.summary.get.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    summary: UsageSummaryPayloadSchema
  })
});
var UsageExportResponseMessageSchema = external_exports.object({
  type: external_exports.literal("usage.export.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    format: UsageExportFormatSchema,
    filename: external_exports.string(),
    content: external_exports.string()
  })
});
var UsageClearResponseMessageSchema = external_exports.object({
  type: external_exports.literal("usage.clear.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    cleared: external_exports.boolean()
  })
});
var UsageInboundMessageSchemas = [
  UsageSummaryGetRequestMessageSchema,
  UsageExportRequestMessageSchema,
  UsageClearRequestMessageSchema
];
var UsageOutboundMessageSchemas = [
  UsageSummaryGetResponseMessageSchema,
  UsageExportResponseMessageSchema,
  UsageClearResponseMessageSchema
];

// vendor/chisacode-remote/packages/protocol/dist/goal/rpc-schemas.js
var GoalStatusSchema = external_exports.enum([
  "active",
  "paused",
  "blocked",
  "complete",
  "budgetLimited",
  // Terminal failure/cancellation states. A goal whose agent crashed or was
  // cancelled by the user now has a dedicated literal instead of being
  // mislabeled as "blocked" or "paused". Additive over the prior enum, so old
  // clients that switch on status simply get an unknown branch they must
  // default-handle (no parse failure — zod enum widen is forward-compatible).
  "failed",
  "cancelled"
]);
var GoalLimitsSchema = external_exports.object({
  maxTurns: external_exports.number().int().positive().nullable(),
  budgetTokens: external_exports.number().int().positive().nullable(),
  noProgressLimit: external_exports.number().int().positive().nullable()
});
var GoalRecordSchema = external_exports.object({
  agentId: external_exports.string(),
  objective: external_exports.string(),
  status: GoalStatusSchema,
  limits: GoalLimitsSchema,
  turnsUsed: external_exports.number().int().nonnegative(),
  tokensUsed: external_exports.number().int().nonnegative(),
  noProgressStreak: external_exports.number().int().nonnegative(),
  lastReason: external_exports.string().nullable(),
  startedAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var GoalListItemSchema = external_exports.object({
  agentId: external_exports.string(),
  objective: external_exports.string(),
  status: GoalStatusSchema,
  turnsUsed: external_exports.number().int().nonnegative(),
  tokensUsed: external_exports.number().int().nonnegative()
});
var GoalSetRequestSchema = external_exports.object({
  type: external_exports.literal("goal/set"),
  requestId: external_exports.string(),
  agentId: external_exports.string().trim().min(1),
  objective: external_exports.string().trim().min(1),
  limits: GoalLimitsSchema.partial().optional()
});
var GoalCancelRequestSchema = external_exports.object({
  type: external_exports.literal("goal/cancel"),
  requestId: external_exports.string(),
  agentId: external_exports.string().trim().min(1)
});
var GoalInspectRequestSchema = external_exports.object({
  type: external_exports.literal("goal/inspect"),
  requestId: external_exports.string(),
  agentId: external_exports.string().trim().min(1)
});
var GoalListRequestSchema = external_exports.object({
  type: external_exports.literal("goal/list"),
  requestId: external_exports.string()
});
var GoalSetResponseSchema = external_exports.object({
  type: external_exports.literal("goal/set/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    goal: GoalRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var GoalCancelResponseSchema = external_exports.object({
  type: external_exports.literal("goal/cancel/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    goal: GoalRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var GoalInspectResponseSchema = external_exports.object({
  type: external_exports.literal("goal/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    goal: GoalRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var GoalListResponseSchema = external_exports.object({
  type: external_exports.literal("goal/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    goals: external_exports.array(GoalListItemSchema),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/team/rpc-schemas.js
var WorkerStatusSchema = external_exports.enum(["idle", "running", "done", "error", "archived"]);
var TeamStatusSchema = external_exports.enum(["active", "completed", "cancelled"]);
var WorkerRecordSchema = external_exports.object({
  id: external_exports.string(),
  teamId: external_exports.string(),
  sessionId: external_exports.string(),
  role: external_exports.string(),
  label: external_exports.string(),
  status: WorkerStatusSchema,
  focused: external_exports.boolean(),
  idleSince: external_exports.string().nullable(),
  createdAt: external_exports.string()
});
var TeamRecordSchema = external_exports.object({
  id: external_exports.string(),
  leadSessionId: external_exports.string(),
  status: TeamStatusSchema,
  createdAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var QueuedMessageSchema = external_exports.object({
  id: external_exports.string(),
  workerId: external_exports.string(),
  content: external_exports.string(),
  source: external_exports.literal("lead"),
  queuedAt: external_exports.string(),
  consumed: external_exports.boolean()
});
var TeamStartRequestSchema = external_exports.object({
  type: external_exports.literal("team/start"),
  requestId: external_exports.string()
});
var TeamEndRequestSchema = external_exports.object({
  type: external_exports.literal("team/end"),
  requestId: external_exports.string(),
  status: external_exports.enum(["completed", "cancelled"]).optional()
});
var TeamCreateWorkerRequestSchema = external_exports.object({
  type: external_exports.literal("team/create-worker"),
  requestId: external_exports.string(),
  label: external_exports.string().trim().min(1).max(32).regex(/^[a-z0-9_-]+$/),
  role: external_exports.string().trim().min(1).max(32).optional(),
  provider: AgentProviderSchema.optional(),
  model: external_exports.string().trim().min(1).optional(),
  initialTask: external_exports.string().trim().min(1).optional()
});
var TeamListWorkersRequestSchema = external_exports.object({
  type: external_exports.literal("team/list-workers"),
  requestId: external_exports.string()
});
var TeamSendToWorkerRequestSchema = external_exports.object({
  type: external_exports.literal("team/send-to-worker"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1),
  message: external_exports.string().trim().min(1)
});
var TeamListQueueRequestSchema = external_exports.object({
  type: external_exports.literal("team/list-queue"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1)
});
var TeamCancelMessageRequestSchema = external_exports.object({
  type: external_exports.literal("team/cancel-message"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1),
  messageId: external_exports.string().trim().min(1)
});
var TeamArchiveWorkerRequestSchema = external_exports.object({
  type: external_exports.literal("team/archive-worker"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1)
});
var TeamSwitchFocusRequestSchema = external_exports.object({
  type: external_exports.literal("team/switch-focus"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1)
});
var TeamWorkerStatusRequestSchema = external_exports.object({
  type: external_exports.literal("team/worker-status"),
  requestId: external_exports.string(),
  workerId: external_exports.string().trim().min(1)
});
var TeamStartResponseSchema = external_exports.object({
  type: external_exports.literal("team/start/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    team: TeamRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var TeamEndResponseSchema = external_exports.object({
  type: external_exports.literal("team/end/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    team: TeamRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var TeamCreateWorkerResponseSchema = external_exports.object({
  type: external_exports.literal("team/create-worker/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    worker: WorkerRecordSchema.nullable(),
    softLimitExceeded: external_exports.boolean(),
    queuedMessageId: external_exports.string().nullable(),
    error: external_exports.string().nullable()
  })
});
var TeamListWorkersResponseSchema = external_exports.object({
  type: external_exports.literal("team/list-workers/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    team: TeamRecordSchema.nullable(),
    workers: external_exports.array(WorkerRecordSchema),
    error: external_exports.string().nullable()
  })
});
var TeamSendToWorkerResponseSchema = external_exports.object({
  type: external_exports.literal("team/send-to-worker/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    queuedMessageId: external_exports.string().nullable(),
    error: external_exports.string().nullable()
  })
});
var TeamListQueueResponseSchema = external_exports.object({
  type: external_exports.literal("team/list-queue/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    messages: external_exports.array(QueuedMessageSchema),
    error: external_exports.string().nullable()
  })
});
var TeamCancelMessageResponseSchema = external_exports.object({
  type: external_exports.literal("team/cancel-message/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    error: external_exports.string().nullable()
  })
});
var TeamArchiveWorkerResponseSchema = external_exports.object({
  type: external_exports.literal("team/archive-worker/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    worker: WorkerRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var TeamSwitchFocusResponseSchema = external_exports.object({
  type: external_exports.literal("team/switch-focus/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    workers: external_exports.array(WorkerRecordSchema),
    error: external_exports.string().nullable()
  })
});
var TeamWorkerStatusResponseSchema = external_exports.object({
  type: external_exports.literal("team/worker-status/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    worker: WorkerRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/project-context/rpc-schemas.js
var DiscoveredModuleSchema = external_exports.object({
  dir: external_exports.string(),
  name: external_exports.string(),
  description: external_exports.string().optional()
});
var ProjectContextRecordSchema = external_exports.object({
  workDir: external_exports.string(),
  projectName: external_exports.string(),
  modules: external_exports.array(DiscoveredModuleSchema),
  toc: external_exports.string(),
  builtAt: external_exports.string()
});
var ContextBuildRequestSchema = external_exports.object({
  type: external_exports.literal("context/build"),
  requestId: external_exports.string(),
  workDir: external_exports.string().trim().min(1)
});
var ContextInspectRequestSchema = external_exports.object({
  type: external_exports.literal("context/inspect"),
  requestId: external_exports.string(),
  workDir: external_exports.string().trim().min(1)
});
var ContextInvalidateRequestSchema = external_exports.object({
  type: external_exports.literal("context/invalidate"),
  requestId: external_exports.string(),
  workDir: external_exports.string().trim().min(1)
});
var ContextBuildResponseSchema = external_exports.object({
  type: external_exports.literal("context/build/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    context: ProjectContextRecordSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ContextInspectResponseSchema = external_exports.object({
  type: external_exports.literal("context/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    context: ProjectContextRecordSchema.nullable(),
    cached: external_exports.boolean(),
    error: external_exports.string().nullable()
  })
});
var ContextInvalidateResponseSchema = external_exports.object({
  type: external_exports.literal("context/invalidate/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/snapshot/rpc-schemas.js
var SnapshotKindSchema = external_exports.enum([
  "before-edit",
  "after-edit",
  "manual",
  "pre-rollback",
  "rewind-blocked"
]);
var SnapshotEntrySchema = external_exports.object({
  commitHash: external_exports.string(),
  kind: SnapshotKindSchema,
  sessionId: external_exports.string().nullable(),
  agentId: external_exports.string().nullable(),
  label: external_exports.string().nullable(),
  createdAt: external_exports.string()
});
var SnapshotBlockedSchema = external_exports.object({
  reason: external_exports.enum(["merge", "rebase", "cherry-pick", "revert", "conflict"])
});
var SnapshotCreateRequestSchema = external_exports.object({
  type: external_exports.literal("snapshot/create"),
  requestId: external_exports.string(),
  cwd: external_exports.string().trim().min(1),
  label: external_exports.string().trim().min(1).optional(),
  agentId: external_exports.string().trim().min(1).optional()
});
var SnapshotListRequestSchema = external_exports.object({
  type: external_exports.literal("snapshot/list"),
  requestId: external_exports.string(),
  cwd: external_exports.string().trim().min(1),
  limit: external_exports.number().int().positive().max(100).optional()
});
var SnapshotRewindRequestSchema = external_exports.object({
  type: external_exports.literal("snapshot/rewind"),
  requestId: external_exports.string(),
  cwd: external_exports.string().trim().min(1),
  // Hex-only to prevent git argument injection (e.g. --output=<path> writes the
  // log to an arbitrary file). Accept 40 (sha1) or 64 (sha256) hex chars.
  commitHash: external_exports.string().trim().regex(/^[0-9a-f]{40,64}$/i, "commitHash must be a 40- or 64-char hex SHA")
});
var SnapshotStatusRequestSchema = external_exports.object({
  type: external_exports.literal("snapshot/status"),
  requestId: external_exports.string(),
  cwd: external_exports.string().trim().min(1)
});
var SnapshotCreateResponseSchema = external_exports.object({
  type: external_exports.literal("snapshot/create/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    commitHash: external_exports.string().nullable(),
    excludedFiles: external_exports.array(external_exports.string()),
    error: external_exports.string().nullable()
  })
});
var SnapshotListResponseSchema = external_exports.object({
  type: external_exports.literal("snapshot/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    snapshots: external_exports.array(SnapshotEntrySchema),
    error: external_exports.string().nullable()
  })
});
var SnapshotRewindResponseSchema = external_exports.object({
  type: external_exports.literal("snapshot/rewind/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    restoredFiles: external_exports.array(external_exports.string()),
    error: external_exports.string().nullable()
  })
});
var SnapshotStatusResponseSchema = external_exports.object({
  type: external_exports.literal("snapshot/status/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    blocked: SnapshotBlockedSchema.nullable(),
    latestSnapshot: SnapshotEntrySchema.nullable(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/migration/rpc-schemas.js
var MigrationItemSchema = external_exports.object({
  kind: external_exports.enum(["agents-md"]),
  direction: external_exports.enum(["to-claude", "to-codex"]),
  label: external_exports.string(),
  source: external_exports.string(),
  target: external_exports.string()
});
var MigrationOutcomeSchema = external_exports.object({
  status: external_exports.enum(["success", "skipped", "failed"]),
  detail: external_exports.string().optional()
});
var MigrationDetectRequestSchema = external_exports.object({
  type: external_exports.literal("migration/detect"),
  requestId: external_exports.string(),
  workDir: external_exports.string().trim().min(1),
  targetAgent: external_exports.enum(["claude-code", "codex"])
});
var MigrationApplyRequestSchema = external_exports.object({
  type: external_exports.literal("migration/apply"),
  requestId: external_exports.string(),
  workDir: external_exports.string().trim().min(1),
  targetAgent: external_exports.enum(["claude-code", "codex"])
});
var MigrationDetectResponseSchema = external_exports.object({
  type: external_exports.literal("migration/detect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    items: external_exports.array(MigrationItemSchema),
    error: external_exports.string().nullable()
  })
});
var MigrationApplyResponseSchema = external_exports.object({
  type: external_exports.literal("migration/apply/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    outcomes: external_exports.array(MigrationOutcomeSchema),
    error: external_exports.string().nullable()
  })
});
var MigrationAvailableNotificationSchema = external_exports.object({
  type: external_exports.literal("migration/available"),
  payload: external_exports.object({
    items: external_exports.array(MigrationItemSchema),
    workDir: external_exports.string(),
    targetAgent: external_exports.enum(["claude-code", "codex"])
  })
});

// vendor/chisacode-remote/packages/protocol/dist/learn/rpc-schemas.js
var LearnRunStatusSchema = external_exports.enum([
  "collecting",
  "distilling",
  "staging",
  "awaiting-review",
  "applied",
  "discarded",
  "failed",
  "cancelled"
]);
var LearnProposalSchema = external_exports.object({
  // Bound the length so a hallucinating distill agent cannot emit a huge path
  // string; path-traversal (`..`) is rejected by deriveSkillName at staging time.
  filename: external_exports.string().max(256),
  content: external_exports.string(),
  fingerprint: external_exports.string()
});
var LearnRunSchema = external_exports.object({
  id: external_exports.string(),
  status: LearnRunStatusSchema,
  evidence: external_exports.object({
    diff: external_exports.string(),
    files: external_exports.array(external_exports.string()),
    context: external_exports.string().optional()
  }).nullable(),
  proposals: external_exports.array(LearnProposalSchema),
  error: external_exports.string().nullable(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  expiresAt: external_exports.string().nullable()
});
var LearnListItemSchema = external_exports.object({
  id: external_exports.string(),
  status: LearnRunStatusSchema,
  proposalCount: external_exports.number().int().nonnegative(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var LearnStartRequestSchema = external_exports.object({
  type: external_exports.literal("learn/start"),
  requestId: external_exports.string(),
  diff: external_exports.string().trim().min(1),
  files: external_exports.array(external_exports.string().trim().min(1)).min(1),
  context: external_exports.string().optional()
});
var LearnListRequestSchema = external_exports.object({
  type: external_exports.literal("learn/list"),
  requestId: external_exports.string()
});
var LearnInspectRequestSchema = external_exports.object({
  type: external_exports.literal("learn/inspect"),
  requestId: external_exports.string(),
  runId: external_exports.string().trim().min(1)
});
var LearnApplyRequestSchema = external_exports.object({
  type: external_exports.literal("learn/apply"),
  requestId: external_exports.string(),
  runId: external_exports.string().trim().min(1),
  /** Specific proposal fingerprints to apply. If omitted, applies all. */
  fingerprints: external_exports.array(external_exports.string()).optional()
});
var LearnDiscardRequestSchema = external_exports.object({
  type: external_exports.literal("learn/discard"),
  requestId: external_exports.string(),
  runId: external_exports.string().trim().min(1)
});
var LearnCancelRequestSchema = external_exports.object({
  type: external_exports.literal("learn/cancel"),
  requestId: external_exports.string(),
  runId: external_exports.string().trim().min(1)
});
var LearnStartResponseSchema = external_exports.object({
  type: external_exports.literal("learn/start/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    run: LearnRunSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var LearnListResponseSchema = external_exports.object({
  type: external_exports.literal("learn/list/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    runs: external_exports.array(LearnListItemSchema),
    error: external_exports.string().nullable()
  })
});
var LearnInspectResponseSchema = external_exports.object({
  type: external_exports.literal("learn/inspect/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    run: LearnRunSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var LearnApplyResponseSchema = external_exports.object({
  type: external_exports.literal("learn/apply/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    run: LearnRunSchema.nullable(),
    appliedFiles: external_exports.array(external_exports.string()),
    error: external_exports.string().nullable()
  })
});
var LearnDiscardResponseSchema = external_exports.object({
  type: external_exports.literal("learn/discard/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    run: LearnRunSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var LearnCancelResponseSchema = external_exports.object({
  type: external_exports.literal("learn/cancel/response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    run: LearnRunSchema.nullable(),
    error: external_exports.string().nullable()
  })
});

// vendor/chisacode-remote/packages/protocol/dist/cindy/messages.js
var CindyInboundMessageSchemas = [
  // Goal
  GoalSetRequestSchema,
  GoalCancelRequestSchema,
  GoalInspectRequestSchema,
  GoalListRequestSchema,
  // Team
  TeamStartRequestSchema,
  TeamEndRequestSchema,
  TeamCreateWorkerRequestSchema,
  TeamListWorkersRequestSchema,
  TeamSendToWorkerRequestSchema,
  TeamListQueueRequestSchema,
  TeamCancelMessageRequestSchema,
  TeamArchiveWorkerRequestSchema,
  TeamSwitchFocusRequestSchema,
  TeamWorkerStatusRequestSchema,
  // Project Context
  ContextBuildRequestSchema,
  ContextInspectRequestSchema,
  ContextInvalidateRequestSchema,
  // Snapshot
  SnapshotCreateRequestSchema,
  SnapshotListRequestSchema,
  SnapshotRewindRequestSchema,
  SnapshotStatusRequestSchema,
  // Migration
  MigrationDetectRequestSchema,
  MigrationApplyRequestSchema,
  // Learn
  LearnStartRequestSchema,
  LearnListRequestSchema,
  LearnInspectRequestSchema,
  LearnApplyRequestSchema,
  LearnDiscardRequestSchema,
  LearnCancelRequestSchema
];
var CindyOutboundMessageSchemas = [
  // Goal
  GoalSetResponseSchema,
  GoalCancelResponseSchema,
  GoalInspectResponseSchema,
  GoalListResponseSchema,
  // Team
  TeamStartResponseSchema,
  TeamEndResponseSchema,
  TeamCreateWorkerResponseSchema,
  TeamListWorkersResponseSchema,
  TeamSendToWorkerResponseSchema,
  TeamListQueueResponseSchema,
  TeamCancelMessageResponseSchema,
  TeamArchiveWorkerResponseSchema,
  TeamSwitchFocusResponseSchema,
  TeamWorkerStatusResponseSchema,
  // Project Context
  ContextBuildResponseSchema,
  ContextInspectResponseSchema,
  ContextInvalidateResponseSchema,
  // Snapshot
  SnapshotCreateResponseSchema,
  SnapshotListResponseSchema,
  SnapshotRewindResponseSchema,
  SnapshotStatusResponseSchema,
  // Migration
  MigrationDetectResponseSchema,
  MigrationApplyResponseSchema,
  MigrationAvailableNotificationSchema,
  // Learn
  LearnStartResponseSchema,
  LearnListResponseSchema,
  LearnInspectResponseSchema,
  LearnApplyResponseSchema,
  LearnDiscardResponseSchema,
  LearnCancelResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/voice/messages.js
var VoiceAudioChunkMessageSchema = external_exports.object({
  type: external_exports.literal("voice_audio_chunk"),
  audio: external_exports.string(),
  // base64 encoded
  format: external_exports.string(),
  isLast: external_exports.boolean()
});
var AudioPlayedMessageSchema = external_exports.object({
  type: external_exports.literal("audio_played"),
  id: external_exports.string()
});
var SetVoiceModeMessageSchema = external_exports.object({
  type: external_exports.literal("set_voice_mode"),
  enabled: external_exports.boolean(),
  agentId: external_exports.string().optional(),
  requestId: external_exports.string().optional()
});
var DictationStreamStartMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_start"),
  dictationId: external_exports.string(),
  format: external_exports.string()
  // e.g. "audio/pcm;rate=16000;bits=16"
});
var DictationStreamChunkMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_chunk"),
  dictationId: external_exports.string(),
  seq: external_exports.number().int().nonnegative(),
  audio: external_exports.string(),
  // base64 encoded chunk
  format: external_exports.string()
  // e.g. "audio/pcm;rate=16000;bits=16"
});
var DictationStreamFinishMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_finish"),
  dictationId: external_exports.string(),
  finalSeq: external_exports.number().int().nonnegative()
});
var DictationStreamCancelMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_cancel"),
  dictationId: external_exports.string()
});
var SetVoiceModeResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_voice_mode_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    enabled: external_exports.boolean(),
    agentId: external_exports.string().nullable(),
    accepted: external_exports.boolean(),
    error: external_exports.string().nullable(),
    reasonCode: external_exports.string().optional(),
    retryable: external_exports.boolean().optional(),
    missingModelIds: external_exports.array(external_exports.string()).optional()
  })
});
var AudioOutputMessageSchema = external_exports.object({
  type: external_exports.literal("audio_output"),
  payload: external_exports.object({
    audio: external_exports.string(),
    // base64 encoded
    format: external_exports.string(),
    id: external_exports.string(),
    isVoiceMode: external_exports.boolean(),
    // Mode when audio was generated (for drift protection)
    groupId: external_exports.string().optional(),
    // Logical utterance id
    chunkIndex: external_exports.number().int().nonnegative().optional(),
    isLastChunk: external_exports.boolean().optional()
  })
});
var TranscriptionResultMessageSchema = external_exports.object({
  type: external_exports.literal("transcription_result"),
  payload: external_exports.object({
    text: external_exports.string(),
    language: external_exports.string().optional(),
    duration: external_exports.number().optional(),
    requestId: external_exports.string(),
    // Echoed back from request for tracking
    avgLogprob: external_exports.number().optional(),
    isLowConfidence: external_exports.boolean().optional(),
    byteLength: external_exports.number().optional(),
    format: external_exports.string().optional(),
    debugRecordingPath: external_exports.string().optional()
  })
});
var VoiceInputStateMessageSchema = external_exports.object({
  type: external_exports.literal("voice_input_state"),
  payload: external_exports.object({
    isSpeaking: external_exports.boolean()
  })
});
var DictationStreamAckMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_ack"),
  payload: external_exports.object({
    dictationId: external_exports.string(),
    ackSeq: external_exports.number().int()
  })
});
var DictationStreamFinishAcceptedMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_finish_accepted"),
  payload: external_exports.object({
    dictationId: external_exports.string(),
    timeoutMs: external_exports.number().int().positive()
  })
});
var DictationStreamPartialMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_partial"),
  payload: external_exports.object({
    dictationId: external_exports.string(),
    text: external_exports.string()
  })
});
var DictationStreamFinalMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_final"),
  payload: external_exports.object({
    dictationId: external_exports.string(),
    text: external_exports.string(),
    debugRecordingPath: external_exports.string().optional()
  })
});
var DictationStreamErrorMessageSchema = external_exports.object({
  type: external_exports.literal("dictation_stream_error"),
  payload: external_exports.object({
    dictationId: external_exports.string(),
    error: external_exports.string(),
    retryable: external_exports.boolean(),
    reasonCode: external_exports.string().optional(),
    missingModelIds: external_exports.array(external_exports.string()).optional(),
    debugRecordingPath: external_exports.string().optional()
  })
});
var ServerCapabilityStateSchema = external_exports.object({
  enabled: external_exports.boolean(),
  reason: external_exports.string()
});
var ServerVoiceCapabilitiesSchema = external_exports.object({
  dictation: ServerCapabilityStateSchema,
  voice: ServerCapabilityStateSchema
});
var VoiceInboundMessageSchemas = [
  VoiceAudioChunkMessageSchema,
  AudioPlayedMessageSchema,
  SetVoiceModeMessageSchema,
  DictationStreamStartMessageSchema,
  DictationStreamChunkMessageSchema,
  DictationStreamFinishMessageSchema,
  DictationStreamCancelMessageSchema
];
var VoiceOutboundMessageSchemas = [
  AudioOutputMessageSchema,
  TranscriptionResultMessageSchema,
  VoiceInputStateMessageSchema,
  DictationStreamAckMessageSchema,
  DictationStreamFinishAcceptedMessageSchema,
  DictationStreamPartialMessageSchema,
  DictationStreamFinalMessageSchema,
  DictationStreamErrorMessageSchema,
  SetVoiceModeResponseMessageSchema
];

// vendor/chisacode-remote/packages/protocol/dist/agent-labels.js
var AGENT_RELATION_KINDS = ["subagent", "detached", "handoff", "team-slot"];
var AGENT_RELATION_SOURCES = ["mcp", "user", "system"];

// vendor/chisacode-remote/packages/protocol/dist/agent-presets.js
var AgentPresetSchema = external_exports.object({
  id: external_exports.string().min(1),
  label: external_exports.string().min(1),
  description: external_exports.string().default(""),
  provider: external_exports.string().min(1),
  modeId: external_exports.string().min(1).optional(),
  model: external_exports.string().min(1).optional(),
  systemPrompt: external_exports.string().optional(),
  skillIds: external_exports.array(external_exports.string().min(1)).optional(),
  mcpServerIds: external_exports.array(external_exports.string().min(1)).optional(),
  samplePrompts: external_exports.array(external_exports.string().min(1)).optional()
});
var AgentPresetsPayloadSchema = external_exports.object({
  presets: external_exports.array(AgentPresetSchema)
});

// vendor/chisacode-remote/packages/protocol/dist/agent-title-limits.js
var MAX_EXPLICIT_AGENT_TITLE_CHARS = 200;

// vendor/chisacode-remote/packages/protocol/dist/agent-lifecycle.js
var AGENT_LIFECYCLE_STATUSES = [
  "initializing",
  "idle",
  "running",
  "error",
  "closed"
];

// vendor/chisacode-remote/packages/protocol/dist/agent/state.js
var AgentStatusSchema = external_exports.enum(AGENT_LIFECYCLE_STATUSES);
var AgentCapabilityFlagsSchema = external_exports.object({
  supportsStreaming: external_exports.boolean(),
  supportsSessionPersistence: external_exports.boolean(),
  supportsDynamicModes: external_exports.boolean(),
  supportsMcpServers: external_exports.boolean(),
  supportsReasoningStream: external_exports.boolean(),
  supportsToolInvocations: external_exports.boolean(),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindConversation: external_exports.boolean().optional().default(false),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindFiles: external_exports.boolean().optional().default(false),
  // COMPAT(rewind): added in v0.1.X, drop when floor >= v0.1.X.
  supportsRewindBoth: external_exports.boolean().optional().default(false)
});
var AgentUsageSchema = external_exports.object({
  inputTokens: external_exports.number().optional(),
  cachedInputTokens: external_exports.number().optional(),
  outputTokens: external_exports.number().optional(),
  totalCostUsd: external_exports.number().optional(),
  contextWindowMaxTokens: external_exports.number().optional(),
  contextWindowUsedTokens: external_exports.number().optional()
});
var AgentPermissionUpdateSchema = external_exports.record(external_exports.unknown());
var AgentPermissionActionSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string(),
  behavior: external_exports.enum(["allow", "deny"]),
  variant: external_exports.enum(["primary", "secondary", "danger"]).optional(),
  intent: external_exports.enum(["implement", "implement_resume", "dismiss"]).optional()
});
var AgentPermissionResponseSchema = external_exports.union([
  external_exports.object({
    behavior: external_exports.literal("allow"),
    selectedActionId: external_exports.string().optional(),
    updatedInput: external_exports.record(external_exports.unknown()).optional(),
    updatedPermissions: external_exports.array(AgentPermissionUpdateSchema).optional()
  }),
  external_exports.object({
    behavior: external_exports.literal("deny"),
    selectedActionId: external_exports.string().optional(),
    message: external_exports.string().optional(),
    interrupt: external_exports.boolean().optional()
  })
]);
var AgentPermissionRequestPayloadSchema = external_exports.object({
  id: external_exports.string(),
  provider: AgentProviderSchema,
  name: external_exports.string(),
  kind: external_exports.enum(["tool", "plan", "question", "mode", "other"]),
  title: external_exports.string().optional(),
  description: external_exports.string().optional(),
  input: external_exports.record(external_exports.unknown()).optional(),
  detail: external_exports.lazy(() => ToolCallDetailPayloadSchema).optional(),
  suggestions: external_exports.array(AgentPermissionUpdateSchema).optional(),
  actions: external_exports.array(AgentPermissionActionSchema).optional(),
  metadata: external_exports.record(external_exports.unknown()).optional()
});
var UnknownValueSchema = external_exports.union([
  external_exports.null(),
  external_exports.boolean(),
  external_exports.number(),
  external_exports.string(),
  external_exports.array(external_exports.unknown()),
  external_exports.object({}).passthrough()
]);
var NonNullUnknownSchema = external_exports.union([
  external_exports.boolean(),
  external_exports.number(),
  external_exports.string(),
  external_exports.array(external_exports.unknown()),
  external_exports.object({}).passthrough()
]);
var ToolCallDetailPayloadSchema = external_exports.discriminatedUnion("type", [
  WorktreeSetupDetailPayloadSchema,
  external_exports.object({
    type: external_exports.literal("shell"),
    command: external_exports.string(),
    cwd: external_exports.string().optional(),
    output: external_exports.string().optional(),
    exitCode: external_exports.number().nullable().optional()
  }),
  external_exports.object({
    type: external_exports.literal("read"),
    filePath: external_exports.string(),
    content: external_exports.string().optional(),
    offset: external_exports.number().optional(),
    limit: external_exports.number().optional()
  }),
  external_exports.object({
    type: external_exports.literal("edit"),
    filePath: external_exports.string(),
    oldString: external_exports.string().optional(),
    newString: external_exports.string().optional(),
    unifiedDiff: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("write"),
    filePath: external_exports.string(),
    content: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("search"),
    query: external_exports.string(),
    toolName: external_exports.enum(["search", "grep", "glob", "web_search"]).optional(),
    content: external_exports.string().optional(),
    filePaths: external_exports.array(external_exports.string()).optional(),
    webResults: external_exports.array(external_exports.object({
      title: external_exports.string(),
      url: external_exports.string()
    })).optional(),
    annotations: external_exports.array(external_exports.string()).optional(),
    numFiles: external_exports.number().optional(),
    numMatches: external_exports.number().optional(),
    durationMs: external_exports.number().optional(),
    durationSeconds: external_exports.number().optional(),
    truncated: external_exports.boolean().optional(),
    mode: external_exports.enum(["content", "files_with_matches", "count"]).optional()
  }),
  external_exports.object({
    type: external_exports.literal("fetch"),
    url: external_exports.string(),
    prompt: external_exports.string().optional(),
    result: external_exports.string().optional(),
    code: external_exports.number().optional(),
    codeText: external_exports.string().optional(),
    bytes: external_exports.number().optional(),
    durationMs: external_exports.number().optional()
  }),
  external_exports.object({
    type: external_exports.literal("sub_agent"),
    subAgentType: external_exports.string().optional(),
    description: external_exports.string().optional(),
    childSessionId: external_exports.string().optional(),
    log: external_exports.string(),
    // Compat cruft for clients <= 0.1.65-beta.3 that required this field. Producers still
    // emit `[]`; nothing reads it. Drop the field (and the `[]` emissions) once those
    // clients are no longer in the field.
    actions: external_exports.array(external_exports.object({
      index: external_exports.number().int().positive(),
      toolName: external_exports.string(),
      summary: external_exports.string().optional()
    })).optional()
  }),
  external_exports.object({
    type: external_exports.literal("plain_text"),
    label: external_exports.string().optional(),
    text: external_exports.string().optional(),
    icon: external_exports.enum(TOOL_CALL_ICON_NAMES).optional()
  }),
  external_exports.object({
    type: external_exports.literal("plan"),
    text: external_exports.string()
  }),
  external_exports.object({
    type: external_exports.literal("unknown"),
    input: UnknownValueSchema,
    output: UnknownValueSchema
  })
]);
var ToolCallBasePayloadSchema = external_exports.object({
  type: external_exports.literal("tool_call"),
  callId: external_exports.string(),
  name: external_exports.string(),
  detail: ToolCallDetailPayloadSchema,
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).strict();
var ToolCallRunningPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: external_exports.literal("running"),
  error: external_exports.null()
});
var ToolCallCompletedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: external_exports.literal("completed"),
  error: external_exports.null()
});
var ToolCallFailedPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: external_exports.literal("failed"),
  error: NonNullUnknownSchema
});
var ToolCallCanceledPayloadSchema = ToolCallBasePayloadSchema.extend({
  status: external_exports.literal("canceled"),
  error: external_exports.null()
});
var ToolCallTimelineItemPayloadSchema = external_exports.union([
  ToolCallRunningPayloadSchema,
  ToolCallCompletedPayloadSchema,
  ToolCallFailedPayloadSchema,
  ToolCallCanceledPayloadSchema
]);
var GenerativeUiTimelineItemPayloadSchema = external_exports.object({
  type: external_exports.literal("generative_ui"),
  instanceId: external_exports.string(),
  componentId: external_exports.string(),
  props: external_exports.record(external_exports.string(), external_exports.unknown()),
  title: external_exports.string().optional(),
  source: external_exports.enum(["tool_call", "fence"]),
  status: external_exports.enum(["rendering", "interactive", "error"])
});
var AgentTimelineItemPayloadSchema = external_exports.union([
  external_exports.object({
    type: external_exports.literal("user_message"),
    text: external_exports.string(),
    messageId: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("assistant_message"),
    text: external_exports.string(),
    messageId: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("reasoning"),
    text: external_exports.string()
  }),
  ToolCallTimelineItemPayloadSchema,
  GenerativeUiTimelineItemPayloadSchema,
  external_exports.object({
    type: external_exports.literal("todo"),
    items: external_exports.array(external_exports.object({
      text: external_exports.string(),
      completed: external_exports.boolean()
    }))
  }),
  external_exports.object({
    type: external_exports.literal("error"),
    message: external_exports.string()
  }),
  external_exports.object({
    type: external_exports.literal("compaction"),
    status: external_exports.enum(["loading", "completed", "failed"]),
    error: external_exports.string().optional(),
    trigger: external_exports.enum(["auto", "manual"]).optional(),
    preTokens: external_exports.number().optional()
  }),
  external_exports.object({
    type: external_exports.literal("turn_changes"),
    changeSummary: external_exports.string(),
    changedFiles: external_exports.array(external_exports.object({
      path: external_exports.string(),
      additions: external_exports.number().optional(),
      deletions: external_exports.number().optional()
    })),
    checkpointRef: external_exports.string().optional()
  })
]);
var AgentStreamEventPayloadSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({
    type: external_exports.literal("thread_started"),
    sessionId: external_exports.string(),
    provider: AgentProviderSchema
  }),
  external_exports.object({
    type: external_exports.literal("turn_started"),
    provider: AgentProviderSchema
  }),
  external_exports.object({
    type: external_exports.literal("turn_completed"),
    provider: AgentProviderSchema,
    usage: AgentUsageSchema.optional()
  }),
  external_exports.object({
    type: external_exports.literal("turn_failed"),
    provider: AgentProviderSchema,
    error: external_exports.string(),
    code: external_exports.string().optional(),
    diagnostic: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("turn_canceled"),
    provider: AgentProviderSchema,
    reason: external_exports.string()
  }),
  external_exports.object({
    type: external_exports.literal("timeline"),
    provider: AgentProviderSchema,
    item: AgentTimelineItemPayloadSchema
  }),
  external_exports.object({
    type: external_exports.literal("permission_requested"),
    provider: AgentProviderSchema,
    request: AgentPermissionRequestPayloadSchema
  }),
  external_exports.object({
    type: external_exports.literal("permission_resolved"),
    provider: AgentProviderSchema,
    requestId: external_exports.string(),
    resolution: AgentPermissionResponseSchema
  }),
  external_exports.object({
    type: external_exports.literal("attention_required"),
    provider: AgentProviderSchema,
    reason: external_exports.enum(["finished", "error", "permission"]),
    timestamp: external_exports.string(),
    shouldNotify: external_exports.boolean(),
    notification: external_exports.object({
      title: external_exports.string(),
      body: external_exports.string(),
      data: external_exports.object({
        serverId: external_exports.string(),
        agentId: external_exports.string(),
        reason: external_exports.enum(["finished", "error", "permission"])
      })
    }).optional()
  }),
  external_exports.object({
    type: external_exports.literal("generative_ui_update"),
    instanceId: external_exports.string(),
    props: external_exports.record(external_exports.string(), external_exports.unknown()),
    status: external_exports.enum(["rendering", "interactive", "error"]).optional(),
    timestamp: external_exports.string().optional()
  }),
  external_exports.object({
    type: external_exports.literal("generative_ui_remove"),
    instanceId: external_exports.string(),
    timestamp: external_exports.string().optional()
  })
]);
var AgentPersistenceHandleSchema = external_exports.object({
  provider: AgentProviderSchema,
  sessionId: external_exports.string(),
  nativeHandle: external_exports.string().optional(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
}).nullable();
var AgentRuntimeInfoSchema = external_exports.object({
  provider: AgentProviderSchema,
  sessionId: external_exports.string().nullable(),
  model: external_exports.string().nullable().optional(),
  thinkingOptionId: external_exports.string().nullable().optional(),
  modeId: external_exports.string().nullable().optional(),
  extra: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var AgentRelationSchema = external_exports.object({
  kind: external_exports.enum(AGENT_RELATION_KINDS),
  parentAgentId: external_exports.string().optional(),
  taskId: external_exports.string().optional(),
  source: external_exports.enum(AGENT_RELATION_SOURCES).optional()
});
var AgentSnapshotPayloadSchema = external_exports.object({
  id: external_exports.string(),
  provider: AgentProviderSchema,
  cwd: external_exports.string(),
  model: external_exports.string().nullable(),
  features: external_exports.array(AgentFeatureSchema).optional(),
  thinkingOptionId: external_exports.string().nullable().optional(),
  effectiveThinkingOptionId: external_exports.string().nullable().optional(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  lastUserMessageAt: external_exports.string().nullable(),
  status: AgentStatusSchema,
  capabilities: AgentCapabilityFlagsSchema,
  currentModeId: external_exports.string().nullable(),
  availableModes: external_exports.array(AgentModeSchema),
  pendingPermissions: external_exports.array(AgentPermissionRequestPayloadSchema),
  persistence: AgentPersistenceHandleSchema.nullable(),
  runtimeInfo: AgentRuntimeInfoSchema.optional(),
  lastUsage: AgentUsageSchema.optional(),
  lastError: external_exports.string().optional(),
  title: external_exports.string().nullable(),
  labels: external_exports.record(external_exports.string(), external_exports.string()).default({}),
  relation: AgentRelationSchema.optional(),
  requiresAttention: external_exports.boolean().optional(),
  attentionReason: external_exports.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: external_exports.string().nullable().optional(),
  archivedAt: external_exports.string().nullable().optional(),
  providerUnavailable: external_exports.boolean().optional()
});
var AgentListItemPayloadSchema = external_exports.object({
  id: external_exports.string(),
  shortId: external_exports.string(),
  title: external_exports.string().nullable(),
  provider: AgentProviderSchema,
  model: external_exports.string().nullable(),
  thinkingOptionId: external_exports.string().nullable().optional(),
  effectiveThinkingOptionId: external_exports.string().nullable().optional(),
  status: AgentStatusSchema,
  cwd: external_exports.string(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string(),
  lastUserMessageAt: external_exports.string().nullable(),
  archivedAt: external_exports.string().nullable().optional(),
  requiresAttention: external_exports.boolean().optional(),
  attentionReason: external_exports.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: external_exports.string().nullable().optional(),
  labels: external_exports.record(external_exports.string(), external_exports.string()).default({}),
  providerUnavailable: external_exports.boolean().optional()
});

// vendor/chisacode-remote/packages/protocol/dist/agent/messages.js
var AgentSessionConfigSchema = external_exports.object({
  provider: AgentProviderSchema,
  runtimeProvider: AgentProviderSchema.optional(),
  cwd: external_exports.string(),
  modeId: external_exports.string().optional(),
  model: external_exports.string().optional(),
  thinkingOptionId: external_exports.string().optional(),
  featureValues: external_exports.record(external_exports.unknown()).optional(),
  title: external_exports.string().trim().min(1).max(MAX_EXPLICIT_AGENT_TITLE_CHARS).optional().nullable(),
  approvalPolicy: external_exports.string().optional(),
  sandboxMode: external_exports.string().optional(),
  networkAccess: external_exports.boolean().optional(),
  webSearch: external_exports.boolean().optional(),
  extra: external_exports.object({
    codex: external_exports.record(external_exports.unknown()).optional(),
    claude: external_exports.record(external_exports.unknown()).optional()
  }).partial().optional(),
  systemPrompt: external_exports.string().optional(),
  mcpServers: external_exports.record(McpServerConfigSchema).optional()
});
var AgentDirectoryFilterSchema = external_exports.object({
  labels: external_exports.record(external_exports.string()).optional(),
  projectKeys: external_exports.array(external_exports.string()).optional(),
  statuses: external_exports.array(AgentStatusSchema).optional(),
  includeArchived: external_exports.boolean().optional(),
  requiresAttention: external_exports.boolean().optional(),
  thinkingOptionId: external_exports.string().nullable().optional()
});
var DeleteAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("delete_agent_request"),
  agentId: external_exports.string(),
  requestId: external_exports.string()
});
var ArchiveAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("archive_agent_request"),
  agentId: external_exports.string(),
  requestId: external_exports.string()
});
var UpdateAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("update_agent_request"),
  agentId: external_exports.string(),
  name: external_exports.string().optional(),
  labels: external_exports.record(external_exports.string()).optional(),
  /** Force-regenerate title from the first user message. Optional for wire compat. */
  regenerateTitle: external_exports.boolean().optional(),
  requestId: external_exports.string()
});
var ImageAttachmentSchema = external_exports.object({
  data: external_exports.string(),
  // base64 encoded image
  mimeType: external_exports.string()
  // e.g., "image/jpeg", "image/png"
});
var SendAgentMessageSchema = external_exports.object({
  type: external_exports.literal("send_agent_message"),
  agentId: external_exports.string(),
  text: external_exports.string(),
  messageId: external_exports.string().max(256).optional(),
  // Client-provided ID for deduplication
  images: external_exports.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema
});
var FetchAgentsRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agents_request"),
  requestId: external_exports.string(),
  scope: external_exports.enum(["active"]).optional(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: external_exports.array(external_exports.object({
    key: external_exports.enum(["status_priority", "created_at", "updated_at", "title"]),
    direction: external_exports.enum(["asc", "desc"])
  })).optional(),
  page: external_exports.object({
    limit: external_exports.number().int().positive().max(200),
    cursor: external_exports.string().min(1).optional()
  }).optional(),
  subscribe: external_exports.object({
    subscriptionId: external_exports.string().optional()
  }).optional()
});
var FetchAgentHistoryRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_history_request"),
  requestId: external_exports.string(),
  filter: AgentDirectoryFilterSchema.optional(),
  sort: external_exports.array(external_exports.object({
    key: external_exports.enum(["status_priority", "created_at", "updated_at", "title"]),
    direction: external_exports.enum(["asc", "desc"])
  })).optional(),
  page: external_exports.object({
    limit: external_exports.number().int().positive().max(200),
    cursor: external_exports.string().min(1).optional()
  }).optional()
});
var FetchAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_request"),
  requestId: external_exports.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: external_exports.string()
});
var SendAgentMessageRequestSchema = external_exports.object({
  type: external_exports.literal("send_agent_message_request"),
  requestId: external_exports.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: external_exports.string(),
  text: external_exports.string(),
  messageId: external_exports.string().max(256).optional(),
  // Client-provided ID for deduplication
  images: external_exports.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema
});
var WaitForFinishRequestSchema = external_exports.object({
  type: external_exports.literal("wait_for_finish_request"),
  requestId: external_exports.string(),
  /** Accepts full ID, unique prefix, or exact full title (server resolves). */
  agentId: external_exports.string(),
  timeoutMs: external_exports.number().int().positive().optional()
});
var GitSetupOptionsSchema = external_exports.object({
  baseBranch: external_exports.string().optional(),
  createNewBranch: external_exports.boolean().optional(),
  newBranchName: external_exports.string().optional(),
  createWorktree: external_exports.boolean().optional(),
  worktreeSlug: external_exports.string().optional(),
  refName: external_exports.string().min(1).optional(),
  action: external_exports.enum(["branch-off", "checkout"]).optional(),
  githubPrNumber: external_exports.number().int().positive().optional()
});
var CreateAgentWorktreeTargetSchema = external_exports.discriminatedUnion("mode", [
  external_exports.object({
    mode: external_exports.literal("branch-off"),
    newBranch: external_exports.string().min(1),
    base: external_exports.string().min(1).optional()
  }),
  external_exports.object({
    mode: external_exports.literal("checkout-branch"),
    branch: external_exports.string().min(1)
  }),
  external_exports.object({
    mode: external_exports.literal("checkout-pr"),
    prNumber: external_exports.number().int().positive()
  })
]);
var CreateAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("create_agent_request"),
  config: AgentSessionConfigSchema,
  env: external_exports.record(external_exports.string()).optional(),
  workspaceId: external_exports.string().optional(),
  worktreeName: external_exports.string().optional(),
  initialPrompt: external_exports.string().optional(),
  clientMessageId: external_exports.string().optional(),
  /**
   * Client-minted agent id. The daemon adopts it verbatim so the optimistic
   * sidebar row (keyed by the same id) and the authoritative agent share one
   * key. Optional for wire compatibility: older clients omit it and the daemon
   * mints its own UUID.
   */
  agentId: external_exports.string().uuid().optional(),
  outputSchema: external_exports.record(external_exports.unknown()).optional(),
  images: external_exports.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  git: GitSetupOptionsSchema.optional(),
  worktree: CreateAgentWorktreeTargetSchema.optional(),
  autoArchive: external_exports.boolean().optional(),
  labels: external_exports.record(external_exports.string()).default({}),
  relationKind: external_exports.enum(AGENT_RELATION_KINDS).optional(),
  requestId: external_exports.string()
});
var AgentPresetsListRequestMessageSchema = external_exports.object({
  type: external_exports.literal("agent.presets.list.request"),
  requestId: external_exports.string()
});
var ResumeAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("resume_agent_request"),
  handle: AgentPersistenceHandleSchema,
  overrides: AgentSessionConfigSchema.partial().optional(),
  requestId: external_exports.string()
});
var ImportAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("import_agent_request"),
  provider: AgentProviderSchema.optional(),
  providerId: external_exports.string().optional(),
  sessionId: external_exports.string().optional(),
  providerHandleId: external_exports.string().optional(),
  cwd: external_exports.string().optional(),
  labels: external_exports.record(external_exports.string()).optional(),
  requestId: external_exports.string()
});
var RefreshAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("refresh_agent_request"),
  agentId: external_exports.string(),
  requestId: external_exports.string()
});
var CancelAgentRequestMessageSchema = external_exports.object({
  type: external_exports.literal("cancel_agent_request"),
  agentId: external_exports.string(),
  requestId: external_exports.string().optional()
});
var AgentTimelineCursorSchema = external_exports.object({
  epoch: external_exports.string(),
  seq: external_exports.number().int().nonnegative()
});
var FetchAgentTimelineRequestMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_timeline_request"),
  agentId: external_exports.string(),
  requestId: external_exports.string(),
  direction: external_exports.enum(["tail", "before", "after"]).optional(),
  cursor: AgentTimelineCursorSchema.optional(),
  // 0 means "all matching rows for this query window".
  limit: external_exports.number().int().nonnegative().optional(),
  // Default should be projected for app timeline loading.
  projection: external_exports.enum(["projected", "canonical"]).optional()
});
var SetAgentModeRequestMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_mode_request"),
  agentId: external_exports.string(),
  modeId: external_exports.string(),
  requestId: external_exports.string()
});
var AgentActionResponsePayloadSchema = external_exports.object({
  requestId: external_exports.string(),
  agentId: external_exports.string(),
  accepted: external_exports.boolean(),
  error: external_exports.string().nullable()
});
var SetAgentModeResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_mode_response"),
  payload: AgentActionResponsePayloadSchema
});
var SetAgentModelRequestMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_model_request"),
  agentId: external_exports.string(),
  modelId: external_exports.string().nullable(),
  runtimeProvider: AgentProviderSchema.nullable().optional(),
  requestId: external_exports.string()
});
var SetAgentModelResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_model_response"),
  payload: AgentActionResponsePayloadSchema
});
var SetAgentThinkingRequestMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_thinking_request"),
  agentId: external_exports.string(),
  thinkingOptionId: external_exports.string().nullable(),
  requestId: external_exports.string()
});
var SetAgentThinkingResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_thinking_response"),
  payload: AgentActionResponsePayloadSchema
});
var SetAgentFeatureRequestMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_feature_request"),
  agentId: external_exports.string(),
  featureId: external_exports.string(),
  value: external_exports.unknown(),
  requestId: external_exports.string()
});
var SetAgentFeatureResponseMessageSchema = external_exports.object({
  type: external_exports.literal("set_agent_feature_response"),
  payload: AgentActionResponsePayloadSchema
});
var AgentRewindModeSchema = external_exports.enum(["conversation", "files", "both"]);
var AgentRewindRequestMessageSchema = external_exports.object({
  type: external_exports.literal("agent.rewind.request"),
  agentId: external_exports.string(),
  messageId: external_exports.string(),
  mode: AgentRewindModeSchema,
  requestId: external_exports.string()
});
var AgentRewindResponseMessageSchema = external_exports.object({
  type: external_exports.literal("agent.rewind.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agentId: external_exports.string(),
    ok: external_exports.boolean(),
    error: external_exports.string().nullable()
  })
});
var UpdateAgentResponseMessageSchema = external_exports.object({
  type: external_exports.literal("update_agent_response"),
  payload: AgentActionResponsePayloadSchema
});
var AgentPermissionResponseMessageSchema = external_exports.object({
  type: external_exports.literal("agent_permission_response"),
  agentId: external_exports.string(),
  requestId: external_exports.string(),
  response: AgentPermissionResponseSchema
});
var ClearAgentAttentionMessageSchema = external_exports.object({
  type: external_exports.literal("clear_agent_attention"),
  agentId: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]),
  requestId: external_exports.string().optional()
});
var ListCommandsRequestSchema = external_exports.object({
  type: external_exports.literal("list_commands_request"),
  agentId: external_exports.string(),
  draftConfig: ListCommandsDraftConfigSchema.optional(),
  requestId: external_exports.string()
});
var AgentInboundMessageSchemas = [
  FetchAgentsRequestMessageSchema,
  FetchAgentHistoryRequestMessageSchema,
  FetchAgentRequestMessageSchema,
  DeleteAgentRequestMessageSchema,
  ArchiveAgentRequestMessageSchema,
  UpdateAgentRequestMessageSchema,
  SendAgentMessageRequestSchema,
  WaitForFinishRequestSchema,
  CreateAgentRequestMessageSchema,
  AgentPresetsListRequestMessageSchema,
  ResumeAgentRequestMessageSchema,
  ImportAgentRequestMessageSchema,
  RefreshAgentRequestMessageSchema,
  CancelAgentRequestMessageSchema,
  FetchAgentTimelineRequestMessageSchema,
  SetAgentModeRequestMessageSchema,
  SetAgentModelRequestMessageSchema,
  SetAgentThinkingRequestMessageSchema,
  SetAgentFeatureRequestMessageSchema,
  AgentRewindRequestMessageSchema,
  AgentPermissionResponseMessageSchema,
  ClearAgentAttentionMessageSchema,
  ListCommandsRequestSchema
];
var AgentStatusWithRequestSchema = external_exports.object({
  agentId: external_exports.string(),
  requestId: external_exports.string()
});
var AgentStatusWithTimelineSchema = AgentStatusWithRequestSchema.extend({
  timelineSize: external_exports.number().optional()
});
var AgentCreatedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("agent_created"),
  agent: AgentSnapshotPayloadSchema,
  /**
   * Project placement for the created agent's workspace. Optional so older
   * daemons/clients remain wire-compatible; the client falls back to the
   * workspace descriptor or a cwd-derived placement when absent.
   */
  project: ProjectPlacementPayloadSchema.nullable().optional(),
  /**
   * When true, the agent session was constructed and the initial prompt (if any)
   * was dispatched asynchronously. Optional for wire compatibility.
   */
  pendingRun: external_exports.boolean().optional()
}).extend(AgentStatusWithRequestSchema.shape);
var AgentCreateFailedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("agent_create_failed"),
  requestId: external_exports.string(),
  error: external_exports.string(),
  errorCode: external_exports.string().optional()
});
var AgentResumedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("agent_resumed"),
  agent: AgentSnapshotPayloadSchema
}).extend(AgentStatusWithTimelineSchema.shape);
var AgentRefreshedStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("agent_refreshed")
}).extend(AgentStatusWithTimelineSchema.shape);
var AgentStatusPayloadSchemas = [
  AgentCreatedStatusPayloadSchema,
  AgentCreateFailedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema
];
var AgentUpdateMessageSchema = external_exports.object({
  type: external_exports.literal("agent_update"),
  payload: external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("upsert"),
      agent: AgentSnapshotPayloadSchema,
      project: ProjectPlacementPayloadSchema.nullable().optional()
    }),
    external_exports.object({
      kind: external_exports.literal("remove"),
      agentId: external_exports.string()
    })
  ])
});
var AgentStreamMessageSchema = external_exports.object({
  type: external_exports.literal("agent_stream"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    event: AgentStreamEventPayloadSchema,
    timestamp: external_exports.string(),
    // Present for timeline events. Maps 1:1 to canonical in-memory timeline rows.
    seq: external_exports.number().int().nonnegative().optional(),
    epoch: external_exports.string().optional()
  })
});
var AgentStatusMessageSchema = external_exports.object({
  type: external_exports.literal("agent_status"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    status: external_exports.string(),
    info: AgentSnapshotPayloadSchema
  })
});
var AgentListMessageSchema = external_exports.object({
  type: external_exports.literal("agent_list"),
  payload: external_exports.object({
    agents: external_exports.array(AgentSnapshotPayloadSchema)
  })
});
var AgentDirectoryResponseEntrySchema = external_exports.object({
  agent: AgentSnapshotPayloadSchema,
  project: ProjectPlacementPayloadSchema
});
var AgentDirectoryPageInfoSchema = external_exports.object({
  nextCursor: external_exports.string().nullable(),
  prevCursor: external_exports.string().nullable(),
  hasMore: external_exports.boolean()
});
var FetchAgentsResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agents_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    subscriptionId: external_exports.string().nullable().optional(),
    entries: external_exports.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema
  })
});
var FetchAgentHistoryResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_history_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    entries: external_exports.array(AgentDirectoryResponseEntrySchema),
    pageInfo: AgentDirectoryPageInfoSchema
  })
});
var FetchAgentResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    project: ProjectPlacementPayloadSchema.nullable().optional(),
    error: external_exports.string().nullable()
  })
});
var AgentTimelineSeqRangeSchema = external_exports.object({
  startSeq: external_exports.number().int().nonnegative(),
  endSeq: external_exports.number().int().nonnegative()
});
var AgentTimelineEntryPayloadSchema = external_exports.object({
  provider: AgentProviderSchema,
  item: AgentTimelineItemPayloadSchema,
  timestamp: external_exports.string(),
  seqStart: external_exports.number().int().nonnegative(),
  seqEnd: external_exports.number().int().nonnegative(),
  sourceSeqRanges: external_exports.array(AgentTimelineSeqRangeSchema),
  collapsed: external_exports.array(external_exports.enum(["assistant_merge", "reasoning_merge", "tool_lifecycle"]))
});
var FetchAgentTimelineResponseMessageSchema = external_exports.object({
  type: external_exports.literal("fetch_agent_timeline_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agentId: external_exports.string(),
    agent: AgentSnapshotPayloadSchema.nullable(),
    direction: external_exports.enum(["tail", "before", "after"]),
    projection: external_exports.enum(["projected", "canonical"]),
    epoch: external_exports.string(),
    reset: external_exports.boolean(),
    staleCursor: external_exports.boolean(),
    gap: external_exports.boolean(),
    window: external_exports.object({
      minSeq: external_exports.number().int().nonnegative(),
      maxSeq: external_exports.number().int().nonnegative(),
      nextSeq: external_exports.number().int().nonnegative()
    }),
    startCursor: AgentTimelineCursorSchema.nullable(),
    endCursor: AgentTimelineCursorSchema.nullable(),
    hasOlder: external_exports.boolean(),
    hasNewer: external_exports.boolean(),
    entries: external_exports.array(AgentTimelineEntryPayloadSchema),
    error: external_exports.string().nullable(),
    /**
     * When true, provider history is still seeding into the in-memory timeline.
     * Optional for wire compatibility; old clients ignore the field.
     */
    hydrating: external_exports.boolean().optional()
  })
});
var CancelAgentResponseMessageSchema = external_exports.object({
  type: external_exports.literal("cancel_agent_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agentId: external_exports.string(),
    agent: AgentSnapshotPayloadSchema.nullable()
  })
});
var ClearAgentAttentionResponseMessageSchema = external_exports.object({
  type: external_exports.literal("clear_agent_attention_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agentId: external_exports.string().or(external_exports.array(external_exports.string())),
    agents: external_exports.array(AgentSnapshotPayloadSchema)
  })
});
var SendAgentMessageResponseMessageSchema = external_exports.object({
  type: external_exports.literal("send_agent_message_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    agentId: external_exports.string(),
    accepted: external_exports.boolean(),
    error: external_exports.string().nullable(),
    /**
     * When true, the prompt was dispatched but the run has not necessarily
     * started yet. Failures after acceptance arrive as stream/state events.
     * Optional for wire compatibility.
     */
    pendingRun: external_exports.boolean().optional()
  })
});
var WaitForFinishResponseMessageSchema = external_exports.object({
  type: external_exports.literal("wait_for_finish_response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    status: external_exports.enum(["idle", "error", "permission", "timeout"]),
    final: AgentSnapshotPayloadSchema.nullable(),
    error: external_exports.string().nullable(),
    lastMessage: external_exports.string().nullable()
  })
});
var AgentPermissionRequestMessageSchema = external_exports.object({
  type: external_exports.literal("agent_permission_request"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    request: AgentPermissionRequestPayloadSchema
  })
});
var AgentPermissionResolvedMessageSchema = external_exports.object({
  type: external_exports.literal("agent_permission_resolved"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    requestId: external_exports.string(),
    resolution: AgentPermissionResponseSchema
  })
});
var AgentDeletedMessageSchema = external_exports.object({
  type: external_exports.literal("agent_deleted"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    requestId: external_exports.string()
  })
});
var AgentArchivedMessageSchema = external_exports.object({
  type: external_exports.literal("agent_archived"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    archivedAt: external_exports.string(),
    requestId: external_exports.string()
  })
});
var AgentPresetsListResponseMessageSchema = external_exports.object({
  type: external_exports.literal("agent.presets.list.response"),
  payload: AgentPresetsPayloadSchema.extend({
    requestId: external_exports.string()
  })
});
var AgentSlashCommandSchema = external_exports.object({
  name: external_exports.string(),
  description: external_exports.string(),
  argumentHint: external_exports.string()
});
var ListCommandsResponseSchema = external_exports.object({
  type: external_exports.literal("list_commands_response"),
  payload: external_exports.object({
    agentId: external_exports.string(),
    commands: external_exports.array(AgentSlashCommandSchema),
    error: external_exports.string().nullable(),
    requestId: external_exports.string()
  })
});
var AgentOutboundMessageSchemas = [
  AgentUpdateMessageSchema,
  AgentStreamMessageSchema,
  AgentStatusMessageSchema,
  FetchAgentsResponseMessageSchema,
  FetchAgentHistoryResponseMessageSchema,
  FetchAgentResponseMessageSchema,
  FetchAgentTimelineResponseMessageSchema,
  CancelAgentResponseMessageSchema,
  ClearAgentAttentionResponseMessageSchema,
  SendAgentMessageResponseMessageSchema,
  SetAgentModeResponseMessageSchema,
  SetAgentModelResponseMessageSchema,
  SetAgentThinkingResponseMessageSchema,
  SetAgentFeatureResponseMessageSchema,
  AgentRewindResponseMessageSchema,
  UpdateAgentResponseMessageSchema,
  WaitForFinishResponseMessageSchema,
  AgentPermissionRequestMessageSchema,
  AgentPermissionResolvedMessageSchema,
  AgentDeletedMessageSchema,
  AgentArchivedMessageSchema,
  AgentPresetsListResponseMessageSchema,
  ListCommandsResponseSchema
];

// vendor/chisacode-remote/packages/protocol/dist/dshd-desktop-rpc.js
var DshdHostRpcRequestSchema = external_exports.object({
  type: external_exports.literal("dshd.host.rpc.request"),
  requestId: external_exports.string().min(1),
  method: external_exports.string().min(1),
  payload: external_exports.unknown().optional()
});
var DshdHostRpcResponseSchema = external_exports.object({
  type: external_exports.literal("dshd.host.rpc.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    value: external_exports.unknown().optional(),
    error: external_exports.unknown().optional()
  })
});
var DshdGitRpcRequestSchema = external_exports.object({
  type: external_exports.literal("dshd.git.rpc.request"),
  requestId: external_exports.string().min(1),
  action: external_exports.string().min(1),
  cwd: external_exports.string(),
  payload: external_exports.unknown().optional()
});
var DshdGitRpcResponseSchema = external_exports.object({
  type: external_exports.literal("dshd.git.rpc.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    ok: external_exports.boolean(),
    value: external_exports.unknown().optional(),
    error: external_exports.string().optional()
  })
});
var DshdHostMuxSubscribeSchema = external_exports.object({
  type: external_exports.literal("dshd.host.mux.subscribe"),
  requestId: external_exports.string().min(1)
});
var DshdHostMuxUnsubscribeSchema = external_exports.object({
  type: external_exports.literal("dshd.host.mux.unsubscribe"),
  requestId: external_exports.string().min(1)
});
var DshdHostMuxFrameSchema = external_exports.object({
  type: external_exports.literal("dshd.host.mux.frame"),
  payload: external_exports.object({
    rpcId: external_exports.string(),
    envelope: external_exports.unknown()
  })
});
var DshdInboundMessageSchemas = [
  DshdHostRpcRequestSchema,
  DshdGitRpcRequestSchema,
  DshdHostMuxSubscribeSchema,
  DshdHostMuxUnsubscribeSchema
];
var DshdOutboundMessageSchemas = [
  DshdHostRpcResponseSchema,
  DshdGitRpcResponseSchema,
  DshdHostMuxFrameSchema
];

// vendor/chisacode-remote/packages/protocol/dist/messages.js
var AbortRequestMessageSchema = external_exports.object({
  type: external_exports.literal("abort_request")
});
var CloseItemsRequestMessageSchema = external_exports.object({
  type: external_exports.literal("close_items_request"),
  agentIds: external_exports.array(external_exports.string()).default([]),
  terminalIds: external_exports.array(external_exports.string()).default([]),
  requestId: external_exports.string()
});
var ProjectRenameRequestSchema = external_exports.object({
  type: external_exports.literal("project.rename.request"),
  projectId: external_exports.string(),
  // Null or empty string clears the override and reverts to the derived name.
  customName: external_exports.string().nullable(),
  requestId: external_exports.string()
});
var ModelGatewayMoaTestRequestMessageSchema = external_exports.object({
  type: external_exports.literal("model_gateway.moa.test.request"),
  requestId: external_exports.string(),
  gatewayId: external_exports.string().min(1),
  syntheticModel: SyntheticModelConfigSchema,
  prompt: external_exports.string().min(1)
});
var ModelGatewayTestRequestMessageSchema = external_exports.object({
  type: external_exports.literal("model_gateway.test.request"),
  requestId: external_exports.string(),
  gatewayId: external_exports.string().min(1),
  modelId: external_exports.string().min(1),
  // Optional format hint lets saved multi-protocol rows test their intended upstream.
  targetFormat: external_exports.enum(["anthropic", "chatCompletions", "responses"]).optional()
});
var ProjectRenameResponsePayloadSchema = external_exports.object({
  requestId: external_exports.string(),
  projectId: external_exports.string(),
  accepted: external_exports.boolean(),
  customName: external_exports.string().nullable(),
  error: external_exports.string().nullable()
});
var ProjectRenameResponseSchema = external_exports.object({
  type: external_exports.literal("project.rename.response"),
  payload: ProjectRenameResponsePayloadSchema
});
var ClientHeartbeatMessageSchema = external_exports.object({
  type: external_exports.literal("client_heartbeat"),
  deviceType: external_exports.enum(["web", "mobile"]),
  focusedAgentId: external_exports.string().nullable(),
  lastActivityAt: external_exports.string(),
  appVisible: external_exports.boolean(),
  appVisibilityChangedAt: external_exports.string().optional()
});
var PingMessageSchema = external_exports.object({
  type: external_exports.literal("ping"),
  requestId: external_exports.string(),
  clientSentAt: external_exports.number().int().optional()
});
var RegisterPushTokenMessageSchema = external_exports.object({
  type: external_exports.literal("register_push_token"),
  token: external_exports.string()
});
var SessionInboundMessageSchema = external_exports.discriminatedUnion("type", [
  ...VoiceInboundMessageSchemas,
  AbortRequestMessageSchema,
  ...AgentInboundMessageSchemas,
  ...UsageInboundMessageSchemas,
  CloseItemsRequestMessageSchema,
  ProjectRenameRequestSchema,
  ...DaemonInboundMessageSchemas,
  ...AgentExtensionInboundMessageSchemas,
  ModelGatewayMoaTestRequestMessageSchema,
  ModelGatewayTestRequestMessageSchema,
  ...CheckoutInboundMessageSchemas,
  ...WorkspaceInboundMessageSchemas,
  ...ProviderInboundMessageSchemas,
  ClientHeartbeatMessageSchema,
  PingMessageSchema,
  RegisterPushTokenMessageSchema,
  ...TerminalInboundMessageSchemas,
  ...AutomationInboundMessageSchemas,
  ...CindyInboundMessageSchemas,
  GenerativeUiActionRequestSchema,
  // COMPAT(generativeUiActionFlatRpc): added in v0.1.101; remove after 2027-01-11 once the client floor is >= v0.1.101.
  LegacyGenerativeUiActionRequestSchema,
  ...DshdInboundMessageSchemas
]);
var ActivityLogPayloadSchema = external_exports.object({
  id: external_exports.string(),
  timestamp: external_exports.coerce.date(),
  type: external_exports.enum(["transcript", "assistant", "tool_call", "tool_result", "error", "system"]),
  content: external_exports.string(),
  metadata: external_exports.record(external_exports.unknown()).optional()
});
var ActivityLogMessageSchema = external_exports.object({
  type: external_exports.literal("activity_log"),
  payload: ActivityLogPayloadSchema
});
var AssistantChunkMessageSchema = external_exports.object({
  type: external_exports.literal("assistant_chunk"),
  payload: external_exports.object({
    chunk: external_exports.string()
  })
});
var ServerCapabilitiesSchema = external_exports.object({
  voice: ServerVoiceCapabilitiesSchema.optional()
}).passthrough();
var ServerInfoHostnameSchema = external_exports.unknown().transform((value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});
var ServerInfoVersionSchema = external_exports.unknown().transform((value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
});
var ServerCapabilitiesFromUnknownSchema = external_exports.unknown().optional().transform((value) => {
  if (value === void 0) {
    return void 0;
  }
  const parsed = ServerCapabilitiesSchema.safeParse(value);
  if (!parsed.success) {
    return void 0;
  }
  return parsed.data;
});
var SourceCodeOfferSchema = external_exports.object({
  license: external_exports.literal("AGPL-3.0-or-later"),
  repositoryUrl: external_exports.string().url(),
  noticePath: external_exports.string().min(1),
  originalProjectUrl: external_exports.string().url(),
  offerPath: external_exports.string().min(1),
  correspondingSourceRequired: external_exports.boolean()
});
var ServerInfoStatusPayloadSchema = external_exports.object({
  status: external_exports.literal("server_info"),
  serverId: external_exports.string().trim().min(1),
  hostname: ServerInfoHostnameSchema.optional(),
  version: ServerInfoVersionSchema.optional(),
  sourceCode: SourceCodeOfferSchema.optional(),
  capabilities: ServerCapabilitiesFromUnknownSchema,
  // COMPAT(providersSnapshot): added in v0.1.48, remove gating when all clients use snapshot
  features: external_exports.object({
    providersSnapshot: external_exports.boolean().optional(),
    checkoutGithubSetAutoMerge: external_exports.boolean().optional(),
    // COMPAT(daemonStatusRpc): added in v0.1.76, remove gate after 2026-11-18.
    daemonStatusRpc: external_exports.boolean().optional(),
    // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
    "terminal-restore-modes": external_exports.boolean().optional(),
    // COMPAT(rewind): added in v0.1.X, drop the gate when floor >= v0.1.X.
    rewind: external_exports.boolean().optional(),
    // COMPAT(checkoutRefresh): added in v0.1.86, remove gate after 2026-11-29.
    checkoutRefresh: external_exports.boolean().optional(),
    // COMPAT(agentSkillManagement): added in v0.1.X, remove gate when all clients support it.
    agentSkillManagement: external_exports.boolean().optional(),
    // COMPAT(agentMcpServerManagement): added in v0.1.X, remove gate when all clients support it.
    agentMcpServerManagement: external_exports.boolean().optional(),
    // COMPAT(providerUsageList): added in v0.1.98, drop the gate when daemon floor >= v0.1.98.
    providerUsageList: external_exports.boolean().optional(),
    // COMPAT(daemonDiagnostics): added in v0.1.100, remove gate after 2026-12-25 once daemon floor >= v0.1.100.
    daemonDiagnostics: external_exports.boolean().optional(),
    // COMPAT(generativeUiWireCapability): added in v0.1.101; remove the gate no earlier than 2027-01-11 when client/daemon floor >= v0.1.101.
    generativeUi: external_exports.boolean().optional(),
    // COMPAT(cindyModules): added in v0.1.102, remove no earlier than 2027-07-29 when client/daemon floor >= v0.1.102.
    cindyModules: external_exports.boolean().optional(),
    // COMPAT(modelGatewaySupplyScope): added in v0.1.103; remove the gate when daemon floor >= the version that persists supplyScope.
    modelGatewaySupplyScope: external_exports.boolean().optional()
  }).optional()
}).passthrough().transform((payload) => ({
  ...payload,
  hostname: payload.hostname ?? null,
  version: payload.version ?? null
}));
var StatusMessageSchema = external_exports.object({
  type: external_exports.literal("status"),
  payload: external_exports.object({
    status: external_exports.string()
  }).passthrough()
  // Allow additional fields
});
var PongMessageSchema = external_exports.object({
  type: external_exports.literal("pong"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    clientSentAt: external_exports.number().int().optional(),
    serverReceivedAt: external_exports.number().int(),
    serverSentAt: external_exports.number().int()
  })
});
var RpcErrorMessageSchema = external_exports.object({
  type: external_exports.literal("rpc_error"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    requestType: external_exports.string().optional(),
    error: external_exports.string(),
    code: external_exports.string().optional()
  })
});
var KnownStatusPayloadSchema = external_exports.discriminatedUnion("status", [
  ...AgentStatusPayloadSchemas,
  ...DaemonStatusPayloadSchemas
]);
var ArtifactMessageSchema = external_exports.object({
  type: external_exports.literal("artifact"),
  payload: external_exports.object({
    type: external_exports.enum(["markdown", "diff", "image", "code"]),
    id: external_exports.string(),
    title: external_exports.string(),
    content: external_exports.string(),
    isBase64: external_exports.boolean()
  })
});
var CloseItemsAgentResultSchema = external_exports.object({
  agentId: external_exports.string(),
  archivedAt: external_exports.string()
});
var CloseItemsTerminalResultSchema = external_exports.object({
  terminalId: external_exports.string(),
  success: external_exports.boolean()
});
var CloseItemsResponseSchema = external_exports.object({
  type: external_exports.literal("close_items_response"),
  payload: external_exports.object({
    agents: external_exports.array(CloseItemsAgentResultSchema),
    terminals: external_exports.array(CloseItemsTerminalResultSchema),
    requestId: external_exports.string()
  })
});
var ModelGatewayMoaNodeTraceSchema = external_exports.object({
  id: external_exports.string().nullable(),
  model: external_exports.string(),
  status: external_exports.enum(["success", "error"]),
  output: external_exports.string().nullable(),
  error: external_exports.string().nullable(),
  durationMs: external_exports.number()
});
var ModelGatewayMoaLayerTraceSchema = external_exports.object({
  id: external_exports.string(),
  label: external_exports.string().nullable(),
  nodes: external_exports.array(ModelGatewayMoaNodeTraceSchema)
});
var ModelGatewayMoaAggregatorTraceSchema = external_exports.object({
  model: external_exports.string(),
  status: external_exports.enum(["success", "error"]),
  output: external_exports.string().nullable(),
  error: external_exports.string().nullable(),
  durationMs: external_exports.number()
});
var ModelGatewayMoaTestResultSchema = external_exports.object({
  finalText: external_exports.string(),
  durationMs: external_exports.number(),
  layers: external_exports.array(ModelGatewayMoaLayerTraceSchema),
  aggregator: ModelGatewayMoaAggregatorTraceSchema
});
var ModelGatewayTestResultSchema = external_exports.object({
  ok: external_exports.boolean(),
  durationMs: external_exports.number().nonnegative(),
  status: external_exports.number().int().nullable(),
  error: external_exports.string().nullable()
});
var ModelGatewayTestResponseMessageSchema = external_exports.object({
  type: external_exports.literal("model_gateway.test.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    gatewayId: external_exports.string(),
    modelId: external_exports.string(),
    result: ModelGatewayTestResultSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var ModelGatewayMoaTestResponseMessageSchema = external_exports.object({
  type: external_exports.literal("model_gateway.moa.test.response"),
  payload: external_exports.object({
    requestId: external_exports.string(),
    gatewayId: external_exports.string(),
    result: ModelGatewayMoaTestResultSchema.nullable(),
    error: external_exports.string().nullable()
  })
});
var SessionOutboundMessageSchema = external_exports.discriminatedUnion("type", [
  ActivityLogMessageSchema,
  AssistantChunkMessageSchema,
  ...VoiceOutboundMessageSchemas,
  StatusMessageSchema,
  PongMessageSchema,
  RpcErrorMessageSchema,
  ArtifactMessageSchema,
  ...AgentOutboundMessageSchemas,
  ...WorkspaceOutboundMessageSchemas,
  ...ProviderOutboundMessageSchemas,
  ...UsageOutboundMessageSchemas,
  ...DaemonOutboundMessageSchemas,
  ProjectRenameResponseSchema,
  CloseItemsResponseSchema,
  ...CheckoutOutboundMessageSchemas,
  ModelGatewayMoaTestResponseMessageSchema,
  ModelGatewayTestResponseMessageSchema,
  ...AgentExtensionOutboundMessageSchemas,
  ...TerminalOutboundMessageSchemas,
  ...AutomationOutboundMessageSchemas,
  ...CindyOutboundMessageSchemas,
  GenerativeUiActionResponseSchema,
  ...DshdOutboundMessageSchemas
]);
var WSPingMessageSchema = external_exports.object({
  type: external_exports.literal("ping")
});
var WSPongMessageSchema = external_exports.object({
  type: external_exports.literal("pong")
});
var WSHelloMessageSchema = external_exports.object({
  type: external_exports.literal("hello"),
  clientId: external_exports.string().min(1),
  clientType: external_exports.enum(["mobile", "browser", "cli", "mcp"]),
  protocolVersion: external_exports.number().int(),
  appVersion: external_exports.string().optional(),
  capabilities: external_exports.object({
    voice: external_exports.boolean().optional(),
    pushNotifications: external_exports.boolean().optional(),
    [CLIENT_CAPS.reasoningMergeEnum]: external_exports.boolean().optional(),
    [CLIENT_CAPS.customModeIcons]: external_exports.boolean().optional(),
    [CLIENT_CAPS.generativeUi]: external_exports.boolean().optional()
  }).passthrough().optional(),
  /**
   * Optional relay device-auth material. Append-only: old daemons ignore this field.
   * New daemons require it for transport=relay unless legacy offer-only mode is enabled.
   */
  relayDeviceAuth: external_exports.object({
    version: external_exports.literal(1),
    deviceId: external_exports.string().min(8).max(128),
    proof: external_exports.string().min(16).max(256).optional(),
    pairingToken: external_exports.string().min(16).max(256).optional(),
    clientPublicKeyB64: external_exports.string().min(1).optional(),
    challenge: external_exports.string().min(16).max(256).optional(),
    /**
     * Client-reported operator label, stored as the device label on first
     * pairing. Old daemons ignore it. Trimmed; 1-120 chars.
     */
    deviceName: external_exports.string().trim().min(1).max(120).optional()
  }).optional()
});
var WSRecordingStateMessageSchema = external_exports.object({
  type: external_exports.literal("recording_state"),
  isRecording: external_exports.boolean()
});
var WSSessionInboundSchema = external_exports.object({
  type: external_exports.literal("session"),
  message: SessionInboundMessageSchema
});
var WSSessionOutboundSchema = external_exports.object({
  type: external_exports.literal("session"),
  message: SessionOutboundMessageSchema
});
var WSInboundMessageSchema = external_exports.discriminatedUnion("type", [
  WSPingMessageSchema,
  WSHelloMessageSchema,
  WSRecordingStateMessageSchema,
  WSSessionInboundSchema
]);
var WSRelayDeviceAuthResultMessageSchema = external_exports.object({
  type: external_exports.literal("relay_device_auth_result"),
  version: external_exports.literal(1),
  ok: external_exports.boolean(),
  deviceId: external_exports.string().min(8).max(128).optional(),
  deviceSecret: external_exports.string().min(32).max(256).optional(),
  reason: external_exports.string().max(200).optional(),
  securityLevel: external_exports.enum(["v2", "legacy"]).optional()
});
var WSOutboundMessageSchema = external_exports.discriminatedUnion("type", [
  WSPongMessageSchema,
  WSRelayDeviceAuthResultMessageSchema,
  WSSessionOutboundSchema
]);
function parseServerInfoStatusPayload(payload) {
  const parsed = ServerInfoStatusPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-transport-utils.js
function copyArrayBufferViewToBuffer(data) {
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out.buffer;
}
function normalizeTransportPayload(data) {
  if (typeof data === "string" || data instanceof ArrayBuffer) {
    return data;
  }
  return copyArrayBufferViewToBuffer(data);
}
function extractRelayMessageData(event) {
  const raw = event && typeof event === "object" && "data" in event ? event.data : event;
  if (typeof raw === "string")
    return raw;
  if (raw instanceof ArrayBuffer)
    return raw;
  if (ArrayBuffer.isView(raw)) {
    return copyArrayBufferViewToBuffer(raw);
  }
  return String(raw ?? "");
}
function describeTransportClose(event) {
  if (!event) {
    return "Transport closed";
  }
  if (event instanceof Error) {
    return event.message;
  }
  if (typeof event === "string") {
    return event;
  }
  if (typeof event === "object") {
    const record = event;
    if (typeof record.reason === "string" && record.reason.trim().length > 0) {
      return record.reason.trim();
    }
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message.trim();
    }
    if (typeof record.code === "number") {
      return `Transport closed (code ${record.code})`;
    }
  }
  return "Transport closed";
}
function describeTransportError(event) {
  if (!event) {
    return "Transport error";
  }
  if (event instanceof Error) {
    return event.message;
  }
  if (typeof event === "string") {
    return event;
  }
  if (typeof event === "object") {
    const record = event;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message.trim();
    }
  }
  return "Transport error";
}
function safeRandomId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function decodeMessageData(data) {
  if (data === null || data === void 0) {
    return null;
  }
  if (typeof data === "string") {
    return data;
  }
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(data).toString("utf8");
    }
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder().decode(data);
    }
  }
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(view).toString("utf8");
    }
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder().decode(view);
    }
  }
  if (typeof data.toString === "function") {
    return data.toString();
  }
  return null;
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-checkout-commands.js
var CheckoutCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  checkoutCommit(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_commit_request",
        cwd,
        message: input.message,
        addAll: input.addAll
      },
      responseType: "checkout_commit_response",
      timeout: 6e4
    });
  }
  checkoutMerge(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_merge_request",
        cwd,
        baseRef: input.baseRef,
        strategy: input.strategy,
        requireCleanTarget: input.requireCleanTarget
      },
      responseType: "checkout_merge_response",
      timeout: 6e4
    });
  }
  checkoutMergeFromBase(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_merge_from_base_request",
        cwd,
        baseRef: input.baseRef,
        requireCleanTarget: input.requireCleanTarget
      },
      responseType: "checkout_merge_from_base_response",
      timeout: 6e4
    });
  }
  checkoutPull(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "checkout_pull_request", cwd },
      responseType: "checkout_pull_response",
      timeout: 6e4
    });
  }
  checkoutPush(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "checkout_push_request", cwd },
      responseType: "checkout_push_response",
      timeout: 6e4
    });
  }
  checkoutRefresh(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "checkout.refresh.request", cwd },
      responseType: "checkout.refresh.response",
      timeout: 6e4
    });
  }
  checkoutPrCreate(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_pr_create_request",
        cwd,
        title: input.title,
        body: input.body,
        baseRef: input.baseRef
      },
      responseType: "checkout_pr_create_response",
      timeout: 6e4
    });
  }
  checkoutPrMerge(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_pr_merge_request",
        cwd,
        mergeMethod: input.method
      },
      responseType: "checkout_pr_merge_response",
      timeout: 6e4
    });
  }
  checkoutGithubSetAutoMerge(cwd, input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout.github.set_auto_merge.request",
        cwd,
        enabled: input.enabled,
        ...input.enabled ? { mergeMethod: input.method } : {}
      },
      responseType: "checkout.github.set_auto_merge.response",
      timeout: 6e4
    });
  }
  checkoutPrStatus(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "checkout_pr_status_request", cwd },
      responseType: "checkout_pr_status_response",
      timeout: 6e4
    });
  }
  pullRequestTimeline(input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "pull_request_timeline_request",
        cwd: input.cwd,
        prNumber: input.prNumber,
        repoOwner: input.repoOwner,
        repoName: input.repoName
      },
      responseType: "pull_request_timeline_response",
      timeout: 6e4
    });
  }
  checkoutSwitchBranch(cwd, branch, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "checkout_switch_branch_request", cwd, branch },
      responseType: "checkout_switch_branch_response",
      timeout: 3e4
    });
  }
  renameBranch(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "checkout.rename_branch.request", cwd: input.cwd, branch: input.branch },
      responseType: "checkout.rename_branch.response",
      timeout: 3e4
    });
  }
  stashSave(cwd, options, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "stash_save_request", cwd, branch: options?.branch },
      responseType: "stash_save_response",
      timeout: 3e4
    });
  }
  stashPop(cwd, stashIndex, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "stash_pop_request", cwd, stashIndex },
      responseType: "stash_pop_response",
      timeout: 3e4
    });
  }
  stashList(cwd, options, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "stash_list_request", cwd, chisacodeOnly: options?.chisacodeOnly },
      responseType: "stash_list_response",
      timeout: 1e4
    });
  }
  getChisaCodeWorktreeList(input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "chisacode_worktree_list_request",
        cwd: input.cwd,
        repoRoot: input.repoRoot
      },
      responseType: "chisacode_worktree_list_response",
      timeout: 6e4
    });
  }
  archiveChisaCodeWorktree(input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "chisacode_worktree_archive_request",
        worktreePath: input.worktreePath,
        repoRoot: input.repoRoot,
        branchName: input.branchName
      },
      responseType: "chisacode_worktree_archive_response",
      timeout: 6e4
    });
  }
  createChisaCodeWorktree(input, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "create_chisacode_worktree_request",
        cwd: input.cwd,
        ...input.projectId !== void 0 ? { projectId: input.projectId } : {},
        worktreeSlug: input.worktreeSlug,
        ...input.firstAgentContext !== void 0 ? { firstAgentContext: input.firstAgentContext } : {},
        ...input.refName !== void 0 ? { refName: input.refName } : {},
        ...input.action !== void 0 ? { action: input.action } : {},
        ...input.githubPrNumber !== void 0 ? { githubPrNumber: input.githubPrNumber } : {}
      },
      responseType: "create_chisacode_worktree_response",
      timeout: 6e4
    });
  }
  validateBranch(options, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "validate_branch_request",
        cwd: options.cwd,
        branchName: options.branchName
      },
      responseType: "validate_branch_response",
      timeout: 1e4
    });
  }
  getBranchSuggestions(options, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "branch_suggestions_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit
      },
      responseType: "branch_suggestions_response",
      timeout: 1e4
    });
  }
  searchGitHub(options, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "github_search_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
        kinds: options.kinds
      },
      responseType: "github_search_response",
      timeout: 15e3
    });
  }
  getDirectorySuggestions(options, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "directory_suggestions_request",
        query: options.query,
        cwd: options.cwd,
        includeFiles: options.includeFiles,
        includeDirectories: options.includeDirectories,
        matchMode: options.matchMode,
        limit: options.limit
      },
      responseType: "directory_suggestions_response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-checkout-subscriptions.js
var CheckoutSubscriptionClient = class {
  constructor(transport) {
    this.transport = transport;
    this.statusInFlight = /* @__PURE__ */ new Map();
    this.diffSubscriptions = /* @__PURE__ */ new Map();
  }
  getStatus(cwd, options) {
    const requestId = options?.requestId;
    if (!requestId) {
      const existing = this.statusInFlight.get(cwd);
      if (existing) {
        return existing;
      }
    }
    const resolvedRequestId = this.transport.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "checkout_status_request",
      cwd,
      requestId: resolvedRequestId
    });
    const responsePromise = this.transport.sendRequest({
      requestId: resolvedRequestId,
      message,
      timeout: 6e4,
      options: { skipQueue: true },
      select: (response) => {
        if (response.type !== "checkout_status_response") {
          return null;
        }
        if (response.payload.requestId !== resolvedRequestId) {
          return null;
        }
        return response.payload;
      }
    });
    if (!requestId) {
      this.statusInFlight.set(cwd, responsePromise);
      void responsePromise.finally(() => {
        if (this.statusInFlight.get(cwd) === responsePromise) {
          this.statusInFlight.delete(cwd);
        }
      }).catch(() => void 0);
    }
    return responsePromise;
  }
  async getDiff(cwd, compare, requestId) {
    const subscriptionId = `oneshot-checkout-diff:${safeRandomId()}`;
    try {
      const payload = await this.subscribe(cwd, compare, { subscriptionId, requestId });
      return {
        cwd: payload.cwd,
        files: payload.files,
        error: payload.error,
        requestId: payload.requestId
      };
    } finally {
      try {
        this.unsubscribe(subscriptionId);
      } catch {
      }
    }
  }
  async subscribe(cwd, compare, options) {
    const subscriptionId = options?.subscriptionId ?? safeRandomId();
    const normalizedCompare = normalizeCheckoutDiffCompare(compare);
    const previousSubscription = this.diffSubscriptions.get(subscriptionId) ?? null;
    this.diffSubscriptions.set(subscriptionId, { cwd, compare: normalizedCompare });
    const resolvedRequestId = this.transport.createRequestId(options?.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "subscribe_checkout_diff_request",
      subscriptionId,
      cwd,
      compare: normalizedCompare,
      requestId: resolvedRequestId
    });
    try {
      return await this.transport.sendRequest({
        requestId: resolvedRequestId,
        message,
        timeout: 6e4,
        options: { skipQueue: true },
        select: (response) => {
          if (response.type !== "subscribe_checkout_diff_response") {
            return null;
          }
          if (response.payload.requestId !== resolvedRequestId) {
            return null;
          }
          if (response.payload.subscriptionId !== subscriptionId) {
            return null;
          }
          return response.payload;
        }
      });
    } catch (error) {
      if (previousSubscription) {
        this.diffSubscriptions.set(subscriptionId, previousSubscription);
      } else {
        this.diffSubscriptions.delete(subscriptionId);
      }
      throw error;
    }
  }
  unsubscribe(subscriptionId) {
    this.diffSubscriptions.delete(subscriptionId);
    this.transport.sendMessage({
      type: "unsubscribe_checkout_diff_request",
      subscriptionId
    });
  }
  resubscribe() {
    for (const [subscriptionId, subscription] of this.diffSubscriptions) {
      const message = SessionInboundMessageSchema.parse({
        type: "subscribe_checkout_diff_request",
        subscriptionId,
        cwd: subscription.cwd,
        compare: subscription.compare,
        requestId: this.transport.createRequestId()
      });
      this.transport.sendMessage(message);
    }
  }
};
function normalizeCheckoutDiffCompare(compare) {
  if (compare.mode === "uncommitted") {
    return compare.ignoreWhitespace === true ? { mode: "uncommitted", ignoreWhitespace: true } : { mode: "uncommitted" };
  }
  const trimmedBaseRef = compare.baseRef?.trim();
  if (!trimmedBaseRef) {
    return compare.ignoreWhitespace === true ? { mode: "base", ignoreWhitespace: true } : { mode: "base" };
  }
  return compare.ignoreWhitespace === true ? { mode: "base", baseRef: trimmedBaseRef, ignoreWhitespace: true } : { mode: "base", baseRef: trimmedBaseRef };
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-config-commands.js
var ConfigCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  getDaemonConfig(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "get_daemon_config_request" },
      responseType: "get_daemon_config_response",
      timeout: 1e4
    });
  }
  getDaemonStatus(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "daemon.get_status.request" },
      responseType: "daemon.get_status.response",
      timeout: 1e4
    });
  }
  getDaemonPairingOffer(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "daemon.get_pairing_offer.request" },
      responseType: "daemon.get_pairing_offer.response",
      timeout: 1e4
    });
  }
  patchDaemonConfig(config, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "set_daemon_config_request", config },
      responseType: "set_daemon_config_response",
      timeout: 1e4
    });
  }
  readProjectConfig(repoRoot, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "read_project_config_request", repoRoot },
      responseType: "read_project_config_response",
      timeout: 1e4
    });
  }
  writeProjectConfig(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "write_project_config_request",
        repoRoot: input.repoRoot,
        config: input.config,
        expectedRevision: input.expectedRevision
      },
      responseType: "write_project_config_response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-provider-commands.js
var PROVIDER_TOOLING_RPC_TIMEOUT_MS = 198e3;
var ProviderCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  listProviderModels(provider, options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_models_request", provider, cwd: options?.cwd },
      responseType: "list_provider_models_response",
      timeout: 45e3
    });
  }
  listProviderModes(provider, options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_modes_request", provider, cwd: options?.cwd },
      responseType: "list_provider_modes_response",
      timeout: 45e3
    });
  }
  listProviderFeatures(draftConfig, options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_features_request", draftConfig },
      responseType: "list_provider_features_response",
      timeout: 45e3
    });
  }
  listAvailableProviders(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_available_providers_request" },
      responseType: "list_available_providers_response",
      timeout: 3e4
    });
  }
  getProvidersSnapshot(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "get_providers_snapshot_request", cwd: options?.cwd },
      responseType: "get_providers_snapshot_response",
      timeout: 1e4
    });
  }
  refreshProvidersSnapshot(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "refresh_providers_snapshot_request",
        cwd: options?.cwd,
        providers: options?.providers
      },
      responseType: "refresh_providers_snapshot_response",
      timeout: 6e4
    });
  }
  getProviderDiagnostic(provider, options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "provider_diagnostic_request", provider },
      responseType: "provider_diagnostic_response",
      timeout: 3e4
    });
  }
  getDiagnostics(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "diagnostics.request",
        includeLogs: options?.includeLogs,
        maxLogLines: options?.maxLogLines
      },
      responseType: "diagnostics.response",
      timeout: 3e4
    });
  }
  runProviderToolingAction(provider, action, options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "provider.tooling.run.request", provider, action },
      responseType: "provider.tooling.run.response",
      timeout: PROVIDER_TOOLING_RPC_TIMEOUT_MS
    });
  }
  listAgentPresets(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.presets.list.request" },
      responseType: "agent.presets.list.response",
      timeout: 3e4
    });
  }
  runModelGatewayMoaTest(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "model_gateway.moa.test.request",
        gatewayId: input.gatewayId,
        syntheticModel: input.syntheticModel,
        prompt: input.prompt
      },
      responseType: "model_gateway.moa.test.response",
      timeout: 12e4
    });
  }
  runModelGatewayTest(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "model_gateway.test.request",
        gatewayId: input.gatewayId,
        modelId: input.modelId,
        ...input.targetFormat ? { targetFormat: input.targetFormat } : {}
      },
      responseType: "model_gateway.test.response",
      timeout: 3e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-agent-extension-commands.js
var AgentExtensionCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  listCommands(agentId, requestIdOrOptions) {
    const requestId = typeof requestIdOrOptions === "string" ? requestIdOrOptions : requestIdOrOptions?.requestId;
    const draftConfig = typeof requestIdOrOptions === "string" ? void 0 : requestIdOrOptions?.draftConfig;
    return this.transport.request({
      requestId,
      message: {
        type: "list_commands_request",
        agentId,
        ...draftConfig ? { draftConfig } : {}
      },
      responseType: "list_commands_response",
      timeout: 3e4
    });
  }
  listAgentSkills(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.skills.list.request" },
      responseType: "agent.skills.list.response",
      timeout: 3e4
    });
  }
  patchAgentSkillPolicy(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.skills.policy.patch.request",
        scope: input.scope,
        policy: input.policy
      },
      responseType: "agent.skills.policy.patch.response",
      timeout: 3e4
    });
  }
  installAgentSkills(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.skills.install.request",
        source: input.source,
        ...input.replace !== void 0 ? { replace: input.replace } : {}
      },
      responseType: "agent.skills.install.response",
      timeout: 12e4
    });
  }
  uninstallAgentSkill(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "agent.skills.uninstall.request", sourceId: input.sourceId },
      responseType: "agent.skills.uninstall.response",
      timeout: 3e4
    });
  }
  listAgentMcpServers(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.mcp_servers.list.request" },
      responseType: "agent.mcp_servers.list.response",
      timeout: 3e4
    });
  }
  upsertAgentMcpServer(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.mcp_servers.upsert.request",
        server: input.server,
        ...input.originalName ? { originalName: input.originalName } : {}
      },
      responseType: "agent.mcp_servers.upsert.response",
      timeout: 3e4
    });
  }
  patchAgentMcpServerPolicy(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "agent.mcp_servers.policy.patch.request",
        scope: input.scope,
        policy: input.policy
      },
      responseType: "agent.mcp_servers.policy.patch.response",
      timeout: 3e4
    });
  }
  deleteAgentMcpServer(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "agent.mcp_servers.delete.request", name: input.name },
      responseType: "agent.mcp_servers.delete.response",
      timeout: 3e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-automation-commands.js
var AutomationCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  async createChatRoom(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/create",
        name: options.name,
        ...options.purpose ? { purpose: options.purpose } : {}
      },
      responseType: "chat/create/response",
      timeout: 1e4
    });
  }
  async listChatRooms(requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "chat/list"
      },
      responseType: "chat/list/response",
      timeout: 1e4
    });
  }
  async inspectChatRoom(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/inspect",
        room: options.room
      },
      responseType: "chat/inspect/response",
      timeout: 1e4
    });
  }
  async deleteChatRoom(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/delete",
        room: options.room
      },
      responseType: "chat/delete/response",
      timeout: 1e4
    });
  }
  async postChatMessage(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/post",
        room: options.room,
        body: options.body,
        ...options.authorAgentId ? { authorAgentId: options.authorAgentId } : {},
        ...options.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : {}
      },
      responseType: "chat/post/response",
      timeout: 1e4
    });
  }
  async readChatMessages(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/read",
        room: options.room,
        ...typeof options.limit === "number" ? { limit: options.limit } : {},
        ...options.since ? { since: options.since } : {},
        ...options.authorAgentId ? { authorAgentId: options.authorAgentId } : {}
      },
      responseType: "chat/read/response",
      timeout: 1e4
    });
  }
  async waitForChatMessages(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/wait",
        room: options.room,
        ...options.afterMessageId ? { afterMessageId: options.afterMessageId } : {},
        ...typeof options.timeoutMs === "number" ? { timeoutMs: options.timeoutMs } : {}
      },
      responseType: "chat/wait/response",
      timeout: (options.timeoutMs ?? 0) + 1e4
    });
  }
  async scheduleCreate(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/create",
        prompt: options.prompt,
        cadence: options.cadence,
        target: options.target,
        ...options.name ? { name: options.name } : {},
        ...typeof options.maxRuns === "number" ? { maxRuns: options.maxRuns } : {},
        ...options.expiresAt ? { expiresAt: options.expiresAt } : {},
        ...typeof options.runOnCreate === "boolean" ? { runOnCreate: options.runOnCreate } : {}
      },
      responseType: "schedule/create/response",
      timeout: 1e4
    });
  }
  async scheduleList(requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "schedule/list"
      },
      responseType: "schedule/list/response",
      timeout: 1e4
    });
  }
  async scheduleInspect(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/inspect",
        scheduleId: options.id
      },
      responseType: "schedule/inspect/response",
      timeout: 1e4
    });
  }
  async scheduleLogs(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/logs",
        scheduleId: options.id
      },
      responseType: "schedule/logs/response",
      timeout: 1e4
    });
  }
  async schedulePause(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/pause",
        scheduleId: options.id
      },
      responseType: "schedule/pause/response",
      timeout: 1e4
    });
  }
  async scheduleResume(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/resume",
        scheduleId: options.id
      },
      responseType: "schedule/resume/response",
      timeout: 1e4
    });
  }
  async scheduleDelete(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/delete",
        scheduleId: options.id
      },
      responseType: "schedule/delete/response",
      timeout: 1e4
    });
  }
  async scheduleRunOnce(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/run-once",
        scheduleId: options.id
      },
      responseType: "schedule/run-once/response",
      timeout: 1e4
    });
  }
  async scheduleUpdate(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/update",
        scheduleId: options.id,
        ...options.name !== void 0 ? { name: options.name } : {},
        ...options.prompt !== void 0 ? { prompt: options.prompt } : {},
        ...options.cadence !== void 0 ? { cadence: options.cadence } : {},
        ...options.newAgentConfig !== void 0 ? { newAgentConfig: options.newAgentConfig } : {},
        ...options.maxRuns !== void 0 ? { maxRuns: options.maxRuns } : {},
        ...options.expiresAt !== void 0 ? { expiresAt: options.expiresAt } : {}
      },
      responseType: "schedule/update/response",
      timeout: 1e4
    });
  }
  async loopRun(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "loop/run",
        prompt: options.prompt,
        cwd: options.cwd,
        ...options.provider ? { provider: options.provider } : {},
        ...options.model ? { model: options.model } : {},
        ...options.modeId ? { modeId: options.modeId } : {},
        ...options.verifierProvider ? { verifierProvider: options.verifierProvider } : {},
        ...options.verifierModel ? { verifierModel: options.verifierModel } : {},
        ...options.verifierModeId ? { verifierModeId: options.verifierModeId } : {},
        ...options.verifyPrompt ? { verifyPrompt: options.verifyPrompt } : {},
        ...options.verifyChecks && options.verifyChecks.length > 0 ? { verifyChecks: options.verifyChecks } : {},
        ...options.name ? { name: options.name } : {},
        ...typeof options.sleepMs === "number" ? { sleepMs: options.sleepMs } : {},
        ...typeof options.maxIterations === "number" ? { maxIterations: options.maxIterations } : {},
        ...typeof options.maxTimeMs === "number" ? { maxTimeMs: options.maxTimeMs } : {}
      },
      responseType: "loop/run/response",
      timeout: 15e3
    });
  }
  async loopList(requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "loop/list"
      },
      responseType: "loop/list/response",
      timeout: 1e4
    });
  }
  async loopInspect(options) {
    const normalized = typeof options === "string" ? { id: options } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? void 0 : options.requestId,
      message: {
        type: "loop/inspect",
        id: normalized.id
      },
      responseType: "loop/inspect/response",
      timeout: 1e4
    });
  }
  async loopLogs(options, afterSeq) {
    const normalized = typeof options === "string" ? { id: options, afterSeq } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? void 0 : options.requestId,
      message: {
        type: "loop/logs",
        id: normalized.id,
        ...typeof normalized.afterSeq === "number" ? { afterSeq: normalized.afterSeq } : {}
      },
      responseType: "loop/logs/response",
      timeout: 1e4
    });
  }
  async loopStop(options) {
    const normalized = typeof options === "string" ? { id: options } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? void 0 : options.requestId,
      message: {
        type: "loop/stop",
        id: normalized.id
      },
      responseType: "loop/stop/response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-cindy-commands.js
var CindyCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  // ── Goal ──────────────────────────────────────────────────────────────────
  async goalSet(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/set",
        agentId: options.agentId,
        objective: options.objective,
        ...options.limits ? { limits: options.limits } : {}
      },
      responseType: "goal/set/response",
      timeout: 1e4
    });
  }
  async goalCancel(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/cancel",
        agentId: options.agentId
      },
      responseType: "goal/cancel/response",
      timeout: 1e4
    });
  }
  async goalInspect(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "goal/inspect",
        agentId: options.agentId
      },
      responseType: "goal/inspect/response",
      timeout: 1e4
    });
  }
  async goalList(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "goal/list" },
      responseType: "goal/list/response",
      timeout: 1e4
    });
  }
  // ── Team ──────────────────────────────────────────────────────────────────
  async teamStart(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "team/start" },
      responseType: "team/start/response",
      timeout: 1e4
    });
  }
  async teamEnd(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "team/end" },
      responseType: "team/end/response",
      timeout: 1e4
    });
  }
  async teamCreateWorker(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/create-worker",
        label: options.label,
        ...options.role ? { role: options.role } : {},
        ...options.provider ? { provider: options.provider } : {},
        ...options.model ? { model: options.model } : {},
        ...options.initialTask ? { initialTask: options.initialTask } : {}
      },
      responseType: "team/create-worker/response",
      timeout: 15e3
    });
  }
  async teamListWorkers(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "team/list-workers" },
      responseType: "team/list-workers/response",
      timeout: 1e4
    });
  }
  async teamSendToWorker(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/send-to-worker",
        workerId: options.workerId,
        message: options.message
      },
      responseType: "team/send-to-worker/response",
      timeout: 1e4
    });
  }
  async teamListQueue(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/list-queue",
        workerId: options.workerId
      },
      responseType: "team/list-queue/response",
      timeout: 1e4
    });
  }
  async teamCancelMessage(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/cancel-message",
        workerId: options.workerId,
        messageId: options.messageId
      },
      responseType: "team/cancel-message/response",
      timeout: 1e4
    });
  }
  async teamArchiveWorker(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/archive-worker",
        workerId: options.workerId
      },
      responseType: "team/archive-worker/response",
      timeout: 1e4
    });
  }
  async teamSwitchFocus(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/switch-focus",
        workerId: options.workerId
      },
      responseType: "team/switch-focus/response",
      timeout: 1e4
    });
  }
  async teamWorkerStatus(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "team/worker-status",
        workerId: options.workerId
      },
      responseType: "team/worker-status/response",
      timeout: 1e4
    });
  }
  // ── Project Context ───────────────────────────────────────────────────────
  async contextBuild(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/build",
        workDir: options.workDir
      },
      responseType: "context/build/response",
      timeout: 3e4
    });
  }
  async contextInspect(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/inspect",
        workDir: options.workDir
      },
      responseType: "context/inspect/response",
      timeout: 1e4
    });
  }
  async contextInvalidate(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "context/invalidate",
        workDir: options.workDir
      },
      responseType: "context/invalidate/response",
      timeout: 1e4
    });
  }
  // ── Snapshot ──────────────────────────────────────────────────────────────
  async snapshotCreate(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/create",
        cwd: options.cwd,
        ...options.label ? { label: options.label } : {},
        ...options.agentId ? { agentId: options.agentId } : {}
      },
      responseType: "snapshot/create/response",
      timeout: 15e3
    });
  }
  async snapshotList(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/list",
        cwd: options.cwd,
        ...typeof options.limit === "number" ? { limit: options.limit } : {}
      },
      responseType: "snapshot/list/response",
      timeout: 1e4
    });
  }
  async snapshotRewind(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/rewind",
        cwd: options.cwd,
        commitHash: options.commitHash
      },
      responseType: "snapshot/rewind/response",
      timeout: 15e3
    });
  }
  async snapshotStatus(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "snapshot/status",
        cwd: options.cwd
      },
      responseType: "snapshot/status/response",
      timeout: 1e4
    });
  }
  // ── Migration ─────────────────────────────────────────────────────────────
  async migrationDetect(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "migration/detect",
        workDir: options.workDir,
        targetAgent: options.targetAgent
      },
      responseType: "migration/detect/response",
      timeout: 1e4
    });
  }
  async migrationApply(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "migration/apply",
        workDir: options.workDir,
        targetAgent: options.targetAgent
      },
      responseType: "migration/apply/response",
      timeout: 15e3
    });
  }
  // ── Learn ─────────────────────────────────────────────────────────────────
  async learnStart(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/start",
        diff: options.diff,
        files: options.files,
        ...options.context ? { context: options.context } : {}
      },
      responseType: "learn/start/response",
      timeout: 15e3
    });
  }
  async learnList(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "learn/list" },
      responseType: "learn/list/response",
      timeout: 1e4
    });
  }
  async learnInspect(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/inspect",
        runId: options.runId
      },
      responseType: "learn/inspect/response",
      timeout: 1e4
    });
  }
  async learnApply(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/apply",
        runId: options.runId,
        ...options.fingerprints ? { fingerprints: options.fingerprints } : {}
      },
      responseType: "learn/apply/response",
      timeout: 15e3
    });
  }
  async learnDiscard(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/discard",
        runId: options.runId
      },
      responseType: "learn/discard/response",
      timeout: 1e4
    });
  }
  async learnCancel(options) {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "learn/cancel",
        runId: options.runId
      },
      responseType: "learn/cancel/response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-workspace-commands.js
var DEFAULT_OPEN_PROJECT_TIMEOUT_MS = 6e4;
var WorkspaceCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  openProject(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "open_project_request", cwd },
      responseType: "open_project_response",
      timeout: DEFAULT_OPEN_PROJECT_TIMEOUT_MS
    });
  }
  startWorkspaceScript(workspaceId, scriptName, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "start_workspace_script_request", workspaceId, scriptName },
      responseType: "start_workspace_script_response",
      timeout: 1e4
    });
  }
  listAvailableEditors(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "list_available_editors_request" },
      responseType: "list_available_editors_response",
      timeout: 1e4
    });
  }
  openInEditor(path, editorId, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "open_in_editor_request", path, editorId },
      responseType: "open_in_editor_response",
      timeout: 1e4
    });
  }
  archiveWorkspace(workspaceId, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "archive_workspace_request", workspaceId },
      responseType: "archive_workspace_response",
      timeout: 1e4
    });
  }
  fetchWorkspaceSetupStatus(workspaceId, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "workspace_setup_status_request", workspaceId },
      responseType: "workspace_setup_status_response",
      timeout: 1e4
    });
  }
  async listDirectory(cwd, path, requestId) {
    const payload = await this.transport.request({
      requestId,
      message: { type: "file_explorer_request", cwd, path, mode: "list" },
      responseType: "file_explorer_response",
      timeout: 1e4
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.directory) {
      throw new Error("Directory listing unavailable.");
    }
    return payload.directory;
  }
  requestDownloadToken(cwd, path, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "file_download_token_request", cwd, path },
      responseType: "file_download_token_response",
      timeout: 1e4
    });
  }
  requestProjectIcon(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "project_icon_request", cwd },
      responseType: "project_icon_response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-query-commands.js
var QueryCommandClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  fetchAgents(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_agents_request",
        ...options?.scope ? { scope: options.scope } : {},
        ...options?.filter ? { filter: options.filter } : {},
        ...options?.sort ? { sort: options.sort } : {},
        ...options?.page ? { page: options.page } : {},
        ...options?.subscribe ? { subscribe: options.subscribe } : {}
      },
      responseType: "fetch_agents_response",
      timeout: 1e4
    });
  }
  fetchAgentHistory(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_agent_history_request",
        ...options?.filter ? { filter: options.filter } : {},
        ...options?.sort ? { sort: options.sort } : {},
        ...options?.page ? { page: options.page } : {}
      },
      responseType: "fetch_agent_history_response",
      timeout: 1e4
    });
  }
  fetchRecentProviderSessions(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_recent_provider_sessions_request",
        ...options?.cwd ? { cwd: options.cwd } : {},
        ...options?.providers ? { providers: options.providers } : {},
        ...options?.since ? { since: options.since } : {},
        ...options?.limit ? { limit: options.limit } : {}
      },
      responseType: "fetch_recent_provider_sessions_response",
      timeout: 1e4
    });
  }
  fetchUsageSummary(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "usage.summary.get.request",
        ...options?.rangeDays ? { rangeDays: options.rangeDays } : {}
      },
      responseType: "usage.summary.get.response",
      timeout: 1e4
    });
  }
  exportUsage(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "usage.export.request",
        ...options?.format ? { format: options.format } : {}
      },
      responseType: "usage.export.response",
      timeout: 1e4
    });
  }
  clearUsage(requestId) {
    return this.transport.request({
      requestId,
      message: { type: "usage.clear.request" },
      responseType: "usage.clear.response",
      timeout: 1e4
    });
  }
  fetchWorkspaces(options) {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "fetch_workspaces_request",
        ...options?.filter ? { filter: options.filter } : {},
        ...options?.sort ? { sort: options.sort } : {},
        ...options?.page ? { page: options.page } : {},
        ...options?.subscribe ? { subscribe: options.subscribe } : {}
      },
      responseType: "fetch_workspaces_response",
      timeout: 1e4
    });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-runtime-metrics.js
var DEFAULT_ROLLING_WINDOW_MS = 6e4;
var DaemonClientRuntimeMetrics = class {
  constructor(logger, context, options) {
    this.logger = logger;
    this.context = context;
    this.startedAt = Date.now();
    this.buckets = [];
    this.inboundMessageCounts = /* @__PURE__ */ new Map();
    this.inboundMessageBytes = /* @__PURE__ */ new Map();
    this.inboundMessageHandlerMs = /* @__PURE__ */ new Map();
    this.inboundAgentStreamCounts = /* @__PURE__ */ new Map();
    this.inboundAgentStreamByAgentCounts = /* @__PURE__ */ new Map();
    this.inboundBinaryFrameCounts = /* @__PURE__ */ new Map();
    this.windowMs = typeof options?.windowMs === "number" && options.windowMs > 0 ? options.windowMs : DEFAULT_ROLLING_WINDOW_MS;
  }
  recordMessage(type, bytes, handlerMs) {
    incrementCount(this.inboundMessageCounts, type, 1);
    incrementCount(this.inboundMessageBytes, type, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, type, handlerMs);
  }
  recordAgentStream(payload) {
    const { agentId, event } = payload;
    const eventType = event.type === "timeline" ? `timeline:${event.item.type}` : event.type;
    incrementCount(this.inboundAgentStreamCounts, eventType, 1);
    incrementCount(this.inboundAgentStreamByAgentCounts, agentId, 1);
  }
  recordBinaryFrame(kind, bytes, handlerMs) {
    incrementCount(this.inboundBinaryFrameCounts, kind, 1);
    incrementCount(this.inboundMessageBytes, `binary:${kind}`, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, `binary:${kind}`, handlerMs);
  }
  flush(options) {
    const now = Date.now();
    const bucket = this.consumeCurrentBucket(now);
    if (bucket) {
      this.buckets.push(bucket);
    }
    this.pruneBuckets(now);
    const aggregate = this.aggregateBuckets();
    const hasActivity = aggregate.inboundMessageCounts.size > 0 || aggregate.inboundBinaryFrameCounts.size > 0;
    if (!hasActivity && !options?.final) {
      return;
    }
    this.logger.info({
      windowMs: Math.min(this.windowMs, Math.max(0, now - this.startedAt)),
      rollingWindowMs: this.windowMs,
      bucketCount: this.buckets.length,
      final: Boolean(options?.final),
      connectionPath: this.context.connectionPath,
      serverId: this.context.serverId,
      connectionStatus: this.context.getConnectionStatus(),
      inboundMessageTypesTop: getTopCounts(aggregate.inboundMessageCounts, 20),
      inboundMessageBytesTop: getTopCounts(aggregate.inboundMessageBytes, 20),
      inboundAgentStreamTypesTop: getTopCounts(aggregate.inboundAgentStreamCounts, 20),
      inboundAgentStreamAgentsTop: getTopCounts(aggregate.inboundAgentStreamByAgentCounts, 20),
      inboundBinaryFrameTypesTop: getTopCounts(aggregate.inboundBinaryFrameCounts, 12),
      handlerTimingTop: getTopHandlerTimings(aggregate.inboundMessageHandlerMs, 20)
    }, "ws_runtime_metrics_client");
  }
  consumeCurrentBucket(now) {
    const hasActivity = this.inboundMessageCounts.size > 0 || this.inboundBinaryFrameCounts.size > 0;
    if (!hasActivity) {
      return null;
    }
    const bucket = {
      inboundMessageCounts: new Map(this.inboundMessageCounts),
      inboundMessageBytes: new Map(this.inboundMessageBytes),
      inboundMessageHandlerMs: cloneHandlerTimingMap(this.inboundMessageHandlerMs),
      inboundAgentStreamCounts: new Map(this.inboundAgentStreamCounts),
      inboundAgentStreamByAgentCounts: new Map(this.inboundAgentStreamByAgentCounts),
      inboundBinaryFrameCounts: new Map(this.inboundBinaryFrameCounts),
      endedAt: now
    };
    this.inboundMessageCounts.clear();
    this.inboundMessageBytes.clear();
    this.inboundMessageHandlerMs.clear();
    this.inboundAgentStreamCounts.clear();
    this.inboundAgentStreamByAgentCounts.clear();
    this.inboundBinaryFrameCounts.clear();
    return bucket;
  }
  pruneBuckets(now) {
    const cutoff = now - this.windowMs;
    while (this.buckets.length > 0 && this.buckets[0].endedAt < cutoff) {
      this.buckets.shift();
    }
  }
  aggregateBuckets() {
    const aggregate = createEmptyBucket(Date.now());
    for (const bucket of this.buckets) {
      mergeCountMap(aggregate.inboundMessageCounts, bucket.inboundMessageCounts);
      mergeCountMap(aggregate.inboundMessageBytes, bucket.inboundMessageBytes);
      mergeHandlerTimingMap(aggregate.inboundMessageHandlerMs, bucket.inboundMessageHandlerMs);
      mergeCountMap(aggregate.inboundAgentStreamCounts, bucket.inboundAgentStreamCounts);
      mergeCountMap(aggregate.inboundAgentStreamByAgentCounts, bucket.inboundAgentStreamByAgentCounts);
      mergeCountMap(aggregate.inboundBinaryFrameCounts, bucket.inboundBinaryFrameCounts);
    }
    return aggregate;
  }
};
function createEmptyBucket(endedAt) {
  return {
    inboundMessageCounts: /* @__PURE__ */ new Map(),
    inboundMessageBytes: /* @__PURE__ */ new Map(),
    inboundMessageHandlerMs: /* @__PURE__ */ new Map(),
    inboundAgentStreamCounts: /* @__PURE__ */ new Map(),
    inboundAgentStreamByAgentCounts: /* @__PURE__ */ new Map(),
    inboundBinaryFrameCounts: /* @__PURE__ */ new Map(),
    endedAt
  };
}
function incrementCount(map, key, amount) {
  map.set(key, (map.get(key) ?? 0) + amount);
}
function incrementHandlerTiming(map, key, handlerMs) {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += handlerMs;
    existing.maxMs = Math.max(existing.maxMs, handlerMs);
    return;
  }
  map.set(key, {
    count: 1,
    totalMs: handlerMs,
    maxMs: handlerMs
  });
}
function cloneHandlerTimingMap(map) {
  return new Map([...map.entries()].map(([key, value]) => [
    key,
    { count: value.count, totalMs: value.totalMs, maxMs: value.maxMs }
  ]));
}
function mergeCountMap(target, source) {
  for (const [key, value] of source) {
    incrementCount(target, key, value);
  }
}
function mergeHandlerTimingMap(target, source) {
  for (const [key, value] of source) {
    const existing = target.get(key);
    if (existing) {
      existing.count += value.count;
      existing.totalMs += value.totalMs;
      existing.maxMs = Math.max(existing.maxMs, value.maxMs);
      continue;
    }
    target.set(key, {
      count: value.count,
      totalMs: value.totalMs,
      maxMs: value.maxMs
    });
  }
}
function getTopCounts(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
function getTopHandlerTimings(map, limit) {
  const rows = [...map.entries()].map(([type, value]) => ({
    type,
    count: value.count,
    totalMs: Math.round(value.totalMs),
    avgMs: Math.round(value.totalMs / value.count * 100) / 100,
    maxMs: Math.round(value.maxMs * 100) / 100
  }));
  rows.sort((a, b) => b.totalMs - a.totalMs);
  return rows.slice(0, limit);
}

// vendor/chisacode-remote/packages/protocol/dist/binary-frames/terminal.js
var TerminalStreamResizeSchema = external_exports.object({
  rows: external_exports.number().int().positive(),
  cols: external_exports.number().int().positive()
}).strict();
var TerminalStreamOpcode = {
  Output: 1,
  Input: 2,
  Resize: 3,
  Snapshot: 4,
  Restore: 5
};
function asUint8Array(data) {
  if (typeof data === "string") {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(data);
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(data, "utf8"));
    }
    const out = new Uint8Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
      out[index] = data.charCodeAt(index) & 255;
    }
    return out;
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
function isTerminalStreamOpcode(value) {
  return value === TerminalStreamOpcode.Output || value === TerminalStreamOpcode.Input || value === TerminalStreamOpcode.Resize || value === TerminalStreamOpcode.Snapshot || value === TerminalStreamOpcode.Restore;
}
function encodeTerminalStreamFrame(input) {
  const payload = asUint8Array(input.payload ?? new Uint8Array(0)) ?? new Uint8Array(0);
  const bytes = new Uint8Array(2 + payload.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = input.slot & 255;
  bytes.set(payload, 2);
  return bytes;
}
function decodeTerminalStreamFrame(bytes) {
  if (bytes.byteLength < 2) {
    return null;
  }
  const opcode = bytes[0];
  if (!isTerminalStreamOpcode(opcode)) {
    return null;
  }
  return {
    opcode,
    slot: bytes[1],
    payload: bytes.subarray(2)
  };
}
function decodeTerminalSnapshotPayload(bytes) {
  const parsed = decodeJsonPayload(bytes);
  const result = TerminalStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
function encodeTerminalResizePayload(input) {
  return encodeJsonPayload(input);
}
function encodeJsonPayload(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}
function decodeJsonPayload(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// vendor/chisacode-remote/packages/protocol/dist/binary-frames/file-transfer.js
var MAX_FILE_TRANSFER_BYTES = 64 * 1024 * 1024;
var FileTransferOpcode = {
  FileBegin: 16,
  FileChunk: 17,
  FileEnd: 18
};
var FileBeginMetadataSchema = external_exports.object({
  mime: external_exports.string().min(1),
  size: external_exports.number().int().safe().nonnegative(),
  encoding: external_exports.enum(["utf-8", "binary"]),
  modifiedAt: external_exports.string()
}).strict();
function decodeFileTransferFrame(bytes) {
  if (bytes.byteLength < 2) {
    return null;
  }
  const opcode = bytes[0];
  if (!isFileTransferOpcode(opcode)) {
    return null;
  }
  const requestIdLength = bytes[1];
  if (requestIdLength === 0 || requestIdLength > bytes.byteLength - 2) {
    return null;
  }
  const requestId = decodeRequestId(bytes.subarray(2, 2 + requestIdLength));
  const body = bytes.subarray(2 + requestIdLength);
  if (opcode === FileTransferOpcode.FileBegin) {
    if (body.byteLength < 2) {
      return null;
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const metadataLength = view.getUint16(0);
    if (metadataLength !== body.byteLength - 2) {
      return null;
    }
    const metadataBytes = body.subarray(2);
    const result = FileBeginMetadataSchema.safeParse(decodeJsonPayload2(metadataBytes));
    return result.success ? { opcode, requestId, metadata: result.data, payload: new Uint8Array() } : null;
  }
  if (opcode === FileTransferOpcode.FileChunk) {
    return { opcode, requestId, payload: body };
  }
  if (body.byteLength !== 0) {
    return null;
  }
  return { opcode, requestId, payload: new Uint8Array() };
}
function isFileTransferOpcode(value) {
  return value === FileTransferOpcode.FileBegin || value === FileTransferOpcode.FileChunk || value === FileTransferOpcode.FileEnd;
}
function decodeRequestId(bytes) {
  return new TextDecoder().decode(bytes);
}
function decodeJsonPayload2(bytes) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-file-transfer.js
var BinaryFileTransferManager = class {
  constructor(options) {
    this.pendingReads = /* @__PURE__ */ new Map();
    this.activeTransfers = /* @__PURE__ */ new Map();
    this.completedReads = /* @__PURE__ */ new Map();
    this.idleTimers = /* @__PURE__ */ new Map();
    this.idleTimeoutMs = options?.idleTimeoutMs ?? 6e4;
    this.onIdleTimeout = options?.onIdleTimeout;
  }
  startRead(requestId, cwd, path) {
    this.pendingReads.set(requestId, { cwd, path });
  }
  takeCompletedRead(requestId) {
    const result = this.completedReads.get(requestId) ?? null;
    this.completedReads.delete(requestId);
    return result;
  }
  cleanupRead(requestId) {
    this.clearIdleTimer(requestId);
    this.pendingReads.delete(requestId);
    this.activeTransfers.delete(requestId);
    this.completedReads.delete(requestId);
  }
  clearActiveTransfers() {
    this.activeTransfers.clear();
  }
  handleFrame(frame) {
    if (frame.opcode === FileTransferOpcode.FileBegin) {
      const pending = this.pendingReads.get(frame.requestId);
      if (!pending) {
        return null;
      }
      if (this.activeTransfers.has(frame.requestId)) {
        return this.fail(frame.requestId, "Duplicate file transfer start");
      }
      if (frame.metadata.size > MAX_FILE_TRANSFER_BYTES) {
        return this.fail(frame.requestId, "File transfer exceeds maximum size");
      }
      this.activeTransfers.set(frame.requestId, {
        ...pending,
        mime: frame.metadata.mime,
        size: frame.metadata.size,
        encoding: frame.metadata.encoding,
        modifiedAt: frame.metadata.modifiedAt,
        receivedBytes: 0,
        chunks: []
      });
      this.armIdleTimer(frame.requestId);
      return null;
    }
    const transfer = this.activeTransfers.get(frame.requestId);
    if (!transfer) {
      if (this.pendingReads.has(frame.requestId) && !this.completedReads.has(frame.requestId)) {
        return this.fail(frame.requestId, "File transfer frame received before start");
      }
      return null;
    }
    if (frame.opcode === FileTransferOpcode.FileChunk) {
      const nextReceivedBytes = transfer.receivedBytes + frame.payload.byteLength;
      if (!Number.isSafeInteger(nextReceivedBytes) || nextReceivedBytes > MAX_FILE_TRANSFER_BYTES) {
        return this.fail(frame.requestId, "File transfer exceeds maximum size");
      }
      if (nextReceivedBytes > transfer.size) {
        return this.fail(frame.requestId, "File transfer exceeds declared size");
      }
      transfer.receivedBytes = nextReceivedBytes;
      transfer.chunks.push(new Uint8Array(frame.payload));
      this.armIdleTimer(frame.requestId);
      return null;
    }
    if (transfer.receivedBytes !== transfer.size) {
      return this.fail(frame.requestId, `File transfer expected ${transfer.size} bytes but received ${transfer.receivedBytes}`);
    }
    this.clearIdleTimer(frame.requestId);
    this.activeTransfers.delete(frame.requestId);
    this.completedReads.set(frame.requestId, {
      bytes: concatByteChunks(transfer.chunks, transfer.size),
      mime: transfer.mime,
      size: transfer.size,
      path: transfer.path,
      kind: binaryFileKind(transfer.mime, transfer.encoding),
      modifiedAt: transfer.modifiedAt
    });
    return {
      cwd: transfer.cwd,
      path: transfer.path,
      requestId: frame.requestId,
      error: null
    };
  }
  armIdleTimer(requestId) {
    this.clearIdleTimer(requestId);
    const handle = setTimeout(() => {
      this.idleTimers.delete(requestId);
      this.onIdleTimeout?.(requestId);
      this.fail(requestId, "File transfer idle timeout");
    }, this.idleTimeoutMs);
    this.idleTimers.set(requestId, handle);
  }
  clearIdleTimer(requestId) {
    const handle = this.idleTimers.get(requestId);
    if (handle) {
      clearTimeout(handle);
      this.idleTimers.delete(requestId);
    }
  }
  fail(requestId, error) {
    const pending = this.pendingReads.get(requestId);
    this.clearIdleTimer(requestId);
    this.activeTransfers.delete(requestId);
    if (!pending) {
      return null;
    }
    return { ...pending, requestId, error };
  }
};
function legacyExplorerFileToBytes(file) {
  let bytes;
  if (file.encoding === "base64" && file.content) {
    bytes = decodeBase64ToBytes(file.content);
  } else if (file.encoding === "utf-8" && file.content) {
    bytes = new TextEncoder().encode(file.content);
  } else {
    bytes = new Uint8Array();
  }
  return {
    bytes,
    mime: file.mimeType ?? "application/octet-stream",
    size: file.size,
    path: file.path,
    kind: file.kind,
    modifiedAt: file.modifiedAt
  };
}
function decodeBase64ToBytes(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
function binaryFileKind(mime, encoding) {
  if (mime.startsWith("image/")) {
    return "image";
  }
  if (encoding === "utf-8" || mime.startsWith("text/") || mime === "application/json") {
    return "text";
  }
  return "binary";
}
function concatByteChunks(chunks, size) {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// vendor/chisacode-remote/packages/client/dist/terminal-stream-router.js
var TerminalStreamRouter = class {
  constructor() {
    this.terminalSlots = /* @__PURE__ */ new Map();
    this.slotTerminals = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Set();
  }
  onEvent(handler) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
  setSlot(terminalId, slot) {
    const existingTerminalId = this.slotTerminals.get(slot);
    if (existingTerminalId && existingTerminalId !== terminalId) {
      this.terminalSlots.delete(existingTerminalId);
    }
    const existingSlot = this.terminalSlots.get(terminalId);
    if (typeof existingSlot === "number" && existingSlot !== slot) {
      this.slotTerminals.delete(existingSlot);
    }
    this.terminalSlots.set(terminalId, slot);
    this.slotTerminals.set(slot, terminalId);
  }
  removeTerminal(terminalId) {
    const slot = this.terminalSlots.get(terminalId);
    if (typeof slot !== "number") {
      return;
    }
    this.terminalSlots.delete(terminalId);
    if (this.slotTerminals.get(slot) === terminalId) {
      this.slotTerminals.delete(slot);
    }
  }
  clearSlots() {
    this.terminalSlots.clear();
    this.slotTerminals.clear();
  }
  encodeInput(terminalId, message) {
    const slot = this.terminalSlots.get(terminalId);
    if (typeof slot !== "number") {
      return null;
    }
    if (message.type === "input") {
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Input,
        slot,
        payload: message.data
      });
    }
    if (message.type === "resize") {
      return encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Resize,
        slot,
        payload: encodeTerminalResizePayload({
          rows: message.rows,
          cols: message.cols
        })
      });
    }
    return null;
  }
  handleFrame(frame) {
    const terminalId = this.slotTerminals.get(frame.slot);
    if (!terminalId) {
      return;
    }
    if (frame.opcode === TerminalStreamOpcode.Output) {
      this.emit({
        terminalId,
        type: "output",
        data: frame.payload
      });
      return;
    }
    if (frame.opcode === TerminalStreamOpcode.Restore) {
      this.emit({
        terminalId,
        type: "restore",
        data: frame.payload
      });
      return;
    }
    if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      const state = decodeTerminalSnapshotPayload(frame.payload);
      if (!state) {
        return;
      }
      this.emit({
        terminalId,
        type: "snapshot",
        state
      });
    }
  }
  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-terminal-client.js
var TerminalClient = class {
  constructor(transport) {
    this.transport = transport;
    this.directorySubscriptions = /* @__PURE__ */ new Set();
    this.streams = new TerminalStreamRouter();
    this.streamSubscriptionIntents = /* @__PURE__ */ new Map();
    this.reconnectGeneration = 0;
  }
  subscribeDirectories(input) {
    this.directorySubscriptions.add(input.cwd);
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.sendMessage({
      type: "subscribe_terminals_request",
      cwd: input.cwd
    });
  }
  unsubscribeDirectories(input) {
    this.directorySubscriptions.delete(input.cwd);
    if (!this.transport.isConnected()) {
      return;
    }
    this.transport.sendMessage({
      type: "unsubscribe_terminals_request",
      cwd: input.cwd
    });
  }
  resubscribeDirectories() {
    if (!this.transport.isConnected()) {
      return;
    }
    for (const cwd of this.directorySubscriptions) {
      this.transport.sendMessage({
        type: "subscribe_terminals_request",
        cwd
      });
    }
  }
  /**
   * Re-subscribe intentional terminal streams after reconnect.
   * Failures are isolated per terminal and do not block directory resubscribe.
   */
  async resubscribeStreams() {
    if (!this.transport.isConnected()) {
      return;
    }
    this.reconnectGeneration += 1;
    const generation = this.reconnectGeneration;
    const intents = [...this.streamSubscriptionIntents.entries()];
    for (const [terminalId, intent] of intents) {
      if (generation !== this.reconnectGeneration) {
        return;
      }
      if (!this.streamSubscriptionIntents.has(terminalId)) {
        continue;
      }
      try {
        const payload = await this.transport.request({
          message: {
            type: "subscribe_terminal_request",
            terminalId,
            ...intent.restore ? { restore: intent.restore } : {}
          },
          responseType: "subscribe_terminal_response",
          timeout: 1e4
        });
        if (generation !== this.reconnectGeneration) {
          return;
        }
        if (payload.error === null) {
          this.streams.setSlot(terminalId, payload.slot);
          const current = this.streamSubscriptionIntents.get(terminalId);
          if (current) {
            current.generation = generation;
          }
        }
      } catch {
      }
    }
  }
  listTerminals(cwd, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "list_terminals_request",
        ...cwd === void 0 ? {} : { cwd }
      },
      responseType: "list_terminals_response",
      timeout: 1e4
    });
  }
  createTerminal(cwd, name, requestId, options) {
    return this.transport.request({
      requestId,
      message: {
        type: "create_terminal_request",
        cwd,
        name,
        agentId: options?.agentId,
        command: options?.command,
        args: options?.args
      },
      responseType: "create_terminal_response",
      timeout: 1e4
    });
  }
  renameTerminal(input) {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "terminal.rename.request",
        terminalId: input.terminalId,
        title: input.title
      },
      responseType: "terminal.rename.response",
      timeout: 1e4
    });
  }
  async subscribeTerminal(terminalId, optionsOrRequestId) {
    const restore = typeof optionsOrRequestId === "object" ? optionsOrRequestId.restore : void 0;
    const requestId = typeof optionsOrRequestId === "object" ? optionsOrRequestId.requestId : optionsOrRequestId;
    const payload = await this.transport.request({
      requestId,
      message: {
        type: "subscribe_terminal_request",
        terminalId,
        ...restore ? { restore } : {}
      },
      responseType: "subscribe_terminal_response",
      timeout: 1e4
    });
    if (payload.error === null) {
      this.streams.setSlot(terminalId, payload.slot);
      this.streamSubscriptionIntents.set(terminalId, {
        restore,
        generation: this.reconnectGeneration
      });
    }
    return payload;
  }
  unsubscribeTerminal(terminalId) {
    this.streamSubscriptionIntents.delete(terminalId);
    this.streams.removeTerminal(terminalId);
    this.transport.sendMessage({
      type: "unsubscribe_terminal_request",
      terminalId
    });
  }
  sendInput(terminalId, message) {
    const frame = this.streams.encodeInput(terminalId, message);
    if (frame) {
      this.transport.sendBinaryFrame(frame);
      return;
    }
    this.transport.sendMessage({
      type: "terminal_input",
      terminalId,
      message
    });
  }
  killTerminal(terminalId, requestId) {
    return this.transport.request({
      requestId,
      message: { type: "kill_terminal_request", terminalId },
      responseType: "kill_terminal_response",
      timeout: 1e4
    });
  }
  captureTerminal(terminalId, options, requestId) {
    return this.transport.request({
      requestId,
      message: {
        type: "capture_terminal_request",
        terminalId,
        ...options?.start === void 0 ? {} : { start: options.start },
        ...options?.end === void 0 ? {} : { end: options.end },
        ...options?.stripAnsi === void 0 ? {} : { stripAnsi: options.stripAnsi }
      },
      responseType: "capture_terminal_response",
      timeout: 1e4
    });
  }
  onStreamEvent(handler) {
    return this.streams.onEvent(handler);
  }
  waitForStreamEvent(predicate, timeout = 5e3) {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timeout waiting for terminal stream event (${timeout}ms)`));
      }, timeout);
      const unsubscribe = this.onStreamEvent((event) => {
        if (!predicate(event)) {
          return;
        }
        clearTimeout(timeoutHandle);
        unsubscribe();
        resolve(event);
      });
    });
  }
  handleFrame(frame) {
    this.streams.handleFrame(frame);
  }
  handleStreamExit(terminalId) {
    this.streamSubscriptionIntents.delete(terminalId);
    this.streams.removeTerminal(terminalId);
  }
  clearStreamSlots() {
    this.streams.clearSlots();
  }
  clearAllSubscriptions() {
    this.streamSubscriptionIntents.clear();
    this.streams.clearSlots();
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-voice-client.js
var DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS = 15e3;
var DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS = 5 * 60 * 1e3;
var DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS = 5e3;
function isWaiterTimeoutError(error) {
  return error instanceof Error && error.message.startsWith("Timeout waiting for message");
}
var VoiceClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  async setVoiceMode(enabled, agentId) {
    const response = await this.transport.request({
      message: {
        type: "set_voice_mode",
        enabled,
        ...agentId ? { agentId } : {}
      },
      responseType: "set_voice_mode_response",
      timeout: 1e4
    });
    if (!response.accepted) {
      const codeSuffix = typeof response.reasonCode === "string" && response.reasonCode.trim().length > 0 ? ` (${response.reasonCode})` : "";
      throw new Error((response.error ?? "Failed to set voice mode") + codeSuffix);
    }
    return response;
  }
  async sendVoiceAudioChunk(audio, format, isLast = false) {
    this.transport.sendMessage({ type: "voice_audio_chunk", audio, format, isLast });
  }
  async startDictationStream(dictationId, format) {
    const ack = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_ack") {
        return null;
      }
      if (message.payload.dictationId !== dictationId || message.payload.ackSeq !== -1) {
        return null;
      }
      return message.payload;
    }, 3e4);
    const ackPromise = ack.promise.then(() => void 0);
    const streamError = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_error") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 3e4);
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });
    const cleanupError = new Error("Cancelled dictation start waiter");
    try {
      this.transport.sendStrictMessage({ type: "dictation_stream_start", dictationId, format });
      await Promise.race([ackPromise, errorPromise]);
    } finally {
      ack.cancel(cleanupError);
      streamError.cancel(cleanupError);
      void ackPromise.catch(() => void 0);
      void errorPromise.catch(() => void 0);
    }
  }
  sendDictationStreamChunk(dictationId, seq, audio, format) {
    this.transport.sendStrictMessage({
      type: "dictation_stream_chunk",
      dictationId,
      seq,
      audio,
      format
    });
  }
  async finishDictationStream(dictationId, finalSeq) {
    const final = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_final") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 0);
    const streamError = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_error") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 0);
    const finishAccepted = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_finish_accepted") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS);
    const finalPromise = final.promise;
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });
    const finishAcceptedPromise = finishAccepted.promise;
    const finalOutcomePromise = finalPromise.then((payload) => ({
      kind: "final",
      payload
    }));
    const errorOutcomePromise = errorPromise.then(() => ({
      kind: "error",
      error: new Error("Unexpected dictation stream error state")
    }), (error) => ({
      kind: "error",
      error: error instanceof Error ? error : new Error(String(error))
    }));
    const finishAcceptedOutcomePromise = finishAcceptedPromise.then((payload) => ({ kind: "accepted", payload }), (error) => {
      if (isWaiterTimeoutError(error)) {
        return { kind: "accepted_timeout" };
      }
      return {
        kind: "accepted_error",
        error: error instanceof Error ? error : new Error(String(error))
      };
    });
    const waitForFinalResult = async (timeoutMs) => {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        const outcome2 = await Promise.race([finalOutcomePromise, errorOutcomePromise]);
        if (outcome2.kind === "error") {
          throw outcome2.error;
        }
        return outcome2.payload;
      }
      let timeoutHandle = null;
      const timeoutPromise = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      });
      const outcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        timeoutPromise
      ]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (outcome.kind === "timeout") {
        throw new Error(`Timeout waiting for dictation finalization (${timeoutMs}ms)`);
      }
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      return outcome.payload;
    };
    const cleanupError = new Error("Cancelled dictation finish waiter");
    try {
      this.transport.sendStrictMessage({ type: "dictation_stream_finish", dictationId, finalSeq });
      const firstOutcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        finishAcceptedOutcomePromise
      ]);
      if (firstOutcome.kind === "final") {
        return firstOutcome.payload;
      }
      if (firstOutcome.kind === "error") {
        throw firstOutcome.error;
      }
      if (firstOutcome.kind === "accepted") {
        return await waitForFinalResult(firstOutcome.payload.timeoutMs + DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS);
      }
      return await waitForFinalResult(DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS);
    } finally {
      final.cancel(cleanupError);
      streamError.cancel(cleanupError);
      finishAccepted.cancel(cleanupError);
      void finalPromise.catch(() => void 0);
      void errorPromise.catch(() => void 0);
      void finishAcceptedPromise.catch(() => void 0);
    }
  }
  cancelDictationStream(dictationId) {
    this.transport.sendStrictMessage({ type: "dictation_stream_cancel", dictationId });
  }
  async abortRequest() {
    this.transport.sendMessage({ type: "abort_request" });
  }
  async audioPlayed(id) {
    this.transport.sendMessage({ type: "audio_played", id });
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-agent-lifecycle.js
var AgentLifecycleClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  async fetchAgent(agentId, requestId) {
    const payload = await this.transport.request({
      requestId,
      message: { type: "fetch_agent_request", agentId },
      responseType: "fetch_agent_response",
      timeout: 1e4
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.agent) {
      return null;
    }
    return { agent: payload.agent, project: payload.project ?? null };
  }
  async createAgent(options) {
    const requestId = this.transport.createRequestId(options.requestId);
    const config = resolveAgentConfig(options);
    const message = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId,
      config,
      ...options.env ? { env: options.env } : {},
      ...options.workspaceId !== void 0 ? { workspaceId: options.workspaceId } : {},
      ...options.initialPrompt ? { initialPrompt: options.initialPrompt } : {},
      ...options.clientMessageId ? { clientMessageId: options.clientMessageId } : {},
      ...options.agentId ? { agentId: options.agentId } : {},
      ...options.outputSchema ? { outputSchema: options.outputSchema } : {},
      ...options.images && options.images.length > 0 ? { images: options.images } : {},
      ...options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {},
      ...options.git ? { git: options.git } : {},
      ...options.worktree ? { worktree: options.worktree } : {},
      ...options.autoArchive !== void 0 ? { autoArchive: options.autoArchive } : {},
      ...options.worktreeName ? { worktreeName: options.worktreeName } : {},
      ...options.labels && Object.keys(options.labels).length > 0 ? { labels: options.labels } : {}
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 6e4,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const created = AgentCreatedStatusPayloadSchema.safeParse(response.payload);
        if (created.success && created.data.requestId === requestId) {
          return created.data;
        }
        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(response.payload);
        if (failed.success && failed.data.requestId === requestId) {
          return failed.data;
        }
        return null;
      }
    });
    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }
    return status.project ? { ...status.agent, project: status.project } : status.agent;
  }
  async deleteAgent(agentId) {
    await this.transport.request({
      message: { type: "delete_agent_request", agentId },
      responseType: "agent_deleted",
      timeout: 1e4
    });
  }
  async archiveAgent(agentId) {
    const result = await this.transport.request({
      message: { type: "archive_agent_request", agentId },
      responseType: "agent_archived",
      // Archiving closes a live agent (cancels in-flight runs, persists the
      // snapshot, cascades to subagents); under load the daemon can take
      // 10–12s per archive. 10s caused spurious client timeouts that rolled
      // back the optimistic removal and made already-archived sessions
      // reappear. 30s keeps the UI honest without masking genuine failures.
      timeout: 3e4
    });
    return { archivedAt: result.archivedAt };
  }
  async updateAgent(agentId, updates) {
    const payload = await this.transport.request({
      message: {
        type: "update_agent_request",
        agentId,
        ...updates.name !== void 0 ? { name: updates.name } : {},
        ...updates.labels && Object.keys(updates.labels).length > 0 ? { labels: updates.labels } : {},
        ...updates.regenerateTitle === true ? { regenerateTitle: true } : {}
      },
      responseType: "update_agent_response",
      timeout: 3e4
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "updateAgent rejected");
    }
  }
  async renameProject(projectId, customName, requestId) {
    const payload = await this.transport.request({
      requestId,
      message: { type: "project.rename.request", projectId, customName },
      responseType: "project.rename.response",
      timeout: 1e4
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "renameProject rejected");
    }
    return { customName: payload.customName };
  }
  async resumeAgent(handle, overrides) {
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "resume_agent_request",
      requestId,
      handle,
      ...overrides ? { overrides } : {}
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 15e3,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(response.payload);
        return resumed.success && resumed.data.requestId === requestId ? resumed.data : null;
      }
    });
    return status.agent;
  }
  async importAgent(input) {
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "import_agent_request",
      requestId,
      ..."providerId" in input ? { providerId: input.providerId, providerHandleId: input.providerHandleId } : { provider: input.provider, sessionId: input.sessionId },
      ...input.cwd ? { cwd: input.cwd } : {},
      ...input.labels && Object.keys(input.labels).length > 0 ? { labels: input.labels } : {}
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 15e3,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(response.payload);
        if (resumed.success && resumed.data.requestId === requestId) {
          return resumed.data;
        }
        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(response.payload);
        return failed.success && failed.data.requestId === requestId ? failed.data : null;
      }
    });
    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }
    return status.agent;
  }
  async refreshAgent(agentId, requestId) {
    const resolvedRequestId = this.transport.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "refresh_agent_request",
      agentId,
      requestId: resolvedRequestId
    });
    return this.transport.requestStatus({
      requestId: resolvedRequestId,
      message,
      timeout: 15e3,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const refreshed = AgentRefreshedStatusPayloadSchema.safeParse(response.payload);
        return refreshed.success && refreshed.data.requestId === resolvedRequestId ? refreshed.data : null;
      }
    });
  }
  async rewindAgent(agentId, messageId, mode) {
    const payload = await this.transport.request({
      message: { type: "agent.rewind.request", agentId, messageId, mode },
      responseType: "agent.rewind.response",
      timeout: 15e3
    });
    if (!payload.ok) {
      throw new Error(payload.error ?? "Agent rewind failed");
    }
    return payload;
  }
  async cancelAgent(agentId) {
    await this.transport.request({
      message: { type: "cancel_agent_request", agentId },
      responseType: "cancel_agent_response",
      timeout: 15e3
    });
  }
  async setAgentMode(agentId, modeId) {
    const payload = await this.transport.request({
      message: { type: "set_agent_mode_request", agentId, modeId },
      responseType: "set_agent_mode_response",
      timeout: 15e3
    });
    assertAccepted(payload, "setAgentMode rejected");
  }
  async setAgentModel(agentId, modelId, runtimeProvider) {
    const payload = await this.transport.request({
      message: {
        type: "set_agent_model_request",
        agentId,
        modelId,
        ...runtimeProvider ? { runtimeProvider } : {}
      },
      responseType: "set_agent_model_response",
      timeout: 15e3
    });
    assertAccepted(payload, "setAgentModel rejected");
  }
  async setAgentFeature(agentId, featureId, value) {
    const payload = await this.transport.request({
      message: { type: "set_agent_feature_request", agentId, featureId, value },
      responseType: "set_agent_feature_response",
      timeout: 15e3
    });
    assertAccepted(payload, "setAgentFeature rejected");
  }
  async setAgentThinkingOption(agentId, thinkingOptionId) {
    const payload = await this.transport.request({
      message: { type: "set_agent_thinking_request", agentId, thinkingOptionId },
      responseType: "set_agent_thinking_response",
      timeout: 15e3
    });
    assertAccepted(payload, "setAgentThinkingOption rejected");
  }
};
function assertAccepted(payload, fallback) {
  if (!payload.accepted) {
    throw new Error(payload.error ?? fallback);
  }
}
function resolveAgentConfig(options) {
  const { config, provider, cwd, env: _env, workspaceId: _workspaceId, initialPrompt: _initialPrompt, images: _images, git: _git, worktreeName: _worktreeName, requestId: _requestId, labels: _labels, ...overrides } = options;
  const baseConfig = {
    ...provider ? { provider } : {},
    ...cwd ? { cwd } : {},
    ...overrides
  };
  const merged = config ? { ...baseConfig, ...config } : baseConfig;
  if (!merged.provider || !merged.cwd) {
    throw new Error("createAgent requires provider and cwd");
  }
  return { ...merged, provider: merged.provider, cwd: merged.cwd };
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-rpc-error.js
var DaemonRpcError = class extends Error {
  constructor(params) {
    const parts = [params.error];
    if (params.requestType)
      parts.push(`requestType=${params.requestType}`);
    if (params.code)
      parts.push(`code=${params.code}`);
    super(parts.join(" "));
    this.name = "DaemonRpcError";
    this.requestId = params.requestId;
    this.requestType = params.requestType;
    this.code = params.code;
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-agent-interaction.js
var DEFAULT_FETCH_AGENT_TIMELINE_TIMEOUT_MS = 6e4;
var AgentInteractionClient = class {
  constructor(transport) {
    this.transport = transport;
  }
  async fetchAgentTimeline(agentId, options = {}) {
    const requestId = this.transport.createRequestId(options.requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "fetch_agent_timeline_request",
      agentId,
      requestId,
      ...options.direction ? { direction: options.direction } : {},
      ...options.cursor ? { cursor: options.cursor } : {},
      ...typeof options.limit === "number" ? { limit: options.limit } : {},
      ...options.projection ? { projection: options.projection } : {}
    });
    const payload = await this.transport.request({
      requestId,
      message,
      responseType: "fetch_agent_timeline_response",
      timeout: DEFAULT_FETCH_AGENT_TIMELINE_TIMEOUT_MS
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload;
  }
  async sendAgentMessage(agentId, text, options) {
    const requestId = this.transport.createRequestId();
    const messageId = options?.messageId ?? safeRandomId();
    const message = SessionInboundMessageSchema.parse({
      type: "send_agent_message_request",
      requestId,
      agentId,
      text,
      ...messageId ? { messageId } : {},
      ...options?.images ? { images: options.images } : {},
      ...options?.attachments ? { attachments: options.attachments } : {}
    });
    const response = await this.transport.request({
      requestId,
      message,
      responseType: "send_agent_message_response",
      timeout: 15e3
    });
    if (!response.accepted) {
      throw new Error(response.error ?? "sendAgentMessage rejected");
    }
    return { pendingRun: response.pendingRun };
  }
  /**
   * Sends a generative UI user-interaction callback to the server.
   * @param agentId Target agent session ID
   * @param instanceId Generative UI component instance ID
   * @param action Action name as defined in the component's actions
   * @param payload Action-specific payload
   * @param options Optional timeout configuration
   * @throws {DaemonRpcError} If the server rejects the action or does not support it
   */
  async sendGenerativeUiAction(agentId, instanceId, action, payload, options) {
    if (!this.transport.supportsGenerativeUi()) {
      throw new DaemonRpcError({
        requestId: "",
        error: "generative UI actions are not supported by this server",
        requestType: "generative_ui.action.request"
      });
    }
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "generative_ui.action.request",
      requestId,
      agentId,
      instanceId,
      action,
      payload,
      timestamp: Date.now()
    });
    const response = await this.transport.request({
      requestId,
      message,
      responseType: "generative_ui.action.response",
      timeout: options?.timeout ?? 1e4
    });
    if (!response.received) {
      throw new DaemonRpcError({
        requestId,
        error: response.error ?? "generative_ui.action rejected",
        requestType: "generative_ui.action.request"
      });
    }
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-request-coordinator.js
var DEFAULT_SEND_QUEUE_TIMEOUT_MS = 1e4;
var DaemonRequestCoordinator = class {
  constructor(options) {
    this.options = options;
    this.waiters = /* @__PURE__ */ new Set();
    this.pendingSends = [];
  }
  async request(params) {
    const { promise, cancel } = this.waitForWithCancel((message) => {
      if (message.type === "rpc_error" && message.payload.requestId === params.requestId) {
        return {
          kind: "error",
          error: new DaemonRpcError({
            requestId: message.payload.requestId,
            error: message.payload.error,
            requestType: message.payload.requestType,
            code: message.payload.code
          })
        };
      }
      const value = params.select(message);
      return value === null ? null : { kind: "ok", value };
    }, params.timeout, params.options);
    try {
      await this.sendOrQueue(params.message);
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      cancel(resolvedError);
      void promise.catch(() => void 0);
      throw resolvedError;
    }
    const result = await promise;
    if (result.kind === "error") {
      throw result.error;
    }
    return result.value;
  }
  async requestCorrelated(params) {
    return this.request({
      requestId: params.requestId,
      message: params.message,
      timeout: params.timeout,
      options: params.options,
      select: (message) => {
        const correlated = message;
        if (correlated.type !== params.responseType) {
          return null;
        }
        const payload = correlated.payload;
        if (payload.requestId !== params.requestId) {
          return null;
        }
        return params.selectPayload ? params.selectPayload(payload) : payload;
      }
    });
  }
  requestSession(params) {
    const requestId = this.options.createRequestId(params.requestId);
    const message = SessionInboundMessageSchema.parse({ ...params.message, requestId });
    return this.requestCorrelated({
      requestId,
      message,
      responseType: params.responseType,
      timeout: params.timeout,
      options: { skipQueue: true },
      ...params.selectPayload ? { selectPayload: params.selectPayload } : {}
    });
  }
  requestNamespaced(params) {
    const responseType = params.message.type.replace(/\.request$/, ".response");
    return this.requestSession({ ...params, responseType });
  }
  waitForWithCancel(predicate, timeout = 3e4, _options) {
    const timeoutError = new Error(`Timeout waiting for message (${timeout}ms)`);
    let waiter = null;
    let settled = false;
    let rejectPromise = null;
    const promise = new Promise((resolve, reject) => {
      const wrappedResolve = (value) => {
        if (settled)
          return;
        settled = true;
        resolve(value);
      };
      const wrappedReject = (error) => {
        if (settled)
          return;
        settled = true;
        reject(error);
      };
      rejectPromise = wrappedReject;
      const timeoutHandle = timeout > 0 ? setTimeout(() => {
        if (waiter)
          this.waiters.delete(waiter);
        wrappedReject(timeoutError);
      }, timeout) : null;
      waiter = { predicate, resolve: wrappedResolve, reject: wrappedReject, timeoutHandle };
      this.waiters.add(waiter);
    });
    return {
      promise,
      cancel: (error) => {
        if (settled)
          return;
        if (waiter) {
          this.waiters.delete(waiter);
          if (waiter.timeoutHandle)
            clearTimeout(waiter.timeoutHandle);
        }
        if (rejectPromise) {
          rejectPromise(error);
          return;
        }
        queueMicrotask(() => {
          if (!settled && rejectPromise)
            rejectPromise(error);
        });
      }
    };
  }
  handleMessage(message) {
    for (const waiter of Array.from(this.waiters)) {
      const result = waiter.predicate(message);
      if (result === null)
        continue;
      this.waiters.delete(waiter);
      if (waiter.timeoutHandle)
        clearTimeout(waiter.timeoutHandle);
      waiter.resolve(result);
    }
  }
  flushPendingSends() {
    const pendingSends = this.pendingSends;
    this.pendingSends = [];
    for (const pending of pendingSends) {
      clearTimeout(pending.timeoutHandle);
      try {
        if (this.options.getConnectionStatus() !== "connected") {
          pending.reject(new Error("Connection lost before message could be sent"));
          continue;
        }
        this.options.sendConnectedMessage(pending.message);
        pending.resolve();
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  clear(error) {
    for (const waiter of Array.from(this.waiters)) {
      if (waiter.timeoutHandle)
        clearTimeout(waiter.timeoutHandle);
      waiter.reject(error);
    }
    this.waiters.clear();
    const pendingSends = this.pendingSends;
    this.pendingSends = [];
    for (const pending of pendingSends) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
    }
  }
  sendOrQueue(message) {
    const status = this.options.getConnectionStatus();
    if (status === "connected") {
      this.options.sendConnectedMessage(message);
      return Promise.resolve();
    }
    if (status !== "connecting") {
      return Promise.reject(new Error(`Transport not connected (status: ${status})`));
    }
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        const index = this.pendingSends.findIndex((pending) => pending.resolve === resolve);
        if (index !== -1)
          this.pendingSends.splice(index, 1);
        reject(new Error("Timed out waiting for connection to send message"));
      }, DEFAULT_SEND_QUEUE_TIMEOUT_MS);
      this.pendingSends.push({ message, resolve, reject, timeoutHandle });
    });
  }
};

// vendor/chisacode-remote/packages/protocol/dist/daemon-endpoints.js
var CURRENT_RELAY_PROTOCOL_VERSION = "2";
function normalizeRelayProtocolVersion(value, fallback = CURRENT_RELAY_PROTOCOL_VERSION) {
  if (value == null) {
    return fallback;
  }
  let normalized = "";
  if (typeof value === "string") {
    normalized = value.trim();
  } else if (typeof value === "number") {
    normalized = String(value);
  }
  if (!normalized) {
    return fallback;
  }
  if (normalized === "1" || normalized === "2") {
    return normalized;
  }
  throw new Error('Relay version must be "1" or "2"');
}
function parsePort(portStr, context) {
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${context}: port must be between 1 and 65535`);
  }
  return port;
}
function parseHostPort(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Host is required");
  }
  if (trimmed.startsWith("[")) {
    const match2 = trimmed.match(/^\[([^\]]+)\]:(\d{1,5})$/);
    if (!match2) {
      throw new Error("Invalid host:port (expected [::1]:6767)");
    }
    const host2 = match2[1].trim();
    if (!host2)
      throw new Error("Host is required");
    const port2 = parsePort(match2[2], "Invalid host:port");
    return { host: host2, port: port2, isIpv6: true };
  }
  const match = trimmed.match(/^(.+):(\d{1,5})$/);
  if (!match) {
    throw new Error("Invalid host:port (expected localhost:6767)");
  }
  const host = match[1].trim();
  if (!host)
    throw new Error("Host is required");
  const port = parsePort(match[2], "Invalid host:port");
  return { host, port, isIpv6: false };
}
function buildDaemonWebSocketUrl(endpoint, opts) {
  const { host, port, isIpv6 } = parseHostPort(endpoint);
  const protocol = opts.useTls ? "wss" : "ws";
  const hostPart = isIpv6 ? `[${host}]` : host;
  return new URL(`${protocol}://${hostPart}:${port}/ws`).toString();
}
function buildRelayWebSocketUrl(params) {
  const { host, port, isIpv6 } = parseHostPort(params.endpoint);
  const protocol = params.useTls ? "wss" : "ws";
  const hostPart = isIpv6 ? `[${host}]` : host;
  const url = new URL(`${protocol}://${hostPart}:${port}/ws`);
  url.searchParams.set("serverId", params.serverId);
  url.searchParams.set("role", params.role);
  url.searchParams.set("v", normalizeRelayProtocolVersion(params.version));
  if (params.connectionId) {
    url.searchParams.set("connectionId", params.connectionId);
  }
  if (params.relayAuth) {
    url.searchParams.set("relayAuthPublicKeyB64", params.relayAuth.publicKeyB64);
    url.searchParams.set("relayAuthNonce", params.relayAuth.nonce);
    url.searchParams.set("relayAuthIssuedAt", String(params.relayAuth.issuedAt));
    url.searchParams.set("relayAuthSignatureB64", params.relayAuth.signatureB64);
  }
  return url.toString();
}
function isRelayClientWebSocketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("role") === "client" && parsed.searchParams.has("serverId");
  } catch {
    return false;
  }
}

// vendor/chisacode-remote/packages/relay/src/crypto.ts
var import_tweetnacl = __toESM(require_nacl_fast(), 1);
var import_base64_js = __toESM(require_base64_js(), 1);
var NONCE_LENGTH = import_tweetnacl.default.box.nonceLength;
var SALT_LENGTH = 16;
var SEQ_LENGTH = 8;
var prngReady = false;
function getGlobalCrypto() {
  const g = globalThis;
  return g.crypto;
}
function ensurePrng() {
  if (prngReady) return;
  try {
    import_tweetnacl.default.randomBytes(1);
    prngReady = true;
    return;
  } catch {
  }
  const cryptoObj = getGlobalCrypto();
  if (cryptoObj?.getRandomValues) {
    import_tweetnacl.default.setPRNG((x, n) => {
      const buf = new Uint8Array(n);
      cryptoObj.getRandomValues(buf);
      x.set(buf, 0);
    });
    prngReady = true;
    return;
  }
  throw new Error("No secure PRNG available for tweetnacl (missing crypto.getRandomValues)");
}
function encodeBase64(bytes) {
  return (0, import_base64_js.fromByteArray)(bytes);
}
function decodeBase64(base64) {
  return (0, import_base64_js.toByteArray)(base64);
}
function toUint8(data) {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
}
function toArrayBuffer(bytes) {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}
function generateKeyPair() {
  ensurePrng();
  const { publicKey, secretKey } = import_tweetnacl.default.box.keyPair();
  return { publicKey, secretKey };
}
function exportPublicKey(publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength !== import_tweetnacl.default.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${import_tweetnacl.default.box.publicKeyLength})`);
  }
  return encodeBase64(publicKey);
}
function importPublicKey(base64) {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== import_tweetnacl.default.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${import_tweetnacl.default.box.publicKeyLength})`);
  }
  return bytes;
}
function deriveSharedKey(ourSecretKey, peerPublicKey) {
  if (ourSecretKey.byteLength !== import_tweetnacl.default.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${import_tweetnacl.default.box.secretKeyLength})`);
  }
  if (peerPublicKey.byteLength !== import_tweetnacl.default.box.publicKeyLength) {
    throw new Error(`Invalid peer public key length (expected ${import_tweetnacl.default.box.publicKeyLength})`);
  }
  return import_tweetnacl.default.box.before(peerPublicKey, ourSecretKey);
}
function seqToLEBytes(seq) {
  const masked = seq & 0xffffffffffffffffn;
  const out = new Uint8Array(SEQ_LENGTH);
  for (let i = 0; i < SEQ_LENGTH; i += 1) {
    out[i] = Number(masked >> BigInt(i * 8) & 0xffn);
  }
  return out;
}
function seqFromLEBytes(bytes) {
  let value = 0n;
  for (let i = 0; i < SEQ_LENGTH; i += 1) {
    value |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return value;
}
function buildNonce(salt, seq) {
  const nonce = new Uint8Array(NONCE_LENGTH);
  nonce.set(salt, 0);
  nonce.set(seqToLEBytes(seq), SALT_LENGTH);
  return nonce;
}
function encrypt(sharedKey, data, seq, salt) {
  if (!(salt instanceof Uint8Array) || salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Invalid salt length (expected ${SALT_LENGTH})`);
  }
  if (seq < 0n) {
    throw new Error("seq must be a non-negative BigInt");
  }
  ensurePrng();
  const nonce = buildNonce(salt, seq);
  const plaintext = toUint8(data);
  const ciphertext = import_tweetnacl.default.box.after(plaintext, nonce, sharedKey);
  const out = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.byteLength);
  return toArrayBuffer(out);
}
function decrypt(sharedKey, data) {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength < NONCE_LENGTH) {
    throw new Error("Ciphertext bundle too short");
  }
  const nonce = bytes.slice(0, NONCE_LENGTH);
  const salt = nonce.slice(0, SALT_LENGTH);
  const seq = seqFromLEBytes(nonce.slice(SALT_LENGTH));
  const ciphertext = bytes.slice(NONCE_LENGTH);
  const opened = import_tweetnacl.default.box.open.after(ciphertext, nonce, sharedKey);
  if (!opened) {
    throw new Error("Decryption failed");
  }
  const plaintextBuffer = toArrayBuffer(opened);
  let plaintext;
  try {
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBuffer);
  } catch {
    plaintext = plaintextBuffer;
  }
  return { plaintext, seq, salt };
}

// vendor/chisacode-remote/packages/relay/src/encrypted-channel.ts
var import_tweetnacl2 = __toESM(require_nacl_fast(), 1);

// vendor/chisacode-remote/packages/relay/src/base64.ts
var import_base64_js2 = __toESM(require_base64_js(), 1);
function arrayBufferToBase64(buffer) {
  return (0, import_base64_js2.fromByteArray)(new Uint8Array(buffer));
}
function base64ToArrayBuffer(base64) {
  const normalized = (() => {
    const trimmed = base64.trim();
    const standard = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - standard.length % 4) % 4;
    return standard + "=".repeat(padLen);
  })();
  const bytes = (0, import_base64_js2.toByteArray)(normalized);
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

// vendor/chisacode-remote/packages/relay/src/encrypted-channel.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isE2EEHelloMessage(value) {
  return isRecord(value) && value.type === "e2ee_hello" && typeof value.key === "string" && value.key.trim().length > 0;
}
function isE2EEReadyMessage(value) {
  return isRecord(value) && value.type === "e2ee_ready" && (value.authChallenge === void 0 || typeof value.authChallenge === "string" && value.authChallenge.trim().length > 0);
}
var HANDSHAKE_RETRY_MS = 1e3;
var MAX_PENDING_SENDS = 200;
var REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE = 1008;
var REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch";
var REPLAY_PROTECTION_CLOSE_CODE = 1011;
var REPLAY_PROTECTION_CLOSE_REASON = "E2EE replay protection violation";
function hasUnref(timeout) {
  return typeof timeout === "object" && timeout !== null && "unref" in timeout && typeof timeout.unref === "function";
}
async function createClientChannel(transport, daemonPublicKeyB64, events = {}) {
  const keyPair = generateKeyPair();
  const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
  const sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);
  const ourPublicKeyB64 = exportPublicKey(keyPair.publicKey);
  const channel = new EncryptedChannel(transport, sharedKey, events, {
    securityContext: { clientPublicKeyB64: ourPublicKeyB64 }
  });
  const hello = { type: "e2ee_hello", key: ourPublicKeyB64 };
  const helloText = JSON.stringify(hello);
  let retry = null;
  const emitSendError = (error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    events.onerror?.(err);
  };
  const sendHello = () => {
    try {
      transport.send(helloText);
      return true;
    } catch (error) {
      emitSendError(error);
      return false;
    }
  };
  const clearRetry = () => {
    if (retry) {
      clearInterval(retry);
      retry = null;
    }
  };
  channel.onTransitionToOpen(() => clearRetry());
  channel.onClose(() => clearRetry());
  sendHello();
  try {
    retry = setInterval(() => {
      if (channel.isOpen()) {
        clearRetry();
        return;
      }
      sendHello();
    }, HANDSHAKE_RETRY_MS);
    if (hasUnref(retry)) {
      retry.unref();
    }
    return channel;
  } catch (error) {
    clearRetry();
    throw error;
  }
}
var EncryptedChannel = class {
  constructor(transport, sharedKey, events = {}, options = {}) {
    this.state = "handshaking";
    this.pendingSends = [];
    this.onOpenCallbacks = [];
    this.onCloseCallbacks = [];
    // Replay protection state, maintained per channel direction.
    // Each side has its own send counter + send salt (random, generated when
    // the channel transitions to open) and tracks the peer's receive counter +
    // receive salt (locked to the first encrypted frame observed).
    this.sendSeq = 0n;
    this.recvSeq = null;
    this.sendSalt = null;
    this.recvSalt = null;
    this.transport = transport;
    this.sharedKey = sharedKey;
    this.events = events;
    this.options = options;
    this.securityContext = options.securityContext ? { ...options.securityContext } : null;
    Object.assign(transport, {
      onmessage: (data) => this.handleMessage(data),
      onclose: (code, reason) => {
        this.state = "closed";
        this.events.onclose?.(code, reason);
        for (const cb of this.onCloseCallbacks) cb();
      },
      onerror: (error) => {
        this.events.onerror?.(error);
      }
    });
  }
  setState(state) {
    this.state = state;
    if (state === "open") {
      ensurePrng();
      this.sendSalt = import_tweetnacl2.default.randomBytes(SALT_LENGTH);
      this.sendSeq = 0n;
    }
  }
  async handleMessage(data) {
    if (this.state === "handshaking") {
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        const parsed = JSON.parse(text);
        if (isE2EEReadyMessage(parsed)) {
          if (this.securityContext && parsed.authChallenge) {
            this.securityContext.authChallenge = parsed.authChallenge;
          }
          this.setState("open");
          this.events.onopen?.();
          for (const cb of this.onOpenCallbacks) cb();
          await this.flushPendingSends();
        }
      } catch {
      }
      return;
    }
    if (this.state !== "open") return;
    try {
      const ciphertext = await (async () => {
        try {
          const text = typeof data === "string" ? data : new TextDecoder().decode(data);
          if (text.trim().startsWith("{")) {
            const parsed = JSON.parse(text);
            if (isE2EEHelloMessage(parsed)) {
              if (this.options.daemonKeyPair) {
                await this.handleDaemonRehello(parsed.key);
              }
              return null;
            }
            if (isE2EEReadyMessage(parsed)) {
              return null;
            }
            throw new Error("Received plaintext frame on encrypted channel");
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("plaintext frame")) {
            throw error;
          }
        }
        if (typeof data === "string") {
          return base64ToArrayBuffer(data);
        }
        try {
          const decoded = new TextDecoder().decode(data);
          return base64ToArrayBuffer(decoded);
        } catch {
          return data;
        }
      })();
      if (ciphertext) {
        const { plaintext, seq, salt } = decrypt(this.sharedKey, ciphertext);
        this.enforceReplayProtection(seq, salt);
        this.events.onmessage?.(plaintext);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      try {
        this.transport.close(
          err.message.includes("replay") ? REPLAY_PROTECTION_CLOSE_CODE : 1011,
          err.message.includes("replay") ? REPLAY_PROTECTION_CLOSE_REASON : err.message
        );
      } catch {
      }
    }
  }
  /**
   * Rejects replayed or out-of-order frames. The first received frame locks
   * the per-direction salt and seeds the recv counter; every subsequent frame
   * must carry the same salt and a strictly greater seq. A violation closes
   * the channel fatally so the peer must re-handshake.
   */
  enforceReplayProtection(seq, salt) {
    if (this.recvSalt === null || this.recvSeq === null) {
      this.recvSalt = salt;
      this.recvSeq = seq;
      return;
    }
    if (salt.byteLength !== this.recvSalt.byteLength) {
      throw new Error("E2EE replay protection violation: salt length changed");
    }
    let saltMismatch = 0;
    for (let i = 0; i < this.recvSalt.byteLength; i += 1) {
      saltMismatch |= salt[i] ^ this.recvSalt[i];
    }
    if (saltMismatch !== 0) {
      throw new Error("E2EE replay protection violation: salt changed");
    }
    if (seq <= this.recvSeq) {
      throw new Error("E2EE replay protection violation: seq not strictly increasing");
    }
    this.recvSeq = seq;
  }
  async send(data) {
    if (this.state === "handshaking") {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        this.pendingSends.shift();
      }
      this.pendingSends.push(data);
      return;
    }
    if (this.state !== "open") {
      throw new Error("Channel not open");
    }
    if (!this.sendSalt) {
      throw new Error("Channel open without send salt initialised");
    }
    const seq = this.sendSeq;
    this.sendSeq += 1n;
    const ciphertext = encrypt(this.sharedKey, data, seq, this.sendSalt);
    this.transport.send(arrayBufferToBase64(ciphertext));
  }
  async flushPendingSends() {
    if (this.state !== "open") return;
    const pending = this.pendingSends;
    this.pendingSends = [];
    for (const item of pending) {
      await this.send(item);
    }
  }
  async handleDaemonRehello(clientKeyB64) {
    if (!this.options.daemonKeyPair) return;
    const clientPublicKey = importPublicKey(clientKeyB64);
    const nextSharedKey = deriveSharedKey(this.options.daemonKeyPair.secretKey, clientPublicKey);
    if (keysEqual(nextSharedKey, this.sharedKey)) {
      this.transport.send(
        JSON.stringify({
          type: "e2ee_ready",
          ...this.securityContext?.authChallenge ? { authChallenge: this.securityContext.authChallenge } : {}
        })
      );
      return;
    }
    this.state = "closed";
    this.transport.close(
      REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE,
      REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON
    );
  }
  close(code = 1e3, reason = "Normal closure") {
    this.state = "closed";
    this.transport.close(code, reason);
  }
  isOpen() {
    return this.state === "open";
  }
  /**
   * Returns the E2EE handshake values that relay device auth must bind to.
   * @returns A defensive copy of the channel security context, or null before setup
   */
  getSecurityContext() {
    return this.securityContext ? { ...this.securityContext } : null;
  }
  onTransitionToOpen(cb) {
    this.onOpenCallbacks.push(cb);
  }
  onClose(cb) {
    this.onCloseCallbacks.push(cb);
  }
};
function keysEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-relay-e2ee-transport.js
function createRelayE2eeTransportFactory(args) {
  return ({ url, headers }) => {
    const base = args.baseFactory({ url, headers });
    return createEncryptedTransport(base, args.daemonPublicKeyB64, args.logger);
  };
}
function createEncryptedTransport(base, daemonPublicKeyB64, logger) {
  let channel = null;
  let opened = false;
  let closed = false;
  const openHandlers = /* @__PURE__ */ new Set();
  const closeHandlers = /* @__PURE__ */ new Set();
  const errorHandlers = /* @__PURE__ */ new Set();
  const messageHandlers = /* @__PURE__ */ new Set();
  const emitOpen = () => {
    if (opened || closed) {
      return;
    }
    opened = true;
    emitHandlers(openHandlers);
  };
  const emitClose = (event) => {
    if (closed) {
      return;
    }
    closed = true;
    emitHandlers(closeHandlers, event);
  };
  const emitError = (event) => {
    if (closed) {
      return;
    }
    emitHandlers(errorHandlers, event);
  };
  const emitMessage = (data) => {
    if (closed) {
      return;
    }
    emitHandlers(messageHandlers, data);
  };
  const relayTransport = {
    send: (data) => {
      if (typeof data === "string") {
        base.send(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        base.send(normalizeTransportPayload(data));
        return;
      }
      if (data instanceof ArrayBuffer) {
        base.send(data);
        return;
      }
      base.send(String(data));
    },
    close: (code, reason) => base.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null
  };
  const startHandshake = async () => {
    try {
      channel = await createClientChannel(relayTransport, daemonPublicKeyB64, {
        onopen: emitOpen,
        onmessage: (data) => emitMessage(data),
        onclose: (code, reason) => emitClose({ code, reason }),
        onerror: (error) => emitError(error)
      });
    } catch (error) {
      logger.warn({ err: normalizeTransportError(error) }, "relay_e2ee_handshake_failed");
      emitError(error);
      base.close(4001, "E2EE handshake failed");
    }
  };
  base.onOpen(() => {
    void startHandshake();
  });
  base.onMessage((event) => {
    relayTransport.onmessage?.(extractRelayMessageData(event));
  });
  base.onClose((event) => {
    const record = event;
    relayTransport.onclose?.(record?.code ?? 0, record?.reason ?? "");
    emitClose(event);
  });
  base.onError((event) => {
    relayTransport.onerror?.(event instanceof Error ? event : new Error(String(event)));
    emitError(event);
  });
  return {
    send: (data) => {
      if (!channel) {
        logger.warn({}, "relay_e2ee_send_before_ready");
        const error = new Error("Encrypted channel not ready");
        emitError(error);
        throw error;
      }
      void channel.send(normalizeTransportPayload(data)).catch((error) => {
        logger.warn({ err: normalizeTransportError(error) }, "relay_e2ee_send_failed");
        emitError(error);
      });
    },
    close: (code, reason) => {
      if (channel) {
        channel.close(code, reason);
      } else {
        base.close(code, reason);
      }
      emitClose({ code, reason });
    },
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onOpen: (handler) => {
      openHandlers.add(handler);
      if (opened) {
        invokeHandler(handler);
      }
      return () => openHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      if (closed) {
        invokeHandler(handler);
      }
      return () => closeHandlers.delete(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    getRelaySecurityContext: () => channel?.getSecurityContext() ?? null
  };
}
function emitHandlers(handlers, ...args) {
  for (const handler of handlers) {
    invokeHandler(handler, ...args);
  }
}
function invokeHandler(handler, ...args) {
  try {
    handler(...args);
  } catch {
  }
}
function normalizeTransportError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...typeof error.stack === "string" ? { stack: error.stack } : {}
    };
  }
  return { message: String(error) };
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-websocket-transport.js
function defaultWebSocketFactory(url, options) {
  const globalWs = globalThis.WebSocket;
  if (!globalWs) {
    throw new Error("WebSocket is not available in this runtime");
  }
  return new globalWs(url, options?.protocols);
}
function createWebSocketTransportFactory(factory) {
  return ({ url, headers, protocols }) => {
    const ws = factory(url, { headers, protocols });
    if ("binaryType" in ws) {
      try {
        ws.binaryType = "arraybuffer";
      } catch {
      }
    }
    return {
      send: (data) => {
        if (typeof ws.readyState === "number" && ws.readyState !== 1) {
          throw new Error(`WebSocket not open (readyState=${ws.readyState})`);
        }
        ws.send(data);
      },
      close: (code, reason) => {
        const suppressEarlyCloseError = bindTemporaryEarlyCloseErrorHandler(ws);
        try {
          ws.close(code, reason);
        } finally {
          if (typeof ws.on !== "function" && typeof ws.addEventListener !== "function") {
            suppressEarlyCloseError();
          }
        }
      },
      onOpen: (handler) => bindWsHandler(ws, "open", handler),
      onClose: (handler) => bindWsHandler(ws, "close", handler),
      onError: (handler) => bindWsHandler(ws, "error", handler),
      onMessage: (handler) => bindWsHandler(ws, "message", handler)
    };
  };
}
function bindTemporaryEarlyCloseErrorHandler(ws) {
  const noop = () => {
  };
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener("error", noop);
    const removeOnClose = bindWsHandler(ws, "close", () => {
      removeOnClose();
      if (typeof ws.removeEventListener === "function") {
        ws.removeEventListener("error", noop);
      }
    });
    return () => {
      removeOnClose();
      if (typeof ws.removeEventListener === "function") {
        ws.removeEventListener("error", noop);
      }
    };
  }
  if (typeof ws.on === "function") {
    ws.on("error", noop);
    const removeOnClose = bindWsHandler(ws, "close", () => {
      removeOnClose();
      if (typeof ws.off === "function") {
        ws.off("error", noop);
        return;
      }
      if (typeof ws.removeListener === "function") {
        ws.removeListener("error", noop);
      }
    });
    return () => {
      removeOnClose();
      if (typeof ws.off === "function") {
        ws.off("error", noop);
        return;
      }
      if (typeof ws.removeListener === "function") {
        ws.removeListener("error", noop);
      }
    };
  }
  return () => {
  };
}
function bindWsHandler(ws, event, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, handler);
    return () => {
      if (typeof ws.removeEventListener === "function") {
        ws.removeEventListener(event, handler);
      }
    };
  }
  if (typeof ws.on === "function") {
    ws.on(event, handler);
    return () => {
      if (typeof ws.off === "function") {
        ws.off(event, handler);
        return;
      }
      if (typeof ws.removeListener === "function") {
        ws.removeListener(event, handler);
      }
    };
  }
  const prop = `on${event}`;
  const wsRecord = ws;
  const previous = wsRecord[prop];
  wsRecord[prop] = handler;
  return () => {
    if (wsRecord[prop] === handler) {
      wsRecord[prop] = previous ?? null;
    }
  };
}

// vendor/chisacode-remote/packages/client/dist/sha256-hmac.js
var K = [
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
];
var H_INIT = [
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
];
function rotr(value, bits) {
  return (value >>> bits | value << 32 - bits) >>> 0;
}
function sha256(message) {
  const bitLen = message.length * 8;
  const padded = new Uint8Array((message.length + 8 >> 6 << 6) + 64);
  padded.set(message);
  padded[message.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  const h = H_INIT.slice();
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const temp1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = a & b ^ a & c ^ b & c;
      const temp2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) {
    digestView.setUint32(i * 4, h[i]);
  }
  return digest;
}
function base64urlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function hmacSha256Base64Url(key, data) {
  const blockSize = 64;
  let normalizedKey;
  if (key.length > blockSize) {
    normalizedKey = sha256(key);
  } else {
    normalizedKey = key;
  }
  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    const keyByte = i < normalizedKey.length ? normalizedKey[i] : 0;
    innerPad[i] = keyByte ^ 54;
    outerPad[i] = keyByte ^ 92;
  }
  const inner = new Uint8Array(blockSize + data.length);
  inner.set(innerPad);
  inner.set(data, blockSize);
  const innerHash = sha256(inner);
  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(outerPad);
  outer.set(innerHash, blockSize);
  return base64urlEncode(sha256(outer));
}
function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : void 0;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteCount; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomBase64UrlChallenge() {
  const bytes = new Uint8Array(32);
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : void 0;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64urlEncode(bytes);
}

// vendor/chisacode-remote/packages/client/dist/relay-device-credentials.js
var RELAY_DEVICE_AUTH_VERSION = 1;
function utf8Bytes(input) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(input);
  }
  const encoded = unescape(encodeURIComponent(input));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}
function buildRelayDeviceAuthTranscript(input) {
  return [
    `v=${input.version}`,
    `serverId=${input.serverId}`,
    `daemonPublicKeyB64=${input.daemonPublicKeyB64}`,
    `clientPublicKeyB64=${input.clientPublicKeyB64}`,
    `deviceId=${input.deviceId}`,
    `challenge=${input.challenge}`
  ].join("\n");
}
var MemoryRelayDeviceCredentialStore = class {
  constructor() {
    this.credentials = [];
  }
  async load() {
    return this.credentials.map((entry) => ({ ...entry }));
  }
  async save(credentials) {
    this.credentials = credentials.map((entry) => ({ ...entry }));
  }
};
var RelayDeviceCredentialClient = class {
  constructor(adapter) {
    this.adapter = adapter;
  }
  async get(serverId) {
    const all = await this.adapter.load();
    return all.find((entry) => entry.serverId === serverId) ?? null;
  }
  async upsert(input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const all = await this.adapter.load();
    const existing = all.find((entry) => entry.serverId === input.serverId);
    const next = {
      serverId: input.serverId,
      deviceId: input.deviceId,
      deviceSecret: input.deviceSecret,
      daemonPublicKeyB64: input.daemonPublicKeyB64,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const remaining = all.filter((entry) => entry.serverId !== input.serverId);
    remaining.push(next);
    await this.adapter.save(remaining);
    return next;
  }
  async remove(serverId) {
    const all = await this.adapter.load();
    await this.adapter.save(all.filter((entry) => entry.serverId !== serverId));
  }
  /**
   * Build a challenge+proof payload for hello.relayDeviceAuth.
   */
  buildProofAuth(input) {
    const challenge = input.challenge ?? randomBase64UrlChallenge();
    const proof = computeClientRelayDeviceAuthProof(input.credential.deviceSecret, {
      serverId: input.credential.serverId,
      daemonPublicKeyB64: input.credential.daemonPublicKeyB64,
      clientPublicKeyB64: input.clientPublicKeyB64,
      deviceId: input.credential.deviceId,
      challenge
    });
    return {
      deviceId: input.credential.deviceId,
      challenge,
      proof
    };
  }
  /**
   * Build a first-time pairing payload for hello.relayDeviceAuth.
   */
  buildPairingAuth(input) {
    return {
      version: 1,
      deviceId: input.deviceId,
      pairingToken: input.pairingToken,
      ...input.clientPublicKeyB64 ? { clientPublicKeyB64: input.clientPublicKeyB64 } : {}
    };
  }
};
function createRelayDeviceId() {
  return `dev_${randomHex(16)}`;
}
function computeClientRelayDeviceAuthProof(deviceSecret, transcriptFields) {
  const transcript = buildRelayDeviceAuthTranscript({
    version: transcriptFields.version ?? RELAY_DEVICE_AUTH_VERSION,
    serverId: transcriptFields.serverId,
    daemonPublicKeyB64: transcriptFields.daemonPublicKeyB64,
    clientPublicKeyB64: transcriptFields.clientPublicKeyB64,
    deviceId: transcriptFields.deviceId,
    challenge: transcriptFields.challenge
  });
  return hmacSha256Base64Url(utf8Bytes(deviceSecret), utf8Bytes(transcript));
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-connection-controller.js
var DEFAULT_RECONNECT_BASE_DELAY_MS = 1500;
var DEFAULT_RECONNECT_MAX_DELAY_MS = 3e4;
var DEFAULT_CONNECT_TIMEOUT_MS = 15e3;
var DEFAULT_LIVENESS_TIMEOUT_MS = 5e3;
var LIVENESS_FAILURE_RECONNECT_THRESHOLD = 2;
var perfNow = typeof performance !== "undefined" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();
var DaemonConnectionController = class {
  constructor(config, logger, callbacks) {
    this.logger = logger;
    this.callbacks = callbacks;
    this.transport = null;
    this.transportCleanup = [];
    this.connectionListeners = /* @__PURE__ */ new Set();
    this.reconnectTimeout = null;
    this.connectTimeout = null;
    this.pendingGenericTransportErrorTimeout = null;
    this.reconnectAttempt = 0;
    this.shouldReconnect = true;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.lastErrorValue = null;
    this.connectionState = { status: "idle" };
    this.livenessProbe = null;
    this.consecutiveLivenessFailures = 0;
    const clientId = normalizeClientId(config.clientId);
    if (!clientId) {
      throw new Error("Daemon client requires a non-empty clientId");
    }
    this.config = { ...config, clientId };
    this.connectionPath = isRelayClientWebSocketUrl(config.url) ? "relay" : "direct";
    let parsedUrl = null;
    try {
      parsedUrl = new URL(config.url);
    } catch {
      parsedUrl = null;
    }
    this.serverId = normalizeClientId(parsedUrl?.searchParams.get("serverId")) ?? parsedUrl?.host ?? null;
    this.clientIdHash = hashForLog(clientId);
    this.generation = typeof config.runtimeGeneration === "number" && Number.isFinite(config.runtimeGeneration) ? config.runtimeGeneration : null;
  }
  async connect() {
    if (this.connectionState.status === "disposed") {
      throw new Error("Daemon client is disposed");
    }
    if (this.connectionState.status === "connected")
      return;
    if (this.connectPromise)
      return this.connectPromise;
    this.shouldReconnect = true;
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.attemptConnect();
    });
    return this.connectPromise;
  }
  async close() {
    if (this.connectionState.status === "disposed")
      return;
    this.shouldReconnect = false;
    const error = new Error("Daemon client closed");
    this.rejectConnect(error);
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.resetConnectTimeout();
    this.disposeTransport(1e3, "Client closed");
    this.rejectLivenessProbe(error);
    this.callbacks.onReset(error, true);
    this.updateConnectionState({ status: "disposed" }, { event: "DISPOSE", reason: "Client closed", reasonCode: "disposed" });
  }
  ensureConnected() {
    if (this.connectionState.status === "disposed")
      return;
    if (!this.shouldReconnect)
      this.shouldReconnect = true;
    if (this.connectionState.status === "connected" || this.connectionState.status === "connecting") {
      return;
    }
    void this.connect().catch((error) => {
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err: resolvedError }, "ensureConnected connect() rejected");
    });
  }
  markConnected() {
    if (this.connectionState.status !== "connecting")
      return;
    this.resetConnectTimeout();
    this.reconnectAttempt = 0;
    this.updateConnectionState({ status: "connected" }, { event: "HELLO_SERVER_INFO" });
    this.callbacks.onConnected();
    this.resolveConnect();
  }
  getState() {
    return this.connectionState;
  }
  subscribe(listener) {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => this.connectionListeners.delete(listener);
  }
  get isConnected() {
    return this.connectionState.status === "connected";
  }
  get isConnecting() {
    return this.connectionState.status === "connecting";
  }
  get lastError() {
    return this.lastErrorValue;
  }
  setReconnectEnabled(enabled) {
    this.config = { ...this.config, reconnect: { ...this.config.reconnect, enabled } };
  }
  sendSessionMessage(message) {
    if (!this.transport || !this.isConnected) {
      if (this.config.suppressSendErrors)
        return;
      throw new Error("Transport not connected (status: " + this.connectionState.status + ")");
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
    } catch (error) {
      if (this.config.suppressSendErrors)
        return;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  sendSessionMessageStrict(message) {
    if (!this.transport || !this.isConnected) {
      throw new Error("Transport not connected");
    }
    const payload = SessionInboundMessageSchema.parse(message);
    try {
      this.transport.send(JSON.stringify({ type: "session", message: payload }));
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  sendBinaryFrame(frame) {
    if (!this.transport || !this.isConnected) {
      if (this.config.suppressSendErrors)
        return;
      throw new Error("Transport not connected (status: " + this.connectionState.status + ")");
    }
    try {
      this.transport.send(frame);
    } catch (error) {
      if (this.config.suppressSendErrors)
        return;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  checkLiveness(params) {
    if (!this.transport || !this.isConnected) {
      return Promise.reject(new Error("Transport not connected (status: " + this.connectionState.status + ")"));
    }
    if (this.livenessProbe)
      return this.livenessProbe.promise;
    const startedAt = perfNow();
    const timeoutMs = Math.max(1, params?.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS);
    let resolveProbe = null;
    let rejectProbe = null;
    const promise = new Promise((resolve, reject) => {
      resolveProbe = resolve;
      rejectProbe = reject;
    });
    const probe = {
      promise,
      resolve: (value) => resolveProbe?.(value),
      reject: (error) => rejectProbe?.(error),
      timeoutHandle: setTimeout(() => {
        if (this.livenessProbe !== probe)
          return;
        this.livenessProbe = null;
        const error = new Error("Liveness check timed out (" + timeoutMs + "ms)");
        probe.reject(error);
        this.recordLivenessFailure(error);
      }, timeoutMs),
      startedAt
    };
    this.livenessProbe = probe;
    try {
      this.transport.send(JSON.stringify({ type: "ping" }));
    } catch (error) {
      this.clearLivenessProbe();
      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.recordLivenessFailure(resolvedError);
      return Promise.reject(resolvedError);
    }
    return promise;
  }
  recordInboundActivity() {
    this.consecutiveLivenessFailures = 0;
  }
  resolvePong() {
    const probe = this.livenessProbe;
    if (!probe)
      return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.resolve({ rttMs: perfNow() - probe.startedAt });
  }
  attemptConnect() {
    if (this.connectionState.status === "disposed") {
      this.rejectConnect(new Error("Daemon client is disposed"));
      return;
    }
    if (!this.shouldReconnect) {
      this.rejectConnect(new Error("Daemon client is closed"));
      return;
    }
    if (this.connectionState.status === "connecting")
      return;
    const headers = {};
    const password = normalizePassword(this.config.password);
    if (password)
      headers.Authorization = "Bearer " + password;
    else if (this.config.authHeader)
      headers.Authorization = this.config.authHeader;
    const protocols = password ? ["chisacode.bearer." + password] : void 0;
    try {
      this.disposeTransport();
      const baseTransportFactory = this.config.transportFactory ?? createWebSocketTransportFactory(this.config.webSocketFactory ?? defaultWebSocketFactory);
      let transportFactory = baseTransportFactory;
      if (this.config.e2ee?.enabled === true && isRelayClientWebSocketUrl(this.config.url)) {
        const daemonPublicKeyB64 = this.config.e2ee.daemonPublicKeyB64;
        if (!daemonPublicKeyB64) {
          throw new Error("daemonPublicKeyB64 is required for relay E2EE");
        }
        transportFactory = createRelayE2eeTransportFactory({
          baseFactory: baseTransportFactory,
          daemonPublicKeyB64,
          logger: this.logger
        });
      }
      const transport = transportFactory({
        url: this.config.url,
        headers,
        ...protocols ? { protocols } : {}
      });
      this.transport = transport;
      this.updateConnectionState({ status: "connecting", attempt: this.reconnectAttempt }, { event: "CONNECT_REQUEST" });
      this.resetConnectTimeout();
      const timeoutMs = Math.max(1, this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
      this.connectTimeout = setTimeout(() => {
        if (this.connectionState.status !== "connecting")
          return;
        this.lastErrorValue = "Connection timed out";
        this.disposeTransport(1001, "Connection timed out");
        this.scheduleReconnect({
          reason: "Connection timed out",
          event: "CONNECT_TIMEOUT",
          reasonCode: "connect_timeout"
        });
      }, timeoutMs);
      this.bindTransport(transport);
    } catch (error) {
      this.resetConnectTimeout();
      const message = error instanceof Error ? error.message : "Failed to connect";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "CONNECT_FAILED",
        reasonCode: "connect_failed"
      });
      if (this.connectReject) {
        this.rejectConnect(error instanceof Error ? error : new Error(message));
      }
    }
  }
  bindTransport(transport) {
    this.transportCleanup = [
      transport.onOpen(() => {
        if (this.transport !== transport)
          return;
        this.clearPendingGenericTransportError();
        this.lastErrorValue = null;
        this.sendHelloMessage();
      }),
      transport.onClose((event) => {
        if (this.transport !== transport)
          return;
        this.resetConnectTimeout();
        this.clearPendingGenericTransportError();
        const reason = describeTransportClose(event);
        if (reason)
          this.lastErrorValue = reason;
        this.scheduleReconnect({
          reason,
          event: "TRANSPORT_CLOSE",
          reasonCode: "transport_closed"
        });
      }),
      transport.onError((event) => {
        if (this.transport !== transport)
          return;
        this.resetConnectTimeout();
        const reason = describeTransportError(event);
        if (reason === "Transport error") {
          this.lastErrorValue ?? (this.lastErrorValue = reason);
          if (!this.pendingGenericTransportErrorTimeout) {
            this.pendingGenericTransportErrorTimeout = setTimeout(() => {
              this.pendingGenericTransportErrorTimeout = null;
              if (this.isConnected || this.isConnecting) {
                this.lastErrorValue = reason;
                this.scheduleReconnect({
                  reason,
                  event: "TRANSPORT_ERROR",
                  reasonCode: "transport_error"
                });
              }
            }, 250);
          }
          return;
        }
        this.clearPendingGenericTransportError();
        this.lastErrorValue = reason;
        this.scheduleReconnect({
          reason,
          event: "TRANSPORT_ERROR",
          reasonCode: "transport_error"
        });
      }),
      transport.onMessage((data) => this.handleTransportData(data, transport))
    ];
  }
  handleTransportData(data, expectedTransport) {
    if (this.transport !== expectedTransport)
      return;
    const rawData = data && typeof data === "object" && "data" in data ? data.data : data;
    if (typeof Blob !== "undefined" && rawData instanceof Blob && typeof rawData.arrayBuffer === "function") {
      void rawData.arrayBuffer().then((buffer) => {
        if (this.transport === expectedTransport)
          this.callbacks.onMessage(buffer);
        return void 0;
      }).catch(() => void 0);
      return;
    }
    if (typeof rawData === "string") {
      try {
        const parsed = JSON.parse(rawData);
        if (this.handleRelayDeviceAuthResultMessage(parsed)) {
          return;
        }
      } catch {
      }
    }
    this.callbacks.onMessage(rawData);
  }
  handleRelayDeviceAuthResultMessage(raw) {
    if (!raw || typeof raw !== "object") {
      return false;
    }
    const message = raw;
    if (message.type !== "relay_device_auth_result") {
      return false;
    }
    this.config.onRelayDeviceAuthResult?.({
      ok: message.ok === true,
      ...typeof message.deviceId === "string" ? { deviceId: message.deviceId } : {},
      ...typeof message.deviceSecret === "string" ? { deviceSecret: message.deviceSecret } : {},
      ...typeof message.reason === "string" ? { reason: message.reason } : {},
      ...message.securityLevel === "v2" || message.securityLevel === "legacy" ? { securityLevel: message.securityLevel } : {}
    });
    return true;
  }
  sendHelloMessage() {
    if (!this.transport) {
      this.scheduleReconnect({
        reason: "Transport unavailable before hello",
        event: "HELLO_TRANSPORT_MISSING",
        reasonCode: "transport_error"
      });
      return;
    }
    try {
      const relayDeviceAuth = this.buildRelayDeviceAuth();
      this.transport.send(JSON.stringify({
        type: "hello",
        clientId: this.config.clientId,
        clientType: this.config.clientType ?? "cli",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.customModeIcons]: true,
          [CLIENT_CAPS.reasoningMergeEnum]: true,
          [CLIENT_CAPS.generativeUi]: true,
          // COMPAT(cindyModules): added in v0.1.102; advertise so goal/team/learn RPCs are accepted.
          [CLIENT_CAPS.cindyModules]: true
        },
        ...this.config.appVersion ? { appVersion: this.config.appVersion } : {},
        ...relayDeviceAuth ? { relayDeviceAuth } : {}
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send hello message";
      this.lastErrorValue = message;
      this.scheduleReconnect({
        reason: message,
        event: "HELLO_SEND_FAILED",
        reasonCode: "transport_error"
      });
    }
  }
  buildRelayDeviceAuth() {
    const credential = this.config.relayDeviceAuth;
    const context = this.transport?.getRelaySecurityContext?.();
    if (!credential || !context?.authChallenge) {
      return null;
    }
    const channelBinding = {
      clientPublicKeyB64: context.clientPublicKeyB64,
      challenge: context.authChallenge
    };
    if (credential.deviceSecret) {
      return {
        version: 1,
        deviceId: credential.deviceId,
        proof: computeClientRelayDeviceAuthProof(credential.deviceSecret, {
          serverId: credential.serverId,
          daemonPublicKeyB64: this.config.e2ee?.daemonPublicKeyB64 ?? "",
          clientPublicKeyB64: channelBinding.clientPublicKeyB64,
          deviceId: credential.deviceId,
          challenge: channelBinding.challenge
        }),
        ...channelBinding
      };
    }
    if (credential.pairingToken) {
      return {
        version: 1,
        deviceId: credential.deviceId,
        pairingToken: credential.pairingToken,
        ...credential.deviceName ? { deviceName: credential.deviceName } : {},
        ...channelBinding
      };
    }
    return null;
  }
  scheduleReconnect(input) {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const wasDisposed = this.connectionState.status === "disposed";
    const reason = input?.reason;
    if (typeof reason === "string" && reason.trim().length > 0) {
      this.lastErrorValue = reason.trim();
    }
    const error = new Error(reason ?? "Connection lost");
    this.rejectLivenessProbe(error);
    this.callbacks.onReset(error, false);
    if (wasDisposed) {
      this.rejectConnect(new Error(reason ?? "Daemon client is disposed"));
      return;
    }
    this.updateConnectionState({ status: "disconnected", ...reason ? { reason } : {} }, {
      event: input?.event ?? "TRANSPORT_CLOSE",
      ...reason ? { reason } : {},
      ...input?.reasonCode ? { reasonCode: input.reasonCode } : {}
    });
    if (!this.shouldReconnect || this.config.reconnect?.enabled === false) {
      this.rejectConnect(new Error(reason ?? "Transport disconnected before connect"));
      return;
    }
    this.armReconnectTimer();
  }
  armReconnectTimer() {
    const attempt = this.reconnectAttempt;
    const baseDelay = this.config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
    this.reconnectAttempt = attempt + 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect)
        this.attemptConnect();
    }, delay);
  }
  recordLivenessFailure(error) {
    this.consecutiveLivenessFailures += 1;
    if (this.consecutiveLivenessFailures < LIVENESS_FAILURE_RECONNECT_THRESHOLD)
      return;
    this.consecutiveLivenessFailures = 0;
    this.lastErrorValue = error.message;
    this.disposeTransport(1001, "Liveness check timed out");
    this.scheduleReconnect({
      reason: error.message,
      event: "LIVENESS_TIMEOUT",
      reasonCode: "liveness_timeout"
    });
  }
  clearLivenessProbe() {
    const probe = this.livenessProbe;
    if (!probe)
      return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
  }
  rejectLivenessProbe(error) {
    const probe = this.livenessProbe;
    if (!probe)
      return;
    this.livenessProbe = null;
    clearTimeout(probe.timeoutHandle);
    probe.reject(error);
  }
  resolveConnect() {
    this.connectResolve?.();
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }
  rejectConnect(error) {
    this.connectReject?.(error);
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
  }
  disposeTransport(code = 1001, reason = "Reconnecting") {
    this.cleanupTransport();
    const transport = this.transport;
    this.transport = null;
    if (!transport)
      return;
    try {
      transport.close(code, reason);
    } catch {
    }
  }
  cleanupTransport() {
    this.resetConnectTimeout();
    this.clearPendingGenericTransportError();
    for (const cleanup of this.transportCleanup) {
      try {
        cleanup();
      } catch {
      }
    }
    this.transportCleanup = [];
  }
  clearPendingGenericTransportError() {
    if (!this.pendingGenericTransportErrorTimeout)
      return;
    clearTimeout(this.pendingGenericTransportErrorTimeout);
    this.pendingGenericTransportErrorTimeout = null;
  }
  resetConnectTimeout() {
    if (!this.connectTimeout)
      return;
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }
  updateConnectionState(next, metadata) {
    const previous = this.connectionState;
    this.connectionState = next;
    const reasonFromNext = next.status === "disconnected" && typeof next.reason === "string" ? next.reason : null;
    const reason = metadata?.reason ?? reasonFromNext;
    const reasonCode = metadata?.reasonCode ?? toReasonCode(reason);
    this.logger.debug({
      serverId: this.serverId,
      clientIdHash: this.clientIdHash,
      from: previous.status,
      to: next.status,
      event: metadata?.event ?? "STATE_UPDATE",
      connectionPath: this.connectionPath,
      generation: this.generation,
      reasonCode,
      reason
    }, "DaemonClientTransition");
    for (const listener of this.connectionListeners) {
      try {
        listener(next);
      } catch {
      }
    }
  }
};
function normalizePassword(value) {
  if (typeof value !== "string")
    return null;
  return value.length > 0 ? value : null;
}
function normalizeClientId(value) {
  if (typeof value !== "string")
    return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
function hashForLog(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = hash * 31 + value.charCodeAt(index) | 0;
  }
  return "h_" + Math.abs(hash).toString(16);
}
function toReasonCode(reason) {
  if (!reason)
    return null;
  const normalized = reason.toLowerCase();
  if (normalized.includes("timed out"))
    return "connect_timeout";
  if (normalized.includes("disposed"))
    return "disposed";
  if (normalized.includes("client closed"))
    return "client_closed";
  if (normalized.includes("transport"))
    return "transport_error";
  if (normalized.includes("failed to connect"))
    return "connect_failed";
  return "unknown";
}

// vendor/chisacode-remote/packages/client/dist/daemon-client-inbound-controller.js
var perfNow2 = typeof performance !== "undefined" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();
var DaemonClientInboundController = class {
  constructor(options) {
    this.options = options;
    this.rawMessageListeners = /* @__PURE__ */ new Set();
    this.messageHandlers = /* @__PURE__ */ new Map();
    this.eventListeners = /* @__PURE__ */ new Set();
    this.lastServerInfoMessage = null;
  }
  subscribe(handler) {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }
  subscribeRaw(handler) {
    this.rawMessageListeners.add(handler);
    return () => {
      this.rawMessageListeners.delete(handler);
    };
  }
  subscribeMessage(type, handler) {
    const normalizedHandler = handler;
    let handlers = this.messageHandlers.get(type);
    if (!handlers) {
      handlers = /* @__PURE__ */ new Set();
      this.messageHandlers.set(type, handlers);
    }
    handlers.add(normalizedHandler);
    return () => {
      const currentHandlers = this.messageHandlers.get(type);
      if (!currentHandlers) {
        return;
      }
      currentHandlers.delete(normalizedHandler);
      if (currentHandlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    };
  }
  getLastServerInfoMessage() {
    return this.lastServerInfoMessage;
  }
  supportsGenerativeUi() {
    return this.lastServerInfoMessage?.features?.generativeUi === true;
  }
  reset() {
    this.lastServerInfoMessage = null;
  }
  handle(rawData) {
    const rawBytes = asUint8Array(rawData);
    if (rawBytes && this.tryHandleBinaryFrame(rawBytes)) {
      return;
    }
    const payload = decodeMessageData(rawData);
    if (!payload) {
      return;
    }
    this.handleJsonPayload(payload, rawBytes?.byteLength);
  }
  handleJsonPayload(payload, rawBytesLength) {
    const bytes = rawBytesLength ?? payload.length;
    const startMs = perfNow2();
    let parsedJson;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    }
    const parsed = WSOutboundMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const msgType2 = parsedJson != null && typeof parsedJson === "object" && "type" in parsedJson && typeof parsedJson.type === "string" ? parsedJson.type : "unknown";
      this.options.logger.warn({ msgType: msgType2, error: parsed.error.message }, "Message validation failed");
      return;
    }
    this.options.onInboundActivity();
    const metrics = this.options.getRuntimeMetrics();
    if (parsed.data.type === "pong") {
      this.options.resolvePong();
      metrics?.recordMessage("pong", bytes, perfNow2() - startMs);
      return;
    }
    if (parsed.data.type === "relay_device_auth_result") {
      this.options.onRelayDeviceAuthResult?.(parsed.data);
      metrics?.recordMessage("relay_device_auth_result", bytes, perfNow2() - startMs);
      return;
    }
    this.handleSessionMessage(parsed.data.message);
    const msgType = parsed.data.message.type;
    metrics?.recordMessage(msgType, bytes, perfNow2() - startMs);
    if (parsed.data.message.type === "agent_stream") {
      metrics?.recordAgentStream(parsed.data.message.payload);
    }
  }
  tryHandleBinaryFrame(rawBytes) {
    const fileFrame = decodeFileTransferFrame(rawBytes);
    if (fileFrame) {
      this.handleFileTransferFrame(fileFrame);
      this.options.getRuntimeMetrics()?.recordBinaryFrame("other", rawBytes.byteLength, 0);
      return true;
    }
    const frame = decodeTerminalStreamFrame(rawBytes);
    if (!frame) {
      return false;
    }
    const binaryStartMs = perfNow2();
    this.options.onTerminalFrame(frame);
    let frameKind = "other";
    if (frame.opcode === TerminalStreamOpcode.Output) {
      frameKind = "output";
    } else if (frame.opcode === TerminalStreamOpcode.Snapshot) {
      frameKind = "snapshot";
    } else if (frame.opcode === TerminalStreamOpcode.Restore) {
      frameKind = "output";
    }
    this.options.getRuntimeMetrics()?.recordBinaryFrame(frameKind, rawBytes.byteLength, perfNow2() - binaryStartMs);
    return true;
  }
  handleFileTransferFrame(frame) {
    const outcome = this.options.fileTransfers.handleFrame(frame);
    if (!outcome) {
      return;
    }
    this.handleSessionMessage({
      type: "file_explorer_response",
      payload: {
        cwd: outcome.cwd,
        path: outcome.path,
        mode: "file",
        directory: null,
        file: null,
        error: outcome.error,
        requestId: outcome.requestId
      }
    });
  }
  handleSessionMessage(message) {
    if (message.type === "status") {
      const serverInfo = parseServerInfoStatusPayload(message.payload);
      if (serverInfo) {
        this.lastServerInfoMessage = serverInfo;
        if (this.options.isConnecting()) {
          this.options.markConnected();
        }
      }
    }
    if (message.type === "terminal_stream_exit") {
      this.options.onTerminalStreamExit(message.payload.terminalId);
    }
    for (const handler of this.rawMessageListeners) {
      try {
        handler(message);
      } catch {
      }
    }
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
        }
      }
    }
    const event = this.toEvent(message);
    if (event) {
      for (const handler of this.eventListeners) {
        try {
          handler(event);
        } catch (error) {
          this.options.logger.warn({ err: error, eventType: event.type }, "Daemon event listener failed");
        }
      }
    }
    this.options.onRequestMessage(message);
  }
  toEvent(message) {
    switch (message.type) {
      case "agent_update":
        return {
          type: "agent_update",
          agentId: message.payload.kind === "upsert" ? message.payload.agent.id : message.payload.agentId,
          payload: message.payload
        };
      case "workspace_update":
        return {
          type: "workspace_update",
          workspaceId: message.payload.kind === "upsert" ? message.payload.workspace.id : message.payload.id,
          payload: message.payload
        };
      case "workspace_setup_progress":
        return {
          type: "workspace_setup_progress",
          workspaceId: message.payload.workspaceId,
          payload: message.payload
        };
      case "agent_stream":
        return {
          type: "agent_stream",
          agentId: message.payload.agentId,
          event: message.payload.event,
          timestamp: message.payload.timestamp,
          ...typeof message.payload.seq === "number" ? { seq: message.payload.seq } : {},
          ...typeof message.payload.epoch === "string" ? { epoch: message.payload.epoch } : {}
        };
      case "status":
        return { type: "status", payload: message.payload };
      case "agent_deleted":
        return { type: "agent_deleted", agentId: message.payload.agentId };
      case "agent_permission_request":
        return {
          type: "agent_permission_request",
          agentId: message.payload.agentId,
          request: message.payload.request
        };
      case "agent_permission_resolved":
        return {
          type: "agent_permission_resolved",
          agentId: message.payload.agentId,
          requestId: message.payload.requestId,
          resolution: message.payload.resolution
        };
      case "providers_snapshot_update":
        return {
          type: "providers_snapshot_update",
          payload: message.payload
        };
      default:
        return null;
    }
  }
};

// vendor/chisacode-remote/packages/client/dist/daemon-client-agent-waits.js
var AgentWaitClient = class {
  constructor(options) {
    this.options = options;
  }
  async respondToPermission(agentId, requestId, response) {
    this.options.sendMessage({
      type: "agent_permission_response",
      agentId,
      requestId,
      response
    });
  }
  async respondToPermissionAndWait(agentId, requestId, response, timeout = 15e3) {
    const message = SessionInboundMessageSchema.parse({
      type: "agent_permission_response",
      agentId,
      requestId,
      response
    });
    return this.options.requests.request({
      requestId,
      message,
      timeout,
      options: { skipQueue: true },
      select: (candidate) => {
        if (candidate.type !== "agent_permission_resolved") {
          return null;
        }
        if (candidate.payload.requestId !== requestId) {
          return null;
        }
        if (candidate.payload.agentId !== agentId) {
          return null;
        }
        return candidate.payload;
      }
    });
  }
  async waitForAgentUpsert(agentId, predicate, timeout = 6e4) {
    const initialResult = await this.options.fetchAgent(agentId).catch(() => null);
    if (initialResult && predicate(initialResult.agent)) {
      return initialResult.agent;
    }
    const deadline = Date.now() + timeout;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      let pollTimer = null;
      let timeoutTimer = null;
      let unsubscribe = null;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (result.kind === "ok") {
          resolve(result.snapshot);
          return;
        }
        reject(result.error);
      };
      const maybeResolve = (snapshot) => {
        if (!snapshot) {
          return false;
        }
        let matches;
        try {
          matches = predicate(snapshot);
        } catch (error) {
          finish({ kind: "error", error: toError(error) });
          return true;
        }
        if (!matches) {
          return false;
        }
        finish({ kind: "ok", snapshot });
        return true;
      };
      const poll = async () => {
        if (settled || pollInFlight) {
          return;
        }
        pollInFlight = true;
        try {
          const result = await this.options.fetchAgent(agentId).catch(() => null);
          maybeResolve(result?.agent ?? null);
        } finally {
          pollInFlight = false;
        }
      };
      unsubscribe = this.options.subscribeAgentUpdates((message) => {
        if (settled || message.payload.kind !== "upsert") {
          return;
        }
        const snapshot = message.payload.agent;
        if (snapshot.id !== agentId) {
          return;
        }
        maybeResolve(snapshot);
      });
      const remaining = Math.max(1, deadline - Date.now());
      timeoutTimer = setTimeout(() => {
        finish({
          kind: "error",
          error: new Error(`Timed out waiting for agent ${agentId}`)
        });
      }, remaining);
      pollTimer = setInterval(() => {
        void poll();
      }, 250);
      void poll();
    });
  }
  async waitForFinish(agentId, timeout = 6e4) {
    const requestId = this.options.createRequestId();
    const hasTimeout = Number.isFinite(timeout) && timeout > 0;
    const message = SessionInboundMessageSchema.parse({
      type: "wait_for_finish_request",
      requestId,
      agentId,
      ...hasTimeout ? { timeoutMs: timeout } : {}
    });
    const payload = await this.options.requests.requestCorrelated({
      requestId,
      message,
      responseType: "wait_for_finish_response",
      timeout: hasTimeout ? timeout + 5e3 : 0,
      options: { skipQueue: true }
    });
    return {
      status: payload.status,
      final: payload.final,
      error: payload.error,
      lastMessage: payload.lastMessage
    };
  }
};
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

// vendor/chisacode-remote/packages/client/dist/daemon-client.js
var consoleLogger = {
  debug: () => {
  },
  info: (obj, msg) => console.log(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj)
};
var DaemonClient = class {
  constructor(config) {
    this.binaryFileTransfers = new BinaryFileTransferManager();
    this.runtimeMetricsInterval = null;
    this.runtimeMetrics = null;
    this.logger = config.logger ?? consoleLogger;
    this.connection = new DaemonConnectionController(config, this.logger, {
      onMessage: (data) => this.inbound.handle(data),
      onConnected: () => {
        this.checkoutSubscriptions.resubscribe();
        this.terminalClient.resubscribeDirectories();
        void this.terminalClient.resubscribeStreams();
        this.requests.flushPendingSends();
      },
      onReset: (error, terminal) => this.handleConnectionReset(error, terminal)
    });
    this.requests = new DaemonRequestCoordinator({
      createRequestId: (requestId) => this.createRequestId(requestId),
      getConnectionStatus: () => this.connection.getState().status,
      sendConnectedMessage: (message) => this.connection.sendSessionMessageStrict(message)
    });
    this.checkoutCommands = new CheckoutCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.checkoutSubscriptions = new CheckoutSubscriptionClient({
      createRequestId: (requestId) => this.createRequestId(requestId),
      sendRequest: (params) => this.requests.request(params),
      sendMessage: (message) => this.connection.sendSessionMessage(message)
    });
    this.configCommands = new ConfigCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.providerCommands = new ProviderCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.agentExtensionCommands = new AgentExtensionCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.automationCommands = new AutomationCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.cindyCommands = new CindyCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.workspaceCommands = new WorkspaceCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.queryCommands = new QueryCommandClient({
      request: (params) => this.requests.requestSession(params)
    });
    this.terminalClient = new TerminalClient({
      request: (params) => this.requests.requestSession(params),
      isConnected: () => this.connection.isConnected,
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      sendBinaryFrame: (frame) => this.connection.sendBinaryFrame(frame)
    });
    this.voiceClient = new VoiceClient({
      request: (params) => this.requests.requestSession(params),
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      sendStrictMessage: (message) => this.connection.sendSessionMessageStrict(message),
      waitFor: (predicate, timeout) => this.requests.waitForWithCancel(predicate, timeout, { skipQueue: true })
    });
    this.agentLifecycle = new AgentLifecycleClient({
      request: (params) => this.requests.requestSession(params),
      createRequestId: (requestId) => this.createRequestId(requestId),
      requestStatus: (params) => this.requests.request({ ...params, options: { skipQueue: true } })
    });
    this.agentInteraction = new AgentInteractionClient({
      request: (params) => this.requests.requestSession(params),
      createRequestId: (requestId) => this.createRequestId(requestId),
      supportsGenerativeUi: () => this.inbound.supportsGenerativeUi()
    });
    this.inbound = new DaemonClientInboundController({
      fileTransfers: this.binaryFileTransfers,
      getRuntimeMetrics: () => this.runtimeMetrics,
      isConnecting: () => this.connection.isConnecting,
      logger: this.logger,
      markConnected: () => this.connection.markConnected(),
      onInboundActivity: () => this.connection.recordInboundActivity(),
      onRequestMessage: (message) => this.requests.handleMessage(message),
      onTerminalFrame: (frame) => this.terminalClient.handleFrame(frame),
      onTerminalStreamExit: (terminalId) => this.terminalClient.handleStreamExit(terminalId),
      resolvePong: () => this.connection.resolvePong()
    });
    this.agentWaits = new AgentWaitClient({
      createRequestId: (requestId) => this.createRequestId(requestId),
      fetchAgent: (agentId) => this.agentLifecycle.fetchAgent(agentId),
      requests: this.requests,
      sendMessage: (message) => this.connection.sendSessionMessage(message),
      subscribeAgentUpdates: (handler) => this.inbound.subscribeMessage("agent_update", handler)
    });
    const runtimeMetricsIntervalMs = typeof config.runtimeMetricsIntervalMs === "number" && config.runtimeMetricsIntervalMs > 0 ? config.runtimeMetricsIntervalMs : 0;
    if (runtimeMetricsIntervalMs > 0) {
      const runtimeMetricsWindowMs = typeof config.runtimeMetricsWindowMs === "number" && config.runtimeMetricsWindowMs > 0 ? Math.max(config.runtimeMetricsWindowMs, runtimeMetricsIntervalMs) : void 0;
      this.runtimeMetrics = new DaemonClientRuntimeMetrics(this.logger, {
        connectionPath: this.connection.connectionPath,
        serverId: this.connection.serverId,
        getConnectionStatus: () => this.connection.getState().status
      }, runtimeMetricsWindowMs ? { windowMs: runtimeMetricsWindowMs } : void 0);
      this.runtimeMetricsInterval = setInterval(() => {
        this.runtimeMetrics?.flush();
      }, runtimeMetricsIntervalMs);
    }
  }
  // ============================================================================
  // Connection
  // ============================================================================
  async connect() {
    return this.connection.connect();
  }
  async close() {
    return this.connection.close();
  }
  ensureConnected() {
    this.connection.ensureConnected();
  }
  getConnectionState() {
    return this.connection.getState();
  }
  subscribeConnectionStatus(listener) {
    return this.connection.subscribe(listener);
  }
  get isConnected() {
    return this.connection.isConnected;
  }
  get isConnecting() {
    return this.connection.isConnecting;
  }
  get lastError() {
    return this.connection.lastError;
  }
  // ============================================================================
  // Message Subscription
  // ============================================================================
  subscribe(handler) {
    return this.inbound.subscribe(handler);
  }
  subscribeRawMessages(handler) {
    return this.inbound.subscribeRaw(handler);
  }
  on(arg1, arg2) {
    if (typeof arg1 === "function") {
      return this.subscribe(arg1);
    }
    return this.inbound.subscribeMessage(arg1, arg2);
  }
  // ============================================================================
  // Core Send Helpers
  // ============================================================================
  sendSessionMessage(message) {
    this.connection.sendSessionMessage(message);
  }
  async clearAgentAttention(agentId) {
    const requestId = this.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "clear_agent_attention",
      agentId,
      requestId
    });
    await this.requests.request({
      requestId,
      message,
      timeout: 15e3,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "clear_agent_attention_response") {
          return null;
        }
        if (msg.payload.requestId !== requestId) {
          return null;
        }
        return msg.payload;
      }
    });
  }
  sendHeartbeat(params) {
    this.sendSessionMessage({
      type: "client_heartbeat",
      deviceType: params.deviceType,
      focusedAgentId: params.focusedAgentId,
      lastActivityAt: params.lastActivityAt,
      appVisible: params.appVisible,
      appVisibilityChangedAt: params.appVisibilityChangedAt
    });
  }
  registerPushToken(token) {
    this.sendSessionMessage({
      type: "register_push_token",
      token
    });
  }
  async ping(params) {
    const requestId = params?.requestId ?? `ping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientSentAt = Date.now();
    const payload = await this.requests.request({
      requestId,
      message: { type: "ping", requestId, clientSentAt },
      timeout: params?.timeoutMs ?? 5e3,
      select: (msg) => {
        if (msg.type !== "pong")
          return null;
        if (msg.payload.requestId !== requestId)
          return null;
        if (typeof msg.payload.serverReceivedAt !== "number")
          return null;
        if (typeof msg.payload.serverSentAt !== "number")
          return null;
        return msg.payload;
      }
    });
    return {
      requestId,
      clientSentAt,
      serverReceivedAt: payload.serverReceivedAt,
      serverSentAt: payload.serverSentAt,
      rttMs: Date.now() - clientSentAt
    };
  }
  checkLiveness(params) {
    return this.connection.checkLiveness(params);
  }
  // ============================================================================
  // Agent RPCs (requestId-correlated)
  // ============================================================================
  async fetchAgents(options) {
    return this.queryCommands.fetchAgents(options);
  }
  async fetchAgentHistory(options) {
    return this.queryCommands.fetchAgentHistory(options);
  }
  async fetchRecentProviderSessions(options) {
    return this.queryCommands.fetchRecentProviderSessions(options);
  }
  async fetchUsageSummary(options) {
    return this.queryCommands.fetchUsageSummary(options);
  }
  async exportUsage(options) {
    return this.queryCommands.exportUsage(options);
  }
  async clearUsage(requestId) {
    return this.queryCommands.clearUsage(requestId);
  }
  async fetchWorkspaces(options) {
    return this.queryCommands.fetchWorkspaces(options);
  }
  async openProject(cwd, requestId) {
    return this.workspaceCommands.openProject(cwd, requestId);
  }
  async startWorkspaceScript(workspaceId, scriptName, requestId) {
    return this.workspaceCommands.startWorkspaceScript(workspaceId, scriptName, requestId);
  }
  async listAvailableEditors(requestId) {
    return this.workspaceCommands.listAvailableEditors(requestId);
  }
  async openInEditor(path, editorId, requestId) {
    return this.workspaceCommands.openInEditor(path, editorId, requestId);
  }
  async archiveWorkspace(workspaceId, requestId) {
    return this.workspaceCommands.archiveWorkspace(workspaceId, requestId);
  }
  async fetchWorkspaceSetupStatus(workspaceId, requestId) {
    return this.workspaceCommands.fetchWorkspaceSetupStatus(workspaceId, requestId);
  }
  async fetchAgent(agentId, requestId) {
    return this.agentLifecycle.fetchAgent(agentId, requestId);
  }
  // ============================================================================
  // Agent Lifecycle
  // ============================================================================
  async createAgent(options) {
    return this.agentLifecycle.createAgent(options);
  }
  async deleteAgent(agentId) {
    return this.agentLifecycle.deleteAgent(agentId);
  }
  async archiveAgent(agentId) {
    return this.agentLifecycle.archiveAgent(agentId);
  }
  async updateAgent(agentId, updates) {
    return this.agentLifecycle.updateAgent(agentId, updates);
  }
  async renameProject(projectId, customName, requestId) {
    return this.agentLifecycle.renameProject(projectId, customName, requestId);
  }
  async resumeAgent(handle, overrides) {
    return this.agentLifecycle.resumeAgent(handle, overrides);
  }
  async importAgent(input) {
    return this.agentLifecycle.importAgent(input);
  }
  async refreshAgent(agentId, requestId) {
    return this.agentLifecycle.refreshAgent(agentId, requestId);
  }
  async fetchAgentTimeline(agentId, options = {}) {
    return this.agentInteraction.fetchAgentTimeline(agentId, options);
  }
  // ============================================================================
  // Agent Interaction
  // ============================================================================
  async sendAgentMessage(agentId, text, options) {
    return this.agentInteraction.sendAgentMessage(agentId, text, options);
  }
  async sendMessage(agentId, text, options) {
    return this.sendAgentMessage(agentId, text, options);
  }
  /**
   * Sends a generative UI user-interaction callback to the server.
   * The server formats the action as system context and injects it into the
   * next turn's conversation.
   *
   * @param agentId Target agent session ID
   * @param instanceId Generative UI component instance ID
   * @param action Action name as defined in the component's actions
   * @param payload Action-specific payload
   * @param options Optional configuration (timeout etc.)
   * @throws {DaemonRpcError} If the server rejects the action or times out
   */
  async sendGenerativeUiAction(agentId, instanceId, action, payload, options) {
    return this.agentInteraction.sendGenerativeUiAction(agentId, instanceId, action, payload, options);
  }
  async rewindAgent(agentId, messageId, mode) {
    return this.agentLifecycle.rewindAgent(agentId, messageId, mode);
  }
  async cancelAgent(agentId) {
    return this.agentLifecycle.cancelAgent(agentId);
  }
  async setAgentMode(agentId, modeId) {
    return this.agentLifecycle.setAgentMode(agentId, modeId);
  }
  async setAgentModel(agentId, modelId, runtimeProvider) {
    return this.agentLifecycle.setAgentModel(agentId, modelId, runtimeProvider);
  }
  async setAgentFeature(agentId, featureId, value) {
    return this.agentLifecycle.setAgentFeature(agentId, featureId, value);
  }
  async setAgentThinkingOption(agentId, thinkingOptionId) {
    return this.agentLifecycle.setAgentThinkingOption(agentId, thinkingOptionId);
  }
  async restartServer(reason, requestId) {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "restart_server_request",
      ...reason && reason.trim().length > 0 ? { reason } : {},
      requestId: resolvedRequestId
    });
    return this.requests.request({
      requestId: resolvedRequestId,
      message,
      timeout: 1e4,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const restarted = RestartRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!restarted.success) {
          return null;
        }
        if (restarted.data.requestId !== resolvedRequestId) {
          return null;
        }
        return restarted.data;
      }
    });
  }
  async shutdownServer(requestId) {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "shutdown_server_request",
      requestId: resolvedRequestId
    });
    return this.requests.request({
      requestId: resolvedRequestId,
      message,
      timeout: 1e4,
      options: { skipQueue: true },
      select: (msg) => {
        if (msg.type !== "status") {
          return null;
        }
        const shutdown = ShutdownRequestedStatusPayloadSchema.safeParse(msg.payload);
        if (!shutdown.success) {
          return null;
        }
        if (shutdown.data.requestId !== resolvedRequestId) {
          return null;
        }
        return shutdown.data;
      }
    });
  }
  // ============================================================================
  // Audio / Voice
  // ============================================================================
  async setVoiceMode(enabled, agentId) {
    return this.voiceClient.setVoiceMode(enabled, agentId);
  }
  async sendVoiceAudioChunk(audio, format, isLast = false) {
    return this.voiceClient.sendVoiceAudioChunk(audio, format, isLast);
  }
  async startDictationStream(dictationId, format) {
    return this.voiceClient.startDictationStream(dictationId, format);
  }
  sendDictationStreamChunk(dictationId, seq, audio, format) {
    this.voiceClient.sendDictationStreamChunk(dictationId, seq, audio, format);
  }
  async finishDictationStream(dictationId, finalSeq) {
    return this.voiceClient.finishDictationStream(dictationId, finalSeq);
  }
  cancelDictationStream(dictationId) {
    this.voiceClient.cancelDictationStream(dictationId);
  }
  async abortRequest() {
    return this.voiceClient.abortRequest();
  }
  async audioPlayed(id) {
    return this.voiceClient.audioPlayed(id);
  }
  // ============================================================================
  // Git Operations
  // ============================================================================
  async getCheckoutStatus(cwd, options) {
    return this.checkoutSubscriptions.getStatus(cwd, options);
  }
  async getCheckoutDiff(cwd, compare, requestId) {
    return this.checkoutSubscriptions.getDiff(cwd, compare, requestId);
  }
  async subscribeCheckoutDiff(cwd, compare, options) {
    return this.checkoutSubscriptions.subscribe(cwd, compare, options);
  }
  unsubscribeCheckoutDiff(subscriptionId) {
    this.checkoutSubscriptions.unsubscribe(subscriptionId);
  }
  async checkoutCommit(cwd, input, requestId) {
    return this.checkoutCommands.checkoutCommit(cwd, input, requestId);
  }
  async checkoutMerge(cwd, input, requestId) {
    return this.checkoutCommands.checkoutMerge(cwd, input, requestId);
  }
  async checkoutMergeFromBase(cwd, input, requestId) {
    return this.checkoutCommands.checkoutMergeFromBase(cwd, input, requestId);
  }
  async checkoutPull(cwd, requestId) {
    return this.checkoutCommands.checkoutPull(cwd, requestId);
  }
  async checkoutPush(cwd, requestId) {
    return this.checkoutCommands.checkoutPush(cwd, requestId);
  }
  async checkoutRefresh(cwd, requestId) {
    return this.checkoutCommands.checkoutRefresh(cwd, requestId);
  }
  async checkoutPrCreate(cwd, input, requestId) {
    return this.checkoutCommands.checkoutPrCreate(cwd, input, requestId);
  }
  async checkoutPrMerge(cwd, input, requestId) {
    return this.checkoutCommands.checkoutPrMerge(cwd, input, requestId);
  }
  async checkoutGithubSetAutoMerge(cwd, input, requestId) {
    return this.checkoutCommands.checkoutGithubSetAutoMerge(cwd, input, requestId);
  }
  async checkoutPrStatus(cwd, requestId) {
    return this.checkoutCommands.checkoutPrStatus(cwd, requestId);
  }
  async pullRequestTimeline(input, requestId) {
    return this.checkoutCommands.pullRequestTimeline(input, requestId);
  }
  async checkoutSwitchBranch(cwd, branch, requestId) {
    return this.checkoutCommands.checkoutSwitchBranch(cwd, branch, requestId);
  }
  async renameBranch(input) {
    return this.checkoutCommands.renameBranch(input);
  }
  async stashSave(cwd, options, requestId) {
    return this.checkoutCommands.stashSave(cwd, options, requestId);
  }
  async stashPop(cwd, stashIndex, requestId) {
    return this.checkoutCommands.stashPop(cwd, stashIndex, requestId);
  }
  async stashList(cwd, options, requestId) {
    return this.checkoutCommands.stashList(cwd, options, requestId);
  }
  async getChisaCodeWorktreeList(input, requestId) {
    return this.checkoutCommands.getChisaCodeWorktreeList(input, requestId);
  }
  async archiveChisaCodeWorktree(input, requestId) {
    return this.checkoutCommands.archiveChisaCodeWorktree(input, requestId);
  }
  async createChisaCodeWorktree(input, requestId) {
    return this.checkoutCommands.createChisaCodeWorktree(input, requestId);
  }
  async validateBranch(options, requestId) {
    return this.checkoutCommands.validateBranch(options, requestId);
  }
  async getBranchSuggestions(options, requestId) {
    return this.checkoutCommands.getBranchSuggestions(options, requestId);
  }
  async searchGitHub(options, requestId) {
    return this.checkoutCommands.searchGitHub(options, requestId);
  }
  async getDirectorySuggestions(options, requestId) {
    return this.checkoutCommands.getDirectorySuggestions(options, requestId);
  }
  // ============================================================================
  // File Explorer
  // ============================================================================
  async requestFileExplorer(cwd, path, mode, requestId, acceptBinary = false) {
    const timeout = acceptBinary ? 15 * 6e4 : 1e4;
    return this.requests.requestSession({
      requestId,
      message: {
        type: "file_explorer_request",
        cwd,
        path,
        mode,
        ...acceptBinary ? { acceptBinary: true } : {}
      },
      responseType: "file_explorer_response",
      timeout
    });
  }
  async listDirectory(cwd, path, requestId) {
    return this.workspaceCommands.listDirectory(cwd, path, requestId);
  }
  async readFile(cwd, path, requestId) {
    const resolvedRequestId = this.createRequestId(requestId);
    this.binaryFileTransfers.startRead(resolvedRequestId, cwd, path);
    try {
      const payload = await this.requestFileExplorer(cwd, path, "file", resolvedRequestId, true);
      if (payload.error) {
        throw new Error(payload.error);
      }
      const binaryResult = this.binaryFileTransfers.takeCompletedRead(resolvedRequestId);
      if (binaryResult) {
        return binaryResult;
      }
      if (!payload.file) {
        throw new Error("File unavailable.");
      }
      return legacyExplorerFileToBytes(payload.file);
    } finally {
      this.binaryFileTransfers.cleanupRead(resolvedRequestId);
    }
  }
  async requestDownloadToken(cwd, path, requestId) {
    return this.workspaceCommands.requestDownloadToken(cwd, path, requestId);
  }
  async requestProjectIcon(cwd, requestId) {
    return this.workspaceCommands.requestProjectIcon(cwd, requestId);
  }
  // ============================================================================
  // Provider Models / Commands
  // ============================================================================
  async listProviderModels(provider, options) {
    return this.providerCommands.listProviderModels(provider, options);
  }
  async listProviderModes(provider, options) {
    return this.providerCommands.listProviderModes(provider, options);
  }
  async listProviderFeatures(draftConfig, options) {
    return this.providerCommands.listProviderFeatures(draftConfig, options);
  }
  async listAvailableProviders(options) {
    return this.providerCommands.listAvailableProviders(options);
  }
  async getProvidersSnapshot(options) {
    return this.providerCommands.getProvidersSnapshot(options);
  }
  async getDaemonConfig(requestId) {
    return this.configCommands.getDaemonConfig(requestId);
  }
  async getDaemonStatus(requestId) {
    return this.configCommands.getDaemonStatus(requestId);
  }
  async getDaemonPairingOffer(requestId) {
    return this.configCommands.getDaemonPairingOffer(requestId);
  }
  async patchDaemonConfig(config, requestId) {
    return this.configCommands.patchDaemonConfig(config, requestId);
  }
  async readProjectConfig(repoRoot, requestId) {
    return this.configCommands.readProjectConfig(repoRoot, requestId);
  }
  async writeProjectConfig(input) {
    return this.configCommands.writeProjectConfig(input);
  }
  async refreshProvidersSnapshot(options) {
    return this.providerCommands.refreshProvidersSnapshot(options);
  }
  async getProviderDiagnostic(provider, options) {
    return this.providerCommands.getProviderDiagnostic(provider, options);
  }
  /** Generates a bounded, redacted daemon troubleshooting report. */
  async getDiagnostics(options) {
    return this.providerCommands.getDiagnostics(options);
  }
  async runProviderToolingAction(provider, action, options) {
    return this.providerCommands.runProviderToolingAction(provider, action, options);
  }
  async listAgentPresets(options) {
    return this.providerCommands.listAgentPresets(options);
  }
  async runModelGatewayMoaTest(input) {
    return this.providerCommands.runModelGatewayMoaTest(input);
  }
  async runModelGatewayTest(input) {
    return this.providerCommands.runModelGatewayTest(input);
  }
  async listCommands(agentId, requestIdOrOptions) {
    return this.agentExtensionCommands.listCommands(agentId, requestIdOrOptions);
  }
  async listAgentSkills(options) {
    return this.agentExtensionCommands.listAgentSkills(options);
  }
  async patchAgentSkillPolicy(input) {
    return this.agentExtensionCommands.patchAgentSkillPolicy(input);
  }
  async installAgentSkills(input) {
    return this.agentExtensionCommands.installAgentSkills(input);
  }
  async uninstallAgentSkill(input) {
    return this.agentExtensionCommands.uninstallAgentSkill(input);
  }
  async listAgentMcpServers(options) {
    return this.agentExtensionCommands.listAgentMcpServers(options);
  }
  async upsertAgentMcpServer(input) {
    return this.agentExtensionCommands.upsertAgentMcpServer(input);
  }
  async patchAgentMcpServerPolicy(input) {
    return this.agentExtensionCommands.patchAgentMcpServerPolicy(input);
  }
  async deleteAgentMcpServer(input) {
    return this.agentExtensionCommands.deleteAgentMcpServer(input);
  }
  // ============================================================================
  // Permissions
  // ============================================================================
  async respondToPermission(agentId, requestId, response) {
    return this.agentWaits.respondToPermission(agentId, requestId, response);
  }
  async respondToPermissionAndWait(agentId, requestId, response, timeout = 15e3) {
    return this.agentWaits.respondToPermissionAndWait(agentId, requestId, response, timeout);
  }
  // ============================================================================
  // Waiting / Streaming Helpers
  // ============================================================================
  async waitForAgentUpsert(agentId, predicate, timeout = 6e4) {
    return this.agentWaits.waitForAgentUpsert(agentId, predicate, timeout);
  }
  async waitForFinish(agentId, timeout = 6e4) {
    return this.agentWaits.waitForFinish(agentId, timeout);
  }
  // ============================================================================
  // Terminals
  // ============================================================================
  subscribeTerminals(input) {
    this.terminalClient.subscribeDirectories(input);
  }
  unsubscribeTerminals(input) {
    this.terminalClient.unsubscribeDirectories(input);
  }
  async listTerminals(cwd, requestId) {
    return this.terminalClient.listTerminals(cwd, requestId);
  }
  async createTerminal(cwd, name, requestId, options) {
    return this.terminalClient.createTerminal(cwd, name, requestId, options);
  }
  async renameTerminal(input) {
    return this.terminalClient.renameTerminal(input);
  }
  async subscribeTerminal(terminalId, optionsOrRequestId) {
    return this.terminalClient.subscribeTerminal(terminalId, optionsOrRequestId);
  }
  unsubscribeTerminal(terminalId) {
    this.terminalClient.unsubscribeTerminal(terminalId);
  }
  sendTerminalInput(terminalId, message) {
    this.terminalClient.sendInput(terminalId, message);
  }
  async killTerminal(terminalId, requestId) {
    return this.terminalClient.killTerminal(terminalId, requestId);
  }
  async closeItems(input, requestId) {
    const resolvedRequestId = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "close_items_request",
      agentIds: input.agentIds ?? [],
      terminalIds: input.terminalIds ?? [],
      requestId: resolvedRequestId
    });
    return this.requests.requestCorrelated({
      requestId: resolvedRequestId,
      message,
      responseType: "close_items_response",
      timeout: 6e4,
      options: { skipQueue: true }
    });
  }
  async captureTerminal(terminalId, options, requestId) {
    return this.terminalClient.captureTerminal(terminalId, options, requestId);
  }
  async createChatRoom(options) {
    return this.automationCommands.createChatRoom(options);
  }
  async listChatRooms(requestId) {
    return this.automationCommands.listChatRooms(requestId);
  }
  async inspectChatRoom(options) {
    return this.automationCommands.inspectChatRoom(options);
  }
  async deleteChatRoom(options) {
    return this.automationCommands.deleteChatRoom(options);
  }
  async postChatMessage(options) {
    return this.automationCommands.postChatMessage(options);
  }
  async readChatMessages(options) {
    return this.automationCommands.readChatMessages(options);
  }
  async waitForChatMessages(options) {
    return this.automationCommands.waitForChatMessages(options);
  }
  async scheduleCreate(options) {
    return this.automationCommands.scheduleCreate(options);
  }
  async scheduleList(requestId) {
    return this.automationCommands.scheduleList(requestId);
  }
  async scheduleInspect(options) {
    return this.automationCommands.scheduleInspect(options);
  }
  async scheduleLogs(options) {
    return this.automationCommands.scheduleLogs(options);
  }
  async schedulePause(options) {
    return this.automationCommands.schedulePause(options);
  }
  async scheduleResume(options) {
    return this.automationCommands.scheduleResume(options);
  }
  async scheduleDelete(options) {
    return this.automationCommands.scheduleDelete(options);
  }
  async scheduleRunOnce(options) {
    return this.automationCommands.scheduleRunOnce(options);
  }
  async scheduleUpdate(options) {
    return this.automationCommands.scheduleUpdate(options);
  }
  async loopRun(options) {
    return this.automationCommands.loopRun(options);
  }
  async loopList(requestId) {
    return this.automationCommands.loopList(requestId);
  }
  async loopInspect(options) {
    return this.automationCommands.loopInspect(options);
  }
  async loopLogs(options, afterSeq) {
    return this.automationCommands.loopLogs(options, afterSeq);
  }
  async loopStop(options) {
    return this.automationCommands.loopStop(options);
  }
  /** Cindy-module commands: goal, team, context, snapshot, migration, learn. */
  get cindy() {
    return this.cindyCommands;
  }
  onTerminalStreamEvent(handler) {
    return this.terminalClient.onStreamEvent(handler);
  }
  async waitForTerminalStreamEvent(predicate, timeout = 5e3) {
    return this.terminalClient.waitForStreamEvent(predicate, timeout);
  }
  // ============================================================================
  // Internals
  // ============================================================================
  createRequestId(requestId) {
    return requestId ?? safeRandomId();
  }
  getLastServerInfoMessage() {
    return this.inbound.getLastServerInfoMessage();
  }
  setReconnectEnabled(enabled) {
    this.connection.setReconnectEnabled(enabled);
  }
  async hostRpc(method, payload, requestId) {
    const resolved = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "dshd.host.rpc.request",
      requestId: resolved,
      method,
      payload
    });
    return this.requests.request({
      requestId: resolved,
      message,
      timeout: 3e4,
      select: (msg) => {
        if (msg.type !== "dshd.host.rpc.response")
          return null;
        if (msg.payload.requestId !== resolved)
          return null;
        return msg.payload;
      }
    });
  }
  async gitRpc(action, cwd, payload, requestId) {
    const resolved = this.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "dshd.git.rpc.request",
      requestId: resolved,
      action,
      cwd,
      payload
    });
    return this.requests.request({
      requestId: resolved,
      message,
      timeout: 12e4,
      select: (msg) => {
        if (msg.type !== "dshd.git.rpc.response")
          return null;
        if (msg.payload.requestId !== resolved)
          return null;
        return msg.payload;
      }
    });
  }
  subscribeHostMux(onFrame) {
    const requestId = this.createRequestId();
    this.sendSessionMessage(SessionInboundMessageSchema.parse({
      type: "dshd.host.mux.subscribe",
      requestId
    }));
    const stop = this.on("dshd.host.mux.frame", (message) => {
      onFrame({
        rpcId: message.payload.rpcId,
        envelope: message.payload.envelope ?? null
      });
    });
    return () => {
      stop();
      this.sendSessionMessage(SessionInboundMessageSchema.parse({
        type: "dshd.host.mux.unsubscribe",
        requestId: this.createRequestId()
      }));
    };
  }
  handleConnectionReset(error, terminal) {
    this.requests.clear(error);
    this.terminalClient.clearStreamSlots();
    this.binaryFileTransfers.clearActiveTransfers();
    this.inbound.reset();
    if (!terminal || !this.runtimeMetricsInterval)
      return;
    clearInterval(this.runtimeMetricsInterval);
    this.runtimeMetricsInterval = null;
    this.runtimeMetrics?.flush({ final: true });
    this.runtimeMetrics = null;
  }
};

// vendor/chisacode-remote/packages/client/dist/index.js
function createChisaCodeClient(config) {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli"
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);
  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) => openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) => openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) => daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) => daemonClient.on("workspace_update", (message) => {
        handler(message.payload);
      })
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) => daemonClient.on("agent_update", (message) => {
        handler(message.payload);
      })
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      pi: (input) => providerConfig("pi", input),
      kimi: (input) => providerConfig("kimi", input),
      grokbuild: (input) => providerConfig("grokbuild", input),
      dsh: (input) => providerConfig("dsh", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) => daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      toolingAction: (provider, action, options) => daemonClient.runProviderToolingAction(provider, action, options),
      listPresets: (options) => daemonClient.listAgentPresets(options),
      subscribe: (handler) => daemonClient.on("providers_snapshot_update", (message) => {
        handler(message.payload);
      })
    },
    presets: {
      list: (options) => daemonClient.listAgentPresets(options)
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId)
    },
    diagnostics: {
      get: (options) => daemonClient.getDiagnostics(options)
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState()
  };
}
function createWorkspaceHandleFactory(daemonClient) {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;
    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          filter: { idPrefix: id },
          page: { limit: 25 }
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) => daemonClient.on("workspace_update", (message) => {
        const update = message.payload;
        if (update.kind === "upsert" && update.workspace.id === id) {
          latest = update.workspace;
          handler(update);
        }
        if (update.kind === "remove" && update.id === id) {
          latest = null;
          handler(update);
        }
      })
    };
  };
}
function createAgentHandleFactory(daemonClient) {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;
    const handle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) => daemonClient.on("agent_stream", (message) => {
          if (message.payload.agentId === id) {
            handler(message.payload);
          }
        })
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent(id, requestId);
        latest = result?.agent ?? null;
        return result;
      },
      send: (text, options) => daemonClient.sendAgentMessage(id, text, options),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) => daemonClient.on("agent_update", (message) => {
        const update = message.payload;
        if (update.kind === "upsert" && update.agent.id === id) {
          latest = update.agent;
          handler(update);
        }
        if (update.kind === "remove" && update.agentId === id) {
          latest = null;
          handler(update);
        }
      })
    };
    return handle;
  };
}
async function openWorkspace(daemonClient, createWorkspaceHandle, input, requestId) {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null
  };
}
function resolveWorkspaceId(workspace) {
  return typeof workspace === "string" ? workspace : workspace.id;
}
function providerConfig(provider, input = {}) {
  return {
    provider,
    ...input.model !== void 0 ? { model: input.model } : {},
    ...input.modeId !== void 0 ? { modeId: input.modeId } : {},
    ...input.thinkingOptionId !== void 0 ? { thinkingOptionId: input.thinkingOptionId } : {},
    ...input.featureValues !== void 0 ? { featureValues: input.featureValues } : {}
  };
}
function createGeneratedClientId() {
  const randomId = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `chisacode-sdk-${randomId}`;
}

// vendor/chisacode-remote/packages/protocol/dist/relay-device-auth.js
var RELAY_DEVICE_AUTH_VERSION2 = 1;
var RelayAuthBootstrapSchema = external_exports.object({
  version: external_exports.literal(RELAY_DEVICE_AUTH_VERSION2),
  /**
   * Enrollment credential from a one-time QR or a revocable persistent link.
   * Both exchange for an independent device secret over the encrypted channel.
   */
  pairingToken: external_exports.string().min(16).max(256),
  /**
   * Absolute expiry as unix epoch milliseconds.
   */
  expiresAtMs: external_exports.number().int().positive(),
  /** Missing means a short-lived one-time QR. Persistent links require explicit revocation. */
  kind: external_exports.enum(["persistent"]).optional()
});
var RelayDeviceAuthChallengeSchema = external_exports.object({
  type: external_exports.literal("relay_device_auth_challenge"),
  version: external_exports.literal(RELAY_DEVICE_AUTH_VERSION2),
  challenge: external_exports.string().min(16).max(256),
  serverId: external_exports.string().min(1)
});
var RelayDeviceAuthProofSchema = external_exports.object({
  type: external_exports.literal("relay_device_auth_proof"),
  version: external_exports.literal(RELAY_DEVICE_AUTH_VERSION2),
  deviceId: external_exports.string().min(8).max(128),
  /**
   * Base64url HMAC-SHA256 over the canonical transcript.
   */
  proof: external_exports.string().min(16).max(256),
  /**
   * When set, this is a first-time pairing exchange consuming the bootstrap token.
   */
  pairingToken: external_exports.string().min(16).max(256).optional()
});
var RelayDeviceAuthResultSchema = external_exports.object({
  type: external_exports.literal("relay_device_auth_result"),
  version: external_exports.literal(RELAY_DEVICE_AUTH_VERSION2),
  ok: external_exports.boolean(),
  /**
   * Issued only on successful first pairing. Never logged by callers.
   */
  deviceSecret: external_exports.string().min(32).max(256).optional(),
  reason: external_exports.string().max(200).optional(),
  securityLevel: external_exports.enum(["v2", "legacy"]).optional()
});

// vendor/chisacode-remote/packages/protocol/dist/connection-offer.js
var ConnectionOfferV2Schema = external_exports.object({
  v: external_exports.literal(2),
  serverId: external_exports.string().min(1),
  daemonPublicKeyB64: external_exports.string().min(1),
  relayAuthPublicKeyB64: external_exports.string().min(1).optional(),
  /**
   * Optional client-auth bootstrap for handshake v2. Old parsers ignore this
   * field (optional missing keys remain valid; unknown keys are stripped).
   */
  authBootstrap: RelayAuthBootstrapSchema.optional(),
  relay: external_exports.object({
    endpoint: external_exports.string().min(1),
    useTls: external_exports.boolean().optional()
  })
});
var ConnectionOfferSchema = ConnectionOfferV2Schema;
function decodeBase64UrlToUtf8(input) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function decodeOfferFragmentPayload(encoded) {
  const json = decodeBase64UrlToUtf8(encoded);
  return JSON.parse(json);
}
var OFFER_FRAGMENT_PREFIX = "#offer=";
function extractOfferFragmentEncoded(input) {
  const trimmed = input.trim();
  if (!trimmed)
    return null;
  const fragmentIndex = trimmed.indexOf(OFFER_FRAGMENT_PREFIX);
  if (fragmentIndex === -1)
    return null;
  const encoded = trimmed.slice(fragmentIndex + OFFER_FRAGMENT_PREFIX.length).trim();
  return encoded.length > 0 ? encoded : null;
}
function parseConnectionOfferFromUrl(input) {
  const encoded = extractOfferFragmentEncoded(input);
  if (!encoded)
    return null;
  const payload = decodeOfferFragmentPayload(encoded);
  return ConnectionOfferSchema.parse(payload);
}
export {
  ConnectionOfferSchema,
  DaemonClient,
  MemoryRelayDeviceCredentialStore,
  RelayDeviceCredentialClient,
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  computeClientRelayDeviceAuthProof,
  createChisaCodeClient,
  createRelayDeviceId,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl
};
//# sourceMappingURL=daemon-client.bundle.js.map
