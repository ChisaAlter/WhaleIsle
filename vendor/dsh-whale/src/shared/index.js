// Unified barrel export for the WhaleIsle bots shared domain layer.
// Zero Node/DOM hard dependencies; safe in both main process and renderer/browser ESM.

export * from './bot-types.js';
export * from './bot-avatar-color.js';
export {
  WHALE_BOT_MASCOT_IDS,
  WHALE_MASCOT_LABELS,
  WHALE_MASCOT_LABELS_EN,
  WHALE_MASCOT_RECOMMENDED_COLORS,
  WHALE_MASCOT_DESCRIPTIONS,
  EMPTY_CARD_MASCOT_IDS,
  BOT_MASCOT_IDS,
  RETIRED_BOT_MASCOT_IDS,
  PICKABLE_BOT_MASCOT_IDS,
  BOT_AVATAR_FILE,
  BOT_AVATAR_SIZE,
  MAX_BOT_AVATAR_SIZE,
  MAX_BOT_AVATAR_BYTES,
  BOT_AVATAR_SOURCE_TYPES,
  MAX_BOT_AVATAR_SOURCE_BYTES,
  MIN_BOT_AVATAR_SOURCE_SIDE,
  readPngDimensions,
  isBotAvatarImage,
  validateAvatarUpload,
  isBotMascotId,
  isPickableBotMascotId,
  mascotAvatar,
  uploadAvatar,
  isUploadAvatar,
  parseBotAvatar,
  pickRandomMascot,
  randomMascotAvatar,
  recommendedMascotColor,
  isSettableBotAvatar,
  botInitial,
  botFallback,
  getMascotAssetPaths,
} from './bot-avatar.js';
export * from './bot-soul.js';
export * from './bot-memory-lines.js';
export * from './bot-tidy-up.js';
export * from './bot-quiet-result.js';
export * from './bot-sidebar-logic.js';
export * from './bot-items.js';
export * from './bot-item-ask-advice.js';
export * from './bot-groups.js';
export * from './bot-template-catalog.js';
export * from './bot-builtin-skills.js';
export * from './bot-templates.js';
export * from './bot-look-around.js';
export {
  BOT_PACKAGE_SCHEMA_VERSION,
  BOT_PACKAGE_MANIFEST_PATH,
  BOT_PACKAGE_SOUL_PATH,
  BOT_PACKAGE_AVATAR_PATH,
  BOT_PACKAGE_MAX_MANIFEST_BYTES,
  BOT_PACKAGE_PURPOSE_MAX,
  BOT_PACKAGE_SETUP_NOTE_MAX,
  BOT_PACKAGE_NEWER_ERROR,
  BOT_PACKAGE_RESULTS,
  BOT_PACKAGE_EVENT_RESULTS,
  BOT_PACKAGE_CONNECTORS,
  BOT_PACKAGE_EVENT_KINDS,
  BOT_TEXT_SCAN_KINDS,
  botToolUrlAuthority,
  isSafeBotPackageToolUrl,
  validateSkillPackageName,
  parseBotPackage,
  botPackagePartOf,
  botPackageRole,
  botPackageResults,
  skillsFolderFor,
  planBotFromPackage,
  BOT_TEXT_LEFT_OUT,
  hasUnsafeText,
  withoutUnsafeText,
  redactBotText,
  scanBotText,
} from './bot-package.js';
export * from './bot-tools-schema.js';
export * from './connector-prompt.js';
export * from './locales.js';
