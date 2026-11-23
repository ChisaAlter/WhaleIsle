/// <reference lib="dom" />
/**
 * E2EE crypto primitives using NaCl (tweetnacl).
 *
 * - Key exchange: Curve25519 (nacl.box.before)
 * - Encryption: XSalsa20-Poly1305 (nacl.box.after / open.after)
 *
 * Bundle format (binary), unchanged since the replay-protection refactor:
 *   [nonce (24 bytes)] [ciphertext...]
 *
 * Replay protection: the 24-byte nonce is no longer fully random. It is
 * composed of a per-direction random 16-byte salt followed by an 8-byte
 * little-endian sequence counter. Each direction (client→daemon and
 * daemon→client) maintains its own monotonic counter and salt. The receiver
 * reads seq out of the nonce before decryption and enforces strict
 * monotonic increase, rejecting replays and out-of-order frames. Because the
 * nonce is part of the Poly1305 authentication input (via XSalsa20 key
 * derivation), an attacker cannot tamper with seq without invalidating the
 * MAC.
 *
 * Transport format:
 *   The encrypted-channel sends the bundle as base64 text over WebSocket.
 */

import nacl from "tweetnacl";
import { fromByteArray, toByteArray } from "base64-js";

export interface KeyPair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 32 bytes
}

export interface RelayAuthKeyPair {
  publicKey: Uint8Array; // 32 bytes
  secretKey: Uint8Array; // 64 bytes
}

export type SharedKey = Uint8Array; // 32 bytes (box.before)

const NONCE_LENGTH = nacl.box.nonceLength; // 24
export const SALT_LENGTH = 16;
export const SEQ_LENGTH = 8;

let prngReady = false;

interface GlobalWithCrypto {
  crypto?: Crypto;
}

function getGlobalCrypto(): Crypto | undefined {
  const g = globalThis as GlobalWithCrypto;
  return g.crypto;
}

export function ensurePrng(): void {
  if (prngReady) return;

  try {
    nacl.randomBytes(1);
    prngReady = true;
    return;
  } catch {
    // fallthrough
  }

  const cryptoObj = getGlobalCrypto();
  if (cryptoObj?.getRandomValues) {
    nacl.setPRNG((x, n) => {
      const buf = new Uint8Array(n);
      cryptoObj.getRandomValues(buf);
      x.set(buf, 0);
    });
    prngReady = true;
    return;
  }

  throw new Error("No secure PRNG available for tweetnacl (missing crypto.getRandomValues)");
}

function encodeBase64(bytes: Uint8Array): string {
  return fromByteArray(bytes);
}

function decodeBase64(base64: string): Uint8Array {
  return toByteArray(base64);
}

function toUint8(data: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array(data);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

export function generateKeyPair(): KeyPair {
  ensurePrng();
  const { publicKey, secretKey } = nacl.box.keyPair();
  return { publicKey, secretKey };
}

export function exportPublicKey(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${nacl.box.publicKeyLength})`);
  }
  return encodeBase64(publicKey);
}

export function importPublicKey(base64: string): Uint8Array {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid public key length (expected ${nacl.box.publicKeyLength})`);
  }
  return bytes;
}

export function exportSecretKey(secretKey: Uint8Array): string {
  if (!(secretKey instanceof Uint8Array) || secretKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`);
  }
  return encodeBase64(secretKey);
}

export function importSecretKey(base64: string): Uint8Array {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`);
  }
  return bytes;
}

export function generateRelayAuthKeyPair(): RelayAuthKeyPair {
  ensurePrng();
  const { publicKey, secretKey } = nacl.sign.keyPair();
  return { publicKey, secretKey };
}

export function exportRelayAuthPublicKey(publicKey: Uint8Array): string {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength !== nacl.sign.publicKeyLength) {
    throw new Error(`Invalid relay auth public key length (expected ${nacl.sign.publicKeyLength})`);
  }
  return encodeBase64(publicKey);
}

export function importRelayAuthPublicKey(base64: string): Uint8Array {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== nacl.sign.publicKeyLength) {
    throw new Error(`Invalid relay auth public key length (expected ${nacl.sign.publicKeyLength})`);
  }
  return bytes;
}

export function exportRelayAuthSecretKey(secretKey: Uint8Array): string {
  if (!(secretKey instanceof Uint8Array) || secretKey.byteLength !== nacl.sign.secretKeyLength) {
    throw new Error(`Invalid relay auth secret key length (expected ${nacl.sign.secretKeyLength})`);
  }
  return encodeBase64(secretKey);
}

