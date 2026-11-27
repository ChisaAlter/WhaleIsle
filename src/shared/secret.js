'use strict';

// 进程与密钥类基础件（议题 #433）：令牌等值比较、带上限的 HTTP 请求体读取、
// 经 stdin 控制通道按行协议向子进程传递密钥；议题 #427 追加进程内密钥
// 存取件：令牌只进 globalThis 上的只读密钥视图，绝不写回 process.env，子进程
// 默认继承不到。同一件事只有这一种写法，
// 调用方一律从这里取；vendor 侧经 ../vendor/dsh-shared/lib/secret.mjs 复用，
// 会被打包器内联的插件源码用 ../vendor/dsh-shared/lib/internal-secret.mjs。
// readBodyLimited 超限后的连接处置分两种模式：服务端处理器传 options.res
// （标 Connection: close 后回 4xx，Node 发完响应再关连接）；客户端侧读取
// 或不回响应的不传，请求与底层 socket 立即销毁。
const crypto = require('crypto');

/**
 * @param {unknown} value
 * @returns {Buffer | null}
 */
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
 * @param {import('stream').Readable & { complete?: boolean }} req - IncomingMessage 或同类可读流
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
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    let settled = false;
    const detach = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    /** @param {string | Buffer} value */
    const settleResolve = (value) => {
      if (settled) return;
      settled = true;
      detach();
      resolve(value);
    };
    /** @param {unknown} error */
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      detach();
      reject(error);
    };
    const finish = () => {
      const body = Buffer.concat(chunks);
      settleResolve(asBuffer ? body : body.toString('utf8'));
    };
    /** @param {string | Buffer | Uint8Array} chunk */
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        const error = Object.assign(
          new Error(`请求体超过 ${limit} 字节上限`),
          { code: 'BODY_TOO_LARGE' },
        );
        if (res) {
          // 服务端模式：停读但保留连接，Node 把调用方的 4xx 发完后
          // 按 Connection: close 关掉这条连接。
          if (!res.headersSent) {
            res.setHeader('Connection', 'close');
          }
          req.pause?.();
          settleReject(error);
        } else {
          settleReject(error);
          // 无响应通道：立即销毁请求与底层 socket，不再收对端的数据。
          req.destroy?.();
        }
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => finish();
    /** @param {unknown} error */
    const onError = (error) => settleReject(error);
    const onClose = () => {
      // 'close' 正常跟在 'end' 之后（此时已 settled）；先到则是连接中断。
      if (req.readableEnded === true || req.complete === true) {
        finish();
        return;
      }
      const error = Object.assign(
        new Error('请求体读取中断'),
        { code: 'BODY_READ_FAILED' },
      );
      settleReject(error);
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

/**
 * 进程内密钥存储（议题 #427）。
 *
 * 桌面主进程用 passSecretToChild 经 stdin 控制通道把内部控制令牌
 * （DSH_DESKTOP_INSTALL_TOKEN / DSHD_TASK_CONTROL_TOKEN / DSHD_PLATFORM_TOKEN）
 * 按行下发给 host runner；runner 在加载任何插件前用 collectInternalSecrets
 * 收齐，存成 globalThis[Symbol.for('whaleisle.internalSecrets')] 上的只读
 * 密钥视图（仅暴露 get(name)，底层 Map 私有、不可经视图改写）。令牌不落
 * process.env，host 派生的 shell、MCP、LSP 子进程默认都继承不到，也读不到
 * /proc/<pid>/environ 里的初始环境。
 */

/** 进程内存储的 globalThis 键；CJS/ESM 两侧经 Symbol.for 共享同一符号。 */
const INTERNAL_SECRETS_KEY = Symbol.for('whaleisle.internalSecrets');
/** stdin 控制通道的密钥段结束标记行。 */
const INTERNAL_SECRETS_END = 'internal-secrets-end';
/** 父进程声明"本会经 stdin 下发密钥"的非密钥标志变量（runner 门控）。 */
const INTERNAL_SECRETS_ENV = 'DSHD_INTERNAL_SECRETS_VIA_STDIN';

/**
 * 读取一枚进程内密钥。没有存储或没有该名时返回空串——读方按"无凭据"
 * fail closed，不回退 process.env（回退会把泄露面原样请回来）。
 *
 * @param {string} name - 密钥名（沿用原环境变量名，便于按名核对）
 * @returns {string}
 */
function internalSecret(name) {
  const store = Reflect.get(globalThis, INTERNAL_SECRETS_KEY);
  const value = store && typeof store.get === 'function' ? store.get(name) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * 用给定 entries 整体替换进程内密钥存储。插件加载前由 collectInternalSecrets
 * 调用；测试用它注入与还原（还原先快照
 * globalThis[Symbol.for('whaleisle.internalSecrets')] 旧值再写回）。
 *
 * 装上的是真只读视图：条目留在闭包私有的 Map 里，对外只有不可枚举、不可写
 * 的 get(name)——直接 Object.freeze 一个 Map 挡不住 Map.prototype.set/delete，
 * 同进程代码可篡改条目（复审 F3 / 议题 #514）。读方按"对象带 get(name)"
 * 判形，测试注入的旧式冻结 Map 仍可被 internalSecret 读取。
 *
 * @param {Iterable<[string, string]>} [entries]
 * @returns {{ get(name: string): string | undefined }} 已安装的只读密钥视图
 */
function storeInternalSecrets(entries) {
  const map = new Map();
  if (entries) {
    for (const [name, value] of entries) {
      map.set(String(name), value == null ? '' : String(value));
    }
  }
  /** @type {{ get(name: string): string | undefined }} */
  const store = Object.freeze(
    Object.defineProperty(Object.create(null), 'get', { value: (/** @type {string} */ name) => map.get(name) }),
  );
  Reflect.set(globalThis, INTERNAL_SECRETS_KEY, store);
  return store;
}

/**
 * 从 stdin 控制通道收齐密钥行并安装进程内存储：每行 `<name> <value>`，
 * 空行跳过，`internal-secrets-end` 行结束；对端先关流（end/close/error）
 * 也结束，已收到的行照常入库。只卸本函数的监听器，不碰流上既有消费者
 * （parent-lifeline 的 end/close 语义不受影响），读完后不再 resume/pause
 * 改变流的挂起状态。
 *
 * @param {import('stream').Readable} stream - 通常是 process.stdin
 * @param {{ endMarker?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ get(name: string): string | undefined }>} 安装好的只读密钥视图
 */
function collectInternalSecrets(stream, options = {}) {
  const endMarker = options.endMarker || INTERNAL_SECRETS_END;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 10_000;
  return new Promise((resolve) => {
    /** @type {Array<[string, string]>} */
    const entries = [];
    let buffer = '';
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', finish);
      stream.off('close', finish);
      stream.off('error', finish);
      resolve(storeInternalSecrets(entries));
    };
    if (timeoutMs > 0) {
      timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
    }
    /** @param {unknown} chunk */
    const onData = (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const text = line.trim();
        if (!text) continue;
        if (text === endMarker) {
          finish();
          return;
        }
        const space = text.indexOf(' ');
        entries.push(space < 0 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)]);
      }
    };
    stream.on('data', onData);
    stream.once('end', finish);
    stream.once('close', finish);
    stream.once('error', finish);
    stream.resume();
  });
}

module.exports = {
  constantTimeEqual,
  readBodyLimited,
  passSecretToChild,
  INTERNAL_SECRETS_KEY,
  INTERNAL_SECRETS_END,
  INTERNAL_SECRETS_ENV,
  internalSecret,
  storeInternalSecrets,
  collectInternalSecrets,
};
