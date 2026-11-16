'use strict';

// 进程与密钥类基础件（议题 #433）：令牌等值比较、带上限的 HTTP 请求体读取、
// 经 stdin 控制通道按行协议向子进程传递密钥。同一件事只有这一种写法，
// 调用方一律从这里取；vendor 侧经 ../vendor/dsh-shared/lib/secret.mjs 复用。
// readBodyLimited 超限后的连接处置分两种模式：服务端处理器传 options.res
// （标 Connection: close 后回 4xx，Node 发完响应再关连接）；客户端侧读取
// 或不回响应的不传，请求与底层 socket 立即销毁。
const crypto = require('crypto');

function secretBytes(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  return null;
}

/**
 * 令牌/密钥/口令等凭据的等值比较。
 *
 * 对两侧各取定长 SHA-256 摘要再做 crypto.timingSafeEqual：摘要长度固定，
 * 比较耗时与输入长度无关，既不需要先比长度（直接比较长度会提前返回，
 * 把"长度是否相同"泄露给计时观测者），也天然支持任意长度输入。
 *
 * @param {string|Buffer} a
 * @param {string|Buffer} b
 * @returns {boolean} 非字符串/非 Buffer 输入一律 false
 */
function constantTimeEqual(a, b) {
  const left = secretBytes(a);
  const right = secretBytes(b);
  if (left === null || right === null) {
    return false;
  }
  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

/**
 * 带字节上限的 HTTP 请求体读取。
 *
 * - 超过 maxBytes 立刻摘除监听器停止读取，并以带 `code: 'BODY_TOO_LARGE'`
 *   的错误 reject。超限后的连接处置取决于 `options.res`：
 *   · 传了对应的 http.ServerResponse：响应头未发出时标
 *     `Connection: close`，然后暂停请求流——调用方在同一条连接上回
 *     4xx，Node 把响应发完后关闭连接。会在超限分支回响应的服务端
 *     处理器必须传 res，否则响应写不出去，连接还会一直挂着收数据。
 *   · 不传：reject 后直接 `req.destroy()`，底层 socket 一并断开
 *     （旧的安全默认）。客户端侧读取响应流、或超限后不回响应的
 *     调用方走这条。
 * - 请求中途断开（'close' 先于 'end'）或流报错时 reject。
 * - 默认 resolve 为 utf8 字符串；`options.buffer` 时 resolve 为 Buffer。
 *
 * @param {import('stream').Readable} req - IncomingMessage 或同类可读流
 * @param {number} maxBytes - 字节上限（不含）
 * @param {{ buffer?: boolean, res?: import('http').ServerResponse }} [options]
 * @returns {Promise<string|Buffer>}
 */
function readBodyLimited(req, maxBytes, options = {}) {
  const limit = Number(maxBytes);
  if (!Number.isFinite(limit) || limit < 0) {
    throw new TypeError('readBodyLimited: maxBytes 必须是非负数字');
  }
  const asBuffer = options && options.buffer === true;
  const res = options && options.res;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      fn(value);
    };
    const finish = () => {
      const body = Buffer.concat(chunks);
      settle(resolve, asBuffer ? body : body.toString('utf8'));
    };
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        const error = new Error(`请求体超过 ${limit} 字节上限`);
        error.code = 'BODY_TOO_LARGE';
        if (res) {
          // 服务端模式：停读但保留连接，Node 把调用方的 4xx 发完后
          // 按 Connection: close 关掉这条连接。
          if (!res.headersSent) {
            res.setHeader('Connection', 'close');
          }
          req.pause?.();
          settle(reject, error);
        } else {
          settle(reject, error);
          // 无响应通道：立即销毁请求与底层 socket，不再收对端的数据。
          req.destroy?.();
        }
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => finish();
    const onError = (error) => settle(reject, error);
    const onClose = () => {
      // 'close' 正常跟在 'end' 之后（此时已 settled）；先到则是连接中断。
      if (req.readableEnded === true || req.complete === true) {
        finish();
        return;
      }
      const error = new Error('请求体读取中断');
      error.code = 'BODY_READ_FAILED';
      settle(reject, error);
    };
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('close', onClose);
  });
}

/**
 * 经子进程 stdin 控制通道按行协议传递密钥：写入 `<name> <value>\n`。
 * 密钥不进 argv、不进环境变量。名称与值都不得含换行——一个换行
 * 在按行协议里就是另一条控制消息。
 *
 * @param {import('child_process').ChildProcess} child
 * @param {string} name - 控制行名称
 * @param {string} value - 密钥值（null/undefined 记作空串）
 * @returns {boolean} child.stdin.write 的返回值
 */
function passSecretToChild(child, name, value) {
  if (!child || !child.stdin || typeof child.stdin.write !== 'function') {
    throw new TypeError('passSecretToChild: child 必须提供可写 stdin');
  }
  const key = String(name == null ? '' : name).trim();
  if (!key || /[\r\n]/.test(key)) {
    throw new Error('passSecretToChild: 控制行名称不能为空且不得含换行');
  }
  const text = value == null ? '' : String(value);
  if (/[\r\n]/.test(text)) {
    throw new Error('passSecretToChild: 密钥值不得含换行');
  }
  return child.stdin.write(`${key} ${text}\n`);
}

module.exports = {
  constantTimeEqual,
  readBodyLimited,
  passSecretToChild,
};