export function importRelayAuthSecretKey(base64: string): Uint8Array {
  const bytes = decodeBase64(base64);
  if (bytes.byteLength !== nacl.sign.secretKeyLength) {
    throw new Error(`Invalid relay auth secret key length (expected ${nacl.sign.secretKeyLength})`);
  }
  return bytes;
}

function relayServerAuthMessage(params: {
  readonly serverId: string;
  readonly role: "server";
  readonly connectionId: string;
  readonly nonce: string;
  readonly issuedAt: number;
}): Uint8Array {
  return new TextEncoder().encode(
    [
      "chisacode-relay-v2-server-auth",
      params.serverId,
      params.role,
      params.connectionId,
      params.nonce,
      String(params.issuedAt),
    ].join("\n"),
  );
}

export function signRelayServerAuth(params: {
  readonly secretKey: Uint8Array;
  readonly serverId: string;
  readonly role: "server";
  readonly connectionId?: string;
  readonly nonce: string;
  readonly issuedAt: number;
}): string {
  if (
    !(params.secretKey instanceof Uint8Array) ||
    params.secretKey.byteLength !== nacl.sign.secretKeyLength
  ) {
    throw new Error(`Invalid relay auth secret key length (expected ${nacl.sign.secretKeyLength})`);
  }
  const message = relayServerAuthMessage({
    serverId: params.serverId,
    role: params.role,
    connectionId: params.connectionId ?? "",
    nonce: params.nonce,
    issuedAt: params.issuedAt,
  });
  return encodeBase64(nacl.sign.detached(message, params.secretKey));
}

