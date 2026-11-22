export type { ConnectionRole, RelaySessionAttachment } from "./types.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  generateRelayAuthKeyPair,
  exportRelayAuthPublicKey,
  importRelayAuthPublicKey,
  exportRelayAuthSecretKey,
  importRelayAuthSecretKey,
  signRelayServerAuth,
  verifyRelayServerAuth,
  deriveSharedKey,
  encrypt,
  decrypt,
  encryptToBytes,
  decryptFromBytes,
  extractSeqFromBundle,
  SALT_LENGTH,
  SEQ_LENGTH,
} from "./crypto.js";

export type { DecryptResult, RelayAuthKeyPair } from "./crypto.js";

export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type {
  Transport,
  BinaryDataChannelTransport,
  ActivateWebRtcLegParams,
  EncryptedChannelEvents,
} from "./encrypted-channel.js";
