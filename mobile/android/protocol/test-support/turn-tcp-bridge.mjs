/**
 * Minimal RFC 5766 TURN-over-TCP test relay (pure Node `net` + `dgram` + `crypto`, zero deps).
 *
 * Used strictly by `werift-device-host.mjs` when the physical Android device and Windows PC
 * are separated by dual symmetric NAT (e.g., phone on cellular CGNAT + PC on corporate NAT)
 * so that real Android `libwebrtc` (via `adb reverse tcp:<turnPort>`) can still establish a
 * 100% real ICE -> DTLS -> SCTP -> DataChannel ("dsh") connection against Windows `werift`.
 */

import crypto from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";

const STUN_MAGIC_COOKIE = 0x2112a442;

const MSG_BINDING_REQ = 0x0001;
const MSG_BINDING_OK = 0x0101;
const MSG_ALLOCATE_REQ = 0x0003;
const MSG_ALLOCATE_OK = 0x0103;
const MSG_ALLOCATE_ERR = 0x0113;
const MSG_REFRESH_REQ = 0x0004;
const MSG_REFRESH_OK = 0x0104;
const MSG_CREATE_PERM_REQ = 0x0008;
const MSG_CREATE_PERM_OK = 0x0108;
const MSG_CHANNEL_BIND_REQ = 0x0009;
const MSG_CHANNEL_BIND_OK = 0x0109;
const MSG_SEND_IND = 0x0016;
const MSG_DATA_IND = 0x0017;

const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_CHANNEL_NUMBER = 0x000c;
const ATTR_LIFETIME = 0x000d;
const ATTR_XOR_PEER_ADDRESS = 0x0012;
const ATTR_DATA = 0x0013;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_XOR_RELAYED_ADDRESS = 0x0016;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;

function pad4(n) {
  return (n + 3) & ~3;
}

function encodeAttr(type, valueBuf) {
  const paddedLen = pad4(valueBuf.length);
  const out = Buffer.alloc(4 + paddedLen);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(valueBuf.length, 2);
  valueBuf.copy(out, 4);
  return out;
}

function encodeXorAddr(ip, port) {
  const parts = ip.split(".").map((x) => Number(x) & 0xff);
  if (parts.length !== 4) {
    throw new Error(`Expected IPv4 address for TURN XOR-ADDRESS, got: ${ip}`);
  }
  const out = Buffer.alloc(8);
  out[0] = 0;
  out[1] = 0x01; // IPv4
  out.writeUInt16BE((port ^ (STUN_MAGIC_COOKIE >>> 16)) & 0xffff, 2);
  out[4] = parts[0] ^ ((STUN_MAGIC_COOKIE >>> 24) & 0xff);
  out[5] = parts[1] ^ ((STUN_MAGIC_COOKIE >>> 16) & 0xff);
  out[6] = parts[2] ^ ((STUN_MAGIC_COOKIE >>> 8) & 0xff);
  out[7] = parts[3] ^ (STUN_MAGIC_COOKIE & 0xff);
  return out;
}

function decodeXorAddr(buf) {
  if (buf.length < 8 || buf[1] !== 0x01) return null;
  const port = buf.readUInt16BE(2) ^ ((STUN_MAGIC_COOKIE >>> 16) & 0xffff);
  const ip = [
    buf[4] ^ ((STUN_MAGIC_COOKIE >>> 24) & 0xff),
    buf[5] ^ ((STUN_MAGIC_COOKIE >>> 16) & 0xff),
    buf[6] ^ ((STUN_MAGIC_COOKIE >>> 8) & 0xff),
    buf[7] ^ (STUN_MAGIC_COOKIE & 0xff),
  ].join(".");
  return { ip, port };
}

function encodeErrorCode(code, reason) {
  const reasonBuf = Buffer.from(reason, "utf8");
  const out = Buffer.alloc(4 + reasonBuf.length);
  out[2] = Math.floor(code / 100) & 0x07;
  out[3] = code % 100;
  reasonBuf.copy(out, 4);
  return out;
}

function encodeUint32(val) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(val >>> 0, 0);
  return b;
}