export function verifyRelayServerAuth(params: {
  readonly publicKeyB64: string;
  readonly signatureB64: string;
  readonly serverId: string;
  readonly role: "server";
  readonly connectionId?: string;
  readonly nonce: string;
  readonly issuedAt: number;
}): boolean {
  const publicKey = importRelayAuthPublicKey(params.publicKeyB64);
  const signature = decodeBase64(params.signatureB64);
  if (signature.byteLength !== nacl.sign.signatureLength) {
    return false;
  }
  const message = relayServerAuthMessage({
    serverId: params.serverId,
    role: params.role,
    connectionId: params.connectionId ?? "",
    nonce: params.nonce,
    issuedAt: params.issuedAt,
  });
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export function deriveSharedKey(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): SharedKey {
  if (ourSecretKey.byteLength !== nacl.box.secretKeyLength) {
    throw new Error(`Invalid secret key length (expected ${nacl.box.secretKeyLength})`);
  }
  if (peerPublicKey.byteLength !== nacl.box.publicKeyLength) {
    throw new Error(`Invalid peer public key length (expected ${nacl.box.publicKeyLength})`);
  }
  return nacl.box.before(peerPublicKey, ourSecretKey);
}

/**
 * Encodes a non-negative BigInt into an 8-byte little-endian Uint8Array.
 * Values larger than 2^64 - 1 are reduced mod 2^64 (the counter wraps at the
 * 64-bit boundary, which is well beyond any realistic message volume for a
 * single channel session).
 */
function seqToLEBytes(seq: bigint): Uint8Array {
  const masked = seq & 0xffffffffffffffffn;
  const out = new Uint8Array(SEQ_LENGTH);
  for (let i = 0; i < SEQ_LENGTH; i += 1) {
    out[i] = Number((masked >> BigInt(i * 8)) & 0xffn);
  }
  return out;
}

/** Decodes an 8-byte little-endian Uint8Array into a BigInt. */
function seqFromLEBytes(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < SEQ_LENGTH; i += 1) {
    value |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return value;
}

/**
 * Builds the 24-byte nonce from a 16-byte per-direction salt and an 8-byte
 * little-endian sequence counter. The salt is fixed for the lifetime of one
 * direction of a channel; the sequence counter increments per message.
 */
function buildNonce(salt: Uint8Array, seq: bigint): Uint8Array {
  const nonce = new Uint8Array(NONCE_LENGTH);
  nonce.set(salt, 0);
  nonce.set(seqToLEBytes(seq), SALT_LENGTH);
  return nonce;
}

export interface DecryptResult {
  plaintext: string | ArrayBuffer;
  /** The sequence counter embedded in this frame's nonce. */
  seq: bigint;
  /** The per-direction salt embedded in this frame's nonce. */
  salt: Uint8Array;
}

/**
 * Extracts the 8-byte little-endian sequence counter embedded in a raw
 * ciphertext bundle `[0..16) salt | [16..24) uint64_le seq | [24..) ciphertext`.
 */
export function extractSeqFromBundle(bundle: Uint8Array | ArrayBuffer): bigint {
  const bytes = bundle instanceof Uint8Array ? bundle : new Uint8Array(bundle);
  if (bytes.byteLength < NONCE_LENGTH) {
    throw new Error("Ciphertext bundle too short");
  }
  return seqFromLEBytes(bytes.subarray(SALT_LENGTH, NONCE_LENGTH));
}

/**
 * Encrypts data and returns the raw binary bundle as a Uint8Array:
 *   [salt (16)] [seq_le (8)] [ciphertext + 16B MAC]
 */
export function encryptToBytes(
  sharedKey: SharedKey,
  data: string | ArrayBuffer | Uint8Array,
  seq: bigint,
  salt: Uint8Array,
): Uint8Array {
  if (!(salt instanceof Uint8Array) || salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Invalid salt length (expected ${SALT_LENGTH})`);
  }
  if (seq < 0n) {
    throw new Error("seq must be a non-negative BigInt");
  }
  ensurePrng();
  const nonce = buildNonce(salt, seq);
  const plaintext = toUint8(data);
  const ciphertext = nacl.box.after(plaintext, nonce, sharedKey);
  const out = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.byteLength);
  return out;
}

/**
 * Encrypts data with a per-direction salt and monotonic sequence counter and
 * returns the binary bundle:
 *   [nonce (24)] [ciphertext...]
 *
 * The caller must supply a salt unique to this channel direction (generated
 * once when the channel transitions to open) and a strictly increasing seq
 * (typically a counter incremented after each send). Reusing the same
 * (salt, seq) pair under the same shared key would expose the XSalsa20
 * keystream — the caller MUST guarantee monotonic seq.
 *
 * @param sharedKey The ECDH-derived shared key (nacl.box.before output)
 * @param data Plaintext to encrypt
 * @param seq Monotonic sequence counter for this channel direction
 * @param salt 16-byte per-direction random salt
 * @returns ArrayBuffer bundle [nonce(24)][ciphertext]
 */
export function encrypt(
  sharedKey: SharedKey,
  data: string | ArrayBuffer,
  seq: bigint,
  salt: Uint8Array,
): ArrayBuffer {
  return toArrayBuffer(encryptToBytes(sharedKey, data, seq, salt));
}

/**
 * Decrypts a raw binary bundle (Uint8Array or ArrayBuffer) and returns the
 * plaintext plus the seq and salt extracted from the nonce.
 */
export function decryptFromBytes(
  sharedKey: SharedKey,
  data: Uint8Array | ArrayBuffer,
): DecryptResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < NONCE_LENGTH) {
    throw new Error("Ciphertext bundle too short");
  }

  const nonce = bytes.slice(0, NONCE_LENGTH);
  const salt = nonce.slice(0, SALT_LENGTH);
  const seq = seqFromLEBytes(nonce.slice(SALT_LENGTH));
  const ciphertext = bytes.slice(NONCE_LENGTH);
  const opened = nacl.box.open.after(ciphertext, nonce, sharedKey);
  if (!opened) {
    throw new Error("Decryption failed");
  }

  const plaintextBuffer = toArrayBuffer(opened);
  let plaintext: string | ArrayBuffer;
  try {
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBuffer);
  } catch {
    plaintext = plaintextBuffer;
  }
  return { plaintext, seq, salt };
}

/**
 * Decrypts a binary bundle and returns the plaintext plus the seq and salt
 * extracted from the nonce, so the caller can enforce replay protection
 * (strict monotonic seq and stable per-direction salt).
 *
 * @param sharedKey The ECDH-derived shared key
 * @param data ArrayBuffer bundle [nonce(24)][ciphertext]
 * @returns DecryptResult with plaintext, seq, and salt
 * @throws If the bundle is too short or Poly1305 authentication fails
 */
export function decrypt(sharedKey: SharedKey, data: ArrayBuffer): DecryptResult {
  return decryptFromBytes(sharedKey, data);
}
