export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type {
  Transport,
  BinaryDataChannelTransport,
  ActivateWebRtcLegParams,
  EncryptedChannelEvents,
  EncryptedChannelSecurityContext,
} from "./encrypted-channel.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
  generateRelayAuthKeyPair,
  exportRelayAuthPublicKey,
  importRelayAuthPublicKey,
  exportRelayAuthSecretKey,
  importRelayAuthSecretKey,
  signRelayServerAuth,
  verifyRelayServerAuth,
  encrypt,
  decrypt,
  encryptToBytes,
  decryptFromBytes,
  extractSeqFromBundle,
  deriveSharedKey,
  SALT_LENGTH,
  SEQ_LENGTH,
} from "./crypto.js";
export type { KeyPair, RelayAuthKeyPair, SharedKey, DecryptResult } from "./crypto.js";