function buildStunMessage(msgType, txId, attrs, integrityKey = null) {
  const body = Buffer.concat(attrs);
  const extraIntegrity = integrityKey ? 24 : 0;
  const header = Buffer.alloc(20);
  header.writeUInt16BE(msgType, 0);
  header.writeUInt16BE(body.length + extraIntegrity, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  txId.copy(header, 8, 0, 12);
  if (!integrityKey) {
    return Buffer.concat([header, body]);
  }
  const toSign = Buffer.concat([header, body]);
  const hmac = crypto.createHmac("sha1", integrityKey).update(toSign).digest();
  const miAttr = encodeAttr(ATTR_MESSAGE_INTEGRITY, hmac);
  return Buffer.concat([toSign, miAttr]);
}

function parseStunAttributes(buf) {
  const attrs = new Map();
  let off = 20;
  const msgLen = buf.readUInt16BE(2);
  const end = Math.min(buf.length, 20 + msgLen);
  while (off + 4 <= end) {
    const type = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    if (off + 4 + len > end) break;
    const val = buf.subarray(off + 4, off + 4 + len);
    if (!attrs.has(type)) attrs.set(type, []);
    attrs.get(type).push(val);
    off += 4 + pad4(len);
  }
  return attrs;
}

export async function startTurnTcpBridge(options = {}) {
  const bindHost = options.bindHost ?? "127.0.0.1";
  const port = options.port ?? 0;
  const relayIp = options.relayIp ?? "127.0.0.1";
  const username = options.username ?? "dsh";
  const password = options.password ?? "dsh-turn-test";
  const realm = options.realm ?? "dsh-test";
  const nonce = "dsh-nonce-v1";
  const verbose = Boolean(options.verbose);

  const authKey = crypto.createHash("md5").update(`${username}:${realm}:${password}`).digest();
  const activeSockets = new Set();
  const activeUdp = new Set();

  const server = net.createServer((tcpSocket) => {
    tcpSocket.setNoDelay(true);
    activeSockets.add(tcpSocket);

    let recvBuf = Buffer.alloc(0);
    let udpSocket = null;
    let allocatedPort = 0;
    const channelToPeer = new Map(); // channelNumber -> { ip, port }
    const peerToChannel = new Map(); // "ip:port" -> channelNumber

    const cleanupClient = () => {
      activeSockets.delete(tcpSocket);
      if (udpSocket) {
        activeUdp.delete(udpSocket);
        try {
          udpSocket.close();
        } catch {}
        udpSocket = null;
      }
    };

    tcpSocket.on("close", cleanupClient);
    tcpSocket.on("error", cleanupClient);

    const sendTcp = (buf) => {
      if (!tcpSocket.destroyed && tcpSocket.writable) {
        tcpSocket.write(buf);
      }
    };

    const ensureUdpAllocation = () =>
      new Promise((resolve, reject) => {
        if (udpSocket && allocatedPort > 0) {
          resolve(allocatedPort);
          return;
        }
        const sock = dgram.createSocket("udp4");
        sock.once("error", reject);
        sock.bind(0, relayIp, () => {
          const addr = sock.address();
          udpSocket = sock;
          allocatedPort = addr.port;
          activeUdp.add(sock);
          if (verbose) {
            console.error(`[turn-bridge] allocated UDP ${relayIp}:${allocatedPort}`);
          }
          sock.on("message", (msg, rinfo) => {
            const peerKey = `${rinfo.address}:${rinfo.port}`;
            const ch = peerToChannel.get(peerKey);
            if (ch !== undefined) {
              // RFC 5766 §11.5: ChannelData over TCP MUST be padded to 4-byte boundary.
              const padded = pad4(msg.length);
              const frame = Buffer.alloc(4 + padded);
              frame.writeUInt16BE(ch, 0);
              frame.writeUInt16BE(msg.length, 2);
              msg.copy(frame, 4);
              sendTcp(frame);
            } else {
              const txId = crypto.randomBytes(12);
              const ind = buildStunMessage(MSG_DATA_IND, txId, [
                encodeAttr(ATTR_XOR_PEER_ADDRESS, encodeXorAddr(rinfo.address, rinfo.port)),
                encodeAttr(ATTR_DATA, msg),
              ]);
              sendTcp(ind);
            }
          });
          resolve(allocatedPort);
        });
      });

    const handleStunPacket = async (pkt) => {
      const msgType = pkt.readUInt16BE(0);
      const txId = Buffer.from(pkt.subarray(8, 20));
      const attrs = parseStunAttributes(pkt);

      if (msgType === MSG_BINDING_REQ) {
        sendTcp(
          buildStunMessage(MSG_BINDING_OK, txId, [
            encodeAttr(ATTR_XOR_MAPPED_ADDRESS, encodeXorAddr("127.0.0.1", tcpSocket.remotePort || 40000)),
          ]),
        );
        return;
      }

      if (msgType === MSG_ALLOCATE_REQ) {
        if (!attrs.has(ATTR_USERNAME) || !attrs.has(ATTR_MESSAGE_INTEGRITY)) {
          sendTcp(
            buildStunMessage(MSG_ALLOCATE_ERR, txId, [
              encodeAttr(ATTR_ERROR_CODE, encodeErrorCode(401, "Unauthorized")),
              encodeAttr(ATTR_REALM, Buffer.from(realm, "utf8")),
              encodeAttr(ATTR_NONCE, Buffer.from(nonce, "utf8")),
            ]),
          );
          return;
        }
        const udpPort = await ensureUdpAllocation();
        sendTcp(
          buildStunMessage(
            MSG_ALLOCATE_OK,
            txId,
            [
              encodeAttr(ATTR_XOR_RELAYED_ADDRESS, encodeXorAddr(relayIp, udpPort)),
              encodeAttr(ATTR_XOR_MAPPED_ADDRESS, encodeXorAddr("127.0.0.1", tcpSocket.remotePort || 40000)),
              encodeAttr(ATTR_LIFETIME, encodeUint32(600)),
            ],
            authKey,
          ),
        );
        return;
      }

      if (msgType === MSG_REFRESH_REQ) {
        const lifetime = attrs.get(ATTR_LIFETIME)?.[0]?.readUInt32BE(0) ?? 600;
        sendTcp(
          buildStunMessage(
            MSG_REFRESH_OK,
            txId,
            [encodeAttr(ATTR_LIFETIME, encodeUint32(lifetime))],
            authKey,
          ),
        );
        return;
      }

      if (msgType === MSG_CREATE_PERM_REQ) {
        sendTcp(buildStunMessage(MSG_CREATE_PERM_OK, txId, [], authKey));
        return;
      }

      if (msgType === MSG_CHANNEL_BIND_REQ) {
        const chBuf = attrs.get(ATTR_CHANNEL_NUMBER)?.[0];
        const peerBuf = attrs.get(ATTR_XOR_PEER_ADDRESS)?.[0];
        if (chBuf && chBuf.length >= 2 && peerBuf) {
          const chNum = chBuf.readUInt16BE(0);
          const peer = decodeXorAddr(peerBuf);
          if (peer) {
            channelToPeer.set(chNum, peer);
            peerToChannel.set(`${peer.ip}:${peer.port}`, chNum);
          }
        }
        sendTcp(buildStunMessage(MSG_CHANNEL_BIND_OK, txId, [], authKey));
        return;
      }

      if (msgType === MSG_SEND_IND) {
        const peerBuf = attrs.get(ATTR_XOR_PEER_ADDRESS)?.[0];
        const dataBuf = attrs.get(ATTR_DATA)?.[0];
        if (udpSocket && peerBuf && dataBuf) {
          const peer = decodeXorAddr(peerBuf);
          if (peer) {
            udpSocket.send(dataBuf, peer.port, peer.ip);
          }
        }
      }
    };

    tcpSocket.on("data", (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      while (recvBuf.length >= 4) {
        const top2 = recvBuf[0] & 0xc0;
        if (top2 === 0x00) {
          // STUN packet
          if (recvBuf.length < 20) break;
          const msgLen = recvBuf.readUInt16BE(2);
          const total = 20 + pad4(msgLen);
          if (recvBuf.length < total) break;
          const pkt = recvBuf.subarray(0, total);
          recvBuf = recvBuf.subarray(total);
          void handleStunPacket(pkt).catch((err) => {
            if (verbose) console.error("[turn-bridge] stun error:", err);
          });
        } else if (top2 === 0x40) {
          // ChannelData frame
          const chNum = recvBuf.readUInt16BE(0);
          const dataLen = recvBuf.readUInt16BE(2);
          const total = 4 + pad4(dataLen);
          if (recvBuf.length < total) break;
          const payload = recvBuf.subarray(4, 4 + dataLen);
          recvBuf = recvBuf.subarray(total);
          const peer = channelToPeer.get(chNum);
          if (udpSocket && peer) {
            udpSocket.send(payload, peer.port, peer.ip);
          }
        } else {
          // Unexpected framing; reset connection
          tcpSocket.destroy();
          break;
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindHost, resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: actualPort,
    username,
    credential: password,
    relayIp,
    async stop() {
      for (const sock of activeUdp) {
        try {
          sock.close();
        } catch {}
      }
      activeUdp.clear();
      for (const sock of activeSockets) {
        try {
          sock.destroy();
        } catch {}
      }
      activeSockets.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
