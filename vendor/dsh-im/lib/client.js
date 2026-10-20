window.__ModuleLoader__.load({
  id: "@xmanrui/dsh-im",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin-src/client/index.js
var index_exports = {};
__export(index_exports, {
  IMSettingsTab: () => IMSettingsTab,
  IM_PLUGIN_VERSION: () => IM_PLUGIN_VERSION,
  LoopbackRecoveryNotice: () => LoopbackRecoveryNotice,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var React21 = __toESM(require("react"), 1);

// plugin-src/client/feedback.js
var React2 = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// plugin-src/client/i18n.js
var React = __toESM(require("react"), 1);
var IM_LOCALE_NAMESPACE = "dsh-im";
var EN = Object.freeze({
  "$locale": "en",
  "IM\u673A\u5668\u4EBA": "IM bots",
  "IM\u673A\u5668\u4EBA\u8BBE\u7F6E": "IM bot settings",
  "IM \u6E20\u9053": "IM channels",
  "\u8BA9 DeepSeek Harness \u89E6\u624B\u53EF\u53CA": "Connecting DeepSeek Harness",
  "\u5F53\u524D\u7248\u672C": "Current version",
  "AI Office": "AI Office",
  "\uFF08\u5B9E\u9A8C\u529F\u80FD\uFF09": "(Experimental)",
  "AI Office \u8BBE\u7F6E": "AI Office settings",
  "AI Office \u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5": "AI Office settings are missing an RPC connection",
  "\u6B63\u5728\u8BFB\u53D6 AI Office Connector\u2026": "Loading AI Office Connector\u2026",
  "\u672C\u673A\u4E3B\u52A8\u8FDE\u63A5\u516C\u7F51 Office\uFF1BHarness \u4E0D\u5F00\u653E\u7AEF\u53E3\u3002\u534F\u8BAE Hook \u56FA\u5B9A\u4E3A ": "This machine connects outward to the public Office; Harness exposes no port. Protocol hooks: ",
  "\u5C1A\u672A\u914D\u7F6E": "Not configured",
  "\u5DF2\u8FDE\u63A5 Office": "Connected to Office",
  "\u5DF2\u914D\u7F6E": "Configured",
  "\u7B49\u5F85\u91CD\u8FDE": "Waiting to reconnect",
  "\u51ED\u636E\u7F3A\u5931": "Credential missing",
  "\u6700\u8FD1\u5FC3\u8DF3": "Last heartbeat",
  "\u6700\u8FD1\u4E8B\u4EF6": "Last event",
  "\u91CD\u8FDE\u6B21\u6570": "Reconnects",
  "\u8FD0\u884C Job": "Running Jobs",
  "\u5B8C\u6210 Job": "Completed Jobs",
  "\u5C1A\u65E0": "None yet",
  "\u8BBE\u5907\u8FDE\u63A5": "Device connection",
  "Token \u53EA\u5199\u5165\u672C\u673A\u51ED\u636E\u5B58\u50A8": "Token is written only to the local credential store",
  "\u7C98\u8D34 Office \u4E00\u6B21\u6027\u51ED\u636E": "Paste the one-time Office credential",
  "\u5DF2\u5B89\u5168\u4FDD\u5B58\uFF1B\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8": "Stored securely; leave blank to keep it",
  "\u6700\u5927\u5E76\u53D1": "Max concurrency",
  "Heartbeat \u79D2\u6570": "Heartbeat seconds",
  "Workspace \u6620\u5C04": "Workspace mappings",
  "\u6BCF\u884C alias=/\u672C\u673A/\u7EDD\u5BF9\u8DEF\u5F84\uFF1BOffice \u53EA\u80FD\u770B\u5230 alias\u3002": "One alias=/local/absolute/path per line; Office sees only aliases.",
  "Instruction Preset \u6620\u5C04": "Instruction preset mappings",
  "\u6BCF\u884C alias=\u6307\u4EE4\uFF1B\u65B0\u589E preset \u4E0D\u9700\u8981\u6539 Office \u4EE3\u7801\u3002": "One alias=instruction per line; new presets require no Office code change.",
  "\u4FDD\u5B58\u5E76\u8FDE\u63A5": "Save and connect",
  "\u6D4B\u8BD5\u8FDE\u63A5": "Test connection",
  "\u6D4B\u8BD5\u4E2D\u2026": "Testing\u2026",
  "\u91CD\u65B0\u8FDE\u63A5": "Reconnect",
  "\u79FB\u9664\u8FDE\u63A5": "Remove connection",
  "\u8FDE\u63A5\u6D4B\u8BD5\u901A\u8FC7\u3002": "Connection test passed.",
  "\u914D\u7F6E\u5DF2\u4FDD\u5B58\u3002": "Configuration saved.",
  "\u8FDE\u63A5\u6D4B\u8BD5\u672A\u786E\u8BA4\u5B8C\u6210\u3002": "Connection test completion was not confirmed.",
  "\u8FDE\u63A5\u914D\u7F6E\u5C1A\u672A\u79FB\u9664\u3002": "The connection configuration has not been removed.",
  "\u8FDE\u63A5\u5DF2\u79FB\u9664\u3002": "Connection removed.",
  "\u5DF2\u91CD\u65B0\u8FDE\u63A5 Office\u3002": "Reconnected to Office.",
  "\u5DF2\u53D1\u8D77\u91CD\u65B0\u8FDE\u63A5\uFF0COffice \u5C1A\u672A\u8FDE\u63A5\u3002": "Reconnect requested; Office is not connected yet.",
  "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0COffice \u5DF2\u8FDE\u63A5\u3002": "Configuration saved; Office is connected.",
  "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0COffice \u5C1A\u672A\u8FDE\u63A5\u3002": "Configuration saved; Office is not connected yet.",
  "\u65E0\u6CD5\u5199\u5165\u526A\u8D34\u677F": "Could not write to the clipboard",
  "\u534F\u8BAE Hook \u9884\u89C8": "Protocol hook preview",
  "\u7531 Base URL \u81EA\u52A8\u6D3E\u751F\uFF0C\u4E0D\u5355\u72EC\u586B\u5199": "Derived from Base URL; no separate input",
  "Base URL \u65E0\u6548": "Invalid Base URL",
  "Office Hook \u5C1A\u672A\u90E8\u7F72\u65F6\uFF0C\u914D\u7F6E\u4F1A\u5B89\u5168\u4FDD\u5B58\u5E76\u81EA\u52A8\u91CD\u8BD5\uFF1B\u51FA\u73B0 HTTP 404 \u4EE3\u8868\u534F\u8BAE\u7AEF\u70B9\u5F85\u4E0A\u7EBF\uFF0C\u4E0D\u4EE3\u8868 Harness \u6545\u969C\u3002": "Configuration is saved and retried while Office hooks are unavailable; HTTP 404 means the protocol endpoint is pending, not a Harness failure.",
  "Workspace \u6620\u5C04\u6BCF\u884C\u5FC5\u987B\u4F7F\u7528 alias=value": "Each workspace mapping must use alias=value",
  "Instruction Preset \u6620\u5C04\u6BCF\u884C\u5FC5\u987B\u4F7F\u7528 alias=value": "Each instruction preset mapping must use alias=value",
  "action-items=\u8F6C\u6362\u4E3A\u8D1F\u8D23\u4EBA\u3001\u622A\u6B62\u548C\u9A8C\u6536\u660E\u786E\u7684\u5DE5\u5355": "action-items=Turn this into accountable tasks with deadlines and acceptance criteria",
  "AI Office \u62D2\u7EDD\u4E86 Device Token\u3002": "AI Office rejected the Device Token.",
  "AI Office Connector Hook \u5C1A\u672A\u5C31\u7EEA\u3002": "AI Office Connector hooks are not available yet.",
  "AI Office Connector \u534F\u8BAE\u7248\u672C\u4E0D\u517C\u5BB9\u3002": "The AI Office Connector protocol is incompatible.",
  "\u672C\u673A\u6682\u65F6\u65E0\u6CD5\u8BBF\u95EE AI Office\u3002": "AI Office cannot currently be reached from this machine.",
  "AI Office \u8FDE\u63A5\u5DF2\u4E2D\u65AD\u3002": "The AI Office connection was interrupted.",
  "\u5E2E\u52A9\u4E0E\u53CD\u9988 \xB7 \u524D\u5F80 GitHub": "Help & feedback \xB7 Open GitHub",
  "\u8BF7\u6539\u7528 localhost \u91CD\u65B0\u6253\u5F00": "Reopen with localhost",
  "\u9875\u9762\u4F1A\u5728\u5F53\u524D\u7AEF\u53E3\u91CD\u65B0\u6253\u5F00\uFF0C\u673A\u5668\u4EBA\u914D\u7F6E\u4E0D\u4F1A\u6539\u53D8\u3002": "The page will reopen on the current port. Your bot configuration will not change.",
  "\u4F7F\u7528 localhost \u91CD\u65B0\u6253\u5F00": "Reopen with localhost",
  "\u5F53\u524D\u5730\u5740\u4E0E\u6D4F\u89C8\u5668\u7684\u672C\u673A\u8BF7\u6C42\u6821\u9A8C\u4E0D\u517C\u5BB9\u3002\u8BF7\u4F7F\u7528\u4E0A\u65B9\u6309\u94AE\u6539\u7528 localhost \u91CD\u65B0\u6253\u5F00\u3002": "This address is incompatible with the browser\u2019s local-request checks. Use the button above to reopen with localhost.",
  "\u5FAE\u4FE1": "WeChat",
  "\u98DE\u4E66": "Feishu",
  "\u9489\u9489": "DingTalk",
  "\u4F01\u4E1A\u5FAE\u4FE1": "WeCom",
  "\u5FAE\u4FE1\u673A\u5668\u4EBA": "WeChat bot",
  "\u98DE\u4E66\u673A\u5668\u4EBA": "Feishu bot",
  "\u9489\u9489\u673A\u5668\u4EBA": "DingTalk bot",
  "\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "WeCom bot",
  "QQ\u673A\u5668\u4EBA": "QQ bot",
  "WhatsApp\u673A\u5668\u4EBA": "WhatsApp bot",
  "WhatsApp\u8D26\u53F7": "WhatsApp account",
  "\u5FAE\u4FE1\u8BBE\u7F6E": "WeChat settings",
  "\u98DE\u4E66\u673A\u5668\u4EBA\u8BBE\u7F6E": "Feishu bot settings",
  "\u7FA4\u804A\u54CD\u5E94\u65B9\u5F0F": "Group response mode",
  "\u4EC5\u5728 @\u673A\u5668\u4EBA\u65F6\u54CD\u5E94\uFF08\u63A8\u8350\uFF09": "Only respond when @mentioned (recommended)",
  "\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F": "Respond to all group messages",
  "\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\uFF08\u9700\u98DE\u4E66\u654F\u611F\u6743\u9650\uFF09": "Respond to all group messages (requires a sensitive Feishu scope)",
  "\u91CD\u65B0\u6388\u6743": "Reauthorize",
  "\u53BB\u6388\u6743": "Authorize",
  "\u91CD\u65B0\u6388\u6743\u7FA4\u6D88\u606F\u6743\u9650": "Reauthorize group-message permission",
  "\u6388\u6743\u7FA4\u6D88\u606F\u6743\u9650": "Authorize group-message permission",
  "\u6B63\u5728\u51C6\u5907\u6388\u6743\u2026": "Preparing authorization\u2026",
  "\u6B63\u5728\u51C6\u5907\u2026": "Preparing\u2026",
  "\u79C1\u804A\u59CB\u7EC8\u54CD\u5E94\uFF1B\u7FA4\u804A\u4EC5\u5904\u7406\u660E\u786E @\u5F53\u524D\u673A\u5668\u4EBA\u7684\u6D88\u606F\u3002\u7FA4\u6D88\u606F\u6743\u9650\u5DF2\u5F00\u901A\uFF0C\u518D\u6B21\u5207\u6362\u65E0\u9700\u6388\u6743\u3002": "Direct messages always work; group chats require an explicit @mention of this bot. The group-message permission is already granted, so switching again needs no authorization.",
  "\u79C1\u804A\u59CB\u7EC8\u54CD\u5E94\uFF1B\u7FA4\u804A\u4EC5\u5904\u7406\u660E\u786E @\u5F53\u524D\u673A\u5668\u4EBA\u7684\u6D88\u606F\u3002\u9009\u62E9\u5168\u90E8\u6D88\u606F\u540E\u4F1A\u6253\u5F00\u98DE\u4E66\u5B98\u65B9\u6388\u6743\u6D41\u7A0B\u3002": "Direct messages always work; group chats require an explicit @mention of this bot. Selecting all messages opens the official Feishu authorization flow.",
  "\u5DF2\u5F00\u901A\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF08im:message.group_msg\uFF09\uFF1B\u673A\u5668\u4EBA\u4F1A\u5904\u7406\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u53EF\u89C1\u6D88\u606F\u3002": "The \u201CRead all messages in associated group chat\u201D scope (im:message.group_msg) is granted; the bot processes every visible group message.",
  "\u5C1A\u672A\u786E\u8BA4\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF0C\u8BF7\u5B8C\u6210\u98DE\u4E66\u6388\u6743\u3002": "The \u201CRead all messages in associated group chat\u201D scope has not been confirmed. Complete Feishu authorization.",
  "\u79C1\u804A\u59CB\u7EC8\u54CD\u5E94\uFF1B\u7FA4\u804A\u4EC5\u5904\u7406\u660E\u786E @\u5F53\u524D\u673A\u5668\u4EBA\u7684\u6D88\u606F\u3002": "Direct messages always work; group chats require an explicit @mention of this bot.",
  "\u9700\u5728\u98DE\u4E66\u4E3A\u8BE5\u673A\u5668\u4EBA\u5F00\u901A\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF08im:message.group_msg\uFF09\uFF1B\u5F00\u901A\u540E\uFF0C\u673A\u5668\u4EBA\u4F1A\u5904\u7406\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u53EF\u89C1\u6D88\u606F\u3002": "Grant this bot the \u201CRead all messages in associated group chat\u201D Feishu scope (im:message.group_msg); once granted, it will process every visible group message.",
  "\u7FA4\u804A\u54CD\u5E94\u65B9\u5F0F\u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002": "Could not update the group response mode. Try again.",
  "\u7FA4\u6D88\u606F\u6743\u9650\u6388\u6743\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002": "Could not authorize group-message permission. Try again.",
  "\u9489\u9489\u8BBE\u7F6E": "DingTalk settings",
  "\u4F01\u4E1A\u5FAE\u4FE1\u8BBE\u7F6E": "WeCom settings",
  "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA": "Scan QR code",
  "\u6B63\u5728\u63A5\u5165": "Connecting",
  "\u624B\u52A8\u63A5\u5165": "Manual setup",
  "\u6536\u8D77\u51ED\u636E": "Hide credentials",
  "\u6536\u8D77\u63A5\u5165": "Hide setup",
  "\u63A5\u5165\u673A\u5668\u4EBA": "Connect bot",
  "\u5F00\u59CB\u63A5\u5165": "Start setup",
  "\u5728\u7EBF": "online",
  "\u8FD0\u884C\u6B63\u5E38": "Connected",
  "\u6B63\u5728\u8FDE\u63A5": "Connecting",
  "\u6B63\u5728\u8FDE\u63A5\u2026": "Connecting\u2026",
  "\u8FDE\u63A5\u672A\u5C31\u7EEA": "Not connected",
  "\u8FDE\u63A5\u4E2D": "Connecting",
  "\u8FDE\u63A5\u4E2D\u65AD": "Disconnected",
  "\u9700\u8981\u5904\u7406": "Needs attention",
  "\u72B6\u6001\u672A\u77E5": "Unknown status",
  "\u79BB\u7EBF": "Offline",
  "\u5DF2\u65AD\u5F00": "Disconnected",
  "\u6D88\u606F\u901A\u9053": "Message channel",
  "\u67E5\u770B\u6D88\u606F\u901A\u9053\u8BF4\u660E": "View message channel details",
  "\u6700\u8FD1\u68C0\u67E5": "Last checked",
  "\u6700\u8FD1\u4E00\u6761\u6D88\u606F\u5904\u7406\u5931\u8D25": "Latest message failed",
  "\u9519\u8BEF\u7801": "Code",
  "\u53C2\u8003\u53F7": "Reference",
  "\u5F53\u524D\u5DE5\u4F5C\u533A": "Current workspace",
  "\u9009\u62E9\u76EE\u5F55": "Choose folder",
  "\u9009\u62E9\u673A\u5668\u4EBA\u5DE5\u4F5C\u533A\u76EE\u5F55": "Select bot workspace folder",
  "\u5F53\u524D\u76EE\u5F55": "Current folder",
  "\u4E3B\u76EE\u5F55": "Home",
  "\u6B63\u5728\u51C6\u5907\u76EE\u5F55\u9009\u62E9\u5668\u2026": "Preparing folder picker\u2026",
  "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55\u2026": "Loading folders\u2026",
  "\u8FD9\u4E2A\u76EE\u5F55\u4E2D\u6CA1\u6709\u5B50\u6587\u4EF6\u5939\u3002": "This folder has no subfolders.",
  "\u6B64\u76EE\u5F55\u7684\u5B50\u6587\u4EF6\u5939\u8FC7\u591A\uFF0C\u4EC5\u663E\u793A\u524D\u4E00\u90E8\u5206\u3002": "This folder has too many subfolders; only the first group is shown.",
  "\u65E0\u6CD5\u8BFB\u53D6\u76EE\u5F55\uFF0C\u8BF7\u91CD\u8BD5\u3002": "Could not load the folder. Try again.",
  "\u91CD\u8BD5": "Retry",
  "\u663E\u793A\u9690\u85CF\u6587\u4EF6\u5939": "Show hidden folders",
  "\u5207\u6362\u540E\u4F1A\u6E05\u9664\u8FD9\u4E2A\u673A\u5668\u4EBA\u7684\u65E7\u4F1A\u8BDD\u6620\u5C04\u3002": "Switching clears this bot\u2019s previous session mappings.",
  "\u5207\u6362\u4E2D\u2026": "Switching\u2026",
  "\u9009\u62E9\u6B64\u76EE\u5F55": "Select this folder",
  "\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84": "Absolute workspace path",
  "/\u7EDD\u5BF9\u8DEF\u5F84/\u5230/\u5DE5\u4F5C\u533A": "/absolute/path/to/workspace",
  "\u4FEE\u6539": "Change",
  "\u4FDD\u5B58": "Save",
  "\u4FDD\u5B58\u4E2D\u2026": "Saving\u2026",
  "\u672A\u8BBE\u7F6E": "Not set",
  "\u5DE5\u4F5C\u533A\u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002": "Could not update the workspace. Try again.",
  "\u8BF7\u8F93\u5165\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84\u3002": "Enter an absolute workspace path.",
  "\u5DE5\u4F5C\u533A\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002": "The workspace must be an absolute path.",
  "\u5DE5\u4F5C\u533A\u8DEF\u5F84\u4E0D\u5B58\u5728\u3002": "The workspace path does not exist.",
  "\u5DE5\u4F5C\u533A\u8DEF\u5F84\u5FC5\u987B\u6307\u5411\u4E00\u4E2A\u76EE\u5F55\u3002": "The workspace path must point to a directory.",
  "\u627E\u4E0D\u5230\u8981\u4FEE\u6539\u7684\u673A\u5668\u4EBA\u3002": "The bot could not be found.",
  "Agent Preset": "Agent Preset",
  "\u67E5\u770B Agent Preset \u8BF4\u660E": "View Agent Preset help",
  "\u8DDF\u968F Host \u9ED8\u8BA4": "Follow the Host default",
  "\uFF08\u5DF2\u4E0D\u53EF\u7528\uFF09": " (unavailable)",
  "\u53EA\u5F71\u54CD\u65B0\u5EFA\u4F1A\u8BDD\uFF1B\u82E5\u5F53\u524D\u804A\u5929\u5DF2\u6709\u4F1A\u8BDD\uFF0C\u5148\u53D1\u9001 /new\uFF0C\u518D\u53D1\u9001\u666E\u901A\u6D88\u606F\u751F\u6548\u3002": "This affects only new sessions. If the current chat already has a session, send /new, then send a regular message to apply it.",
  "\u5F53\u524D Agent Preset \u5DF2\u4E0D\u53EF\u7528\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6 Preset \u6216\u8DDF\u968F Host \u9ED8\u8BA4\u3002": "The current Agent Preset is unavailable. Choose another preset or follow the Host default.",
  "Agent Preset \u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002": "Could not update the Agent Preset. Try again.",
  "\u8BF7\u9009\u62E9 Agent Preset\u3002": "Choose an Agent Preset.",
  "Agent Preset \u65E0\u6548\u3002": "The Agent Preset is invalid.",
  "Agent Preset \u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u7528\u3002": "The Agent Preset does not exist or is unavailable.",
  "\u5C1A\u672A\u68C0\u67E5": "Not checked yet",
  "\u521A\u521A": "Just now",
  "\u68C0\u67E5\u8FDE\u63A5": "Check connection",
  "\u68C0\u67E5\u4E2D\u2026": "Checking\u2026",
  "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002": "Connection check failed. Try again later.",
  "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230\u5BF9\u5E94\u673A\u5668\u4EBA\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002": "Test message sent. Check the matching bot conversation.",
  "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002": "Connection check completed. The bot has not received a direct message it can use for testing.",
  "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002": "Connection check completed, but the test message could not be sent.",
  "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230\u98DE\u4E66\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002": "Test message sent. Check the Feishu conversation.",
  "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230 WhatsApp \u81EA\u804A\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002": "Test message sent. Check the WhatsApp self-chat.",
  "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684 WhatsApp \u81EA\u804A\u76EE\u6807\u3002": "Connection check completed, but no WhatsApp self-chat target is available.",
  "\u9489\u9489\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002": "DingTalk connection check completed and the test message was sent.",
  "\u9489\u9489\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002": "DingTalk connection check completed, but the test message could not be sent.",
  "\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002": "WeChat connection check completed and the test message was sent.",
  "\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002": "WeChat connection check completed, but the test message could not be sent.",
  "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002": "WeCom connection check completed and the test message was sent.",
  "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002": "WeCom connection check completed, but the test message could not be sent.",
  "\u91CD\u8BD5\u8FDE\u63A5": "Reconnect",
  "\u91CD\u8BD5\u4E2D\u2026": "Retrying\u2026",
  "\u79FB\u9664\u63A5\u5165": "Remove connection",
  "\u786E\u8BA4\u79FB\u9664\u63A5\u5165": "Remove connection",
  "\u786E\u8BA4\u79FB\u9664": "Remove",
  "\u6B63\u5728\u79FB\u9664\u2026": "Removing\u2026",
  "\u4FDD\u7559\u673A\u5668\u4EBA": "Keep bot",
  "\u4FDD\u7559\u8D26\u53F7": "Keep account",
  "\u53D6\u6D88": "Cancel",
  "\u5173\u95ED": "Close",
  "\u7ACB\u5373\u91CD\u8BD5": "Retry now",
  "\u91CD\u65B0\u8BFB\u53D6": "Reload",
  "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801": "Generate a new QR code",
  "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801\u540E\u7EE7\u7EED": "Generate a new QR code",
  "\u5237\u65B0\u4E8C\u7EF4\u7801": "Refresh QR code",
  "\u5237\u65B0\u4E2D\u2026": "Refreshing\u2026",
  "\u6362\u4E00\u4E2A\u4E8C\u7EF4\u7801": "Get another QR code",
  "\u7EE7\u7EED\u8FDE\u63A5": "Continue connecting",
  "\u7ED1\u5B9A\u5E76\u8FDE\u63A5": "Connect",
  "\u6B63\u5728\u7ED1\u5B9A\u2026": "Connecting\u2026",
  "\u9A8C\u8BC1\u5E76\u8FDE\u63A5": "Verify and connect",
  "\u6B63\u5728\u9A8C\u8BC1\u5E76\u8FDE\u63A5\u2026": "Verifying and connecting\u2026",
  "\u6B63\u5728\u9A8C\u8BC1\u2026": "Verifying\u2026",
  "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5": "The operation failed. Try again later.",
  "\u8BF7\u7A0D\u540E\u91CD\u8BD5": "Try again later.",
  "\u5F53\u524D\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4": "QR code expires in",
  "\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4": "QR code expires in",
  "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F": "QR code expired",
  "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548": "QR code expired",
  "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\n\u8BF7\u91CD\u65B0\u751F\u6210": "QR code expired\nGenerate a new one",
  "\u4E8C\u7EF4\u7801\u56FE\u7247\u6B63\u5728\u751F\u6210\u2026": "Generating QR code\u2026",
  "\u4E8C\u7EF4\u7801\u6B63\u5728\u751F\u6210\u2026": "Generating QR code\u2026",
  "\u4E8C\u7EF4\u7801\u6B63\u5728\u81EA\u52A8\u5237\u65B0\u2026": "Refreshing QR code\u2026",
  "\u4E8C\u7EF4\u7801\u672A\u5C31\u7EEA\uFF0C\u8BF7\u6253\u5F00\u6388\u6743\u94FE\u63A5": "The QR code is not ready. Open the authorization link.",
  "\u4E8C\u7EF4\u7801\u56FE\u7247\u672A\u5C31\u7EEA\uFF0C\u8BF7\u4F7F\u7528\u5907\u7528\u94FE\u63A5\u3002": "The QR code is not ready. Use the alternate link.",
  "\u4E8C\u7EF4\u7801\u56FE\u7247\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u3002": "The QR code is not ready. Generate a new one.",
  "\u7B49\u5F85\u5237\u65B0": "Waiting to refresh",
  "\u6B63\u5728\u5237\u65B0\u4E8C\u7EF4\u7801": "Refreshing QR code",
  "\u6253\u5F00\u5907\u7528\u94FE\u63A5": "Open alternate link",
  "\u751F\u6210\u4E8C\u7EF4\u7801": "Generate QR code",
  "\u751F\u6210\u5FAE\u4FE1\u4E8C\u7EF4\u7801": "Generate WeChat QR code",
  "\u751F\u6210\u98DE\u4E66\u4E8C\u7EF4\u7801": "Generate Feishu QR code",
  "\u751F\u6210\u9489\u9489\u4E8C\u7EF4\u7801": "Generate DingTalk QR code",
  "\u751F\u6210\u4F01\u4E1A\u5FAE\u4FE1\u4E8C\u7EF4\u7801": "Generate WeCom QR code",
  "\u751F\u6210 QQ \u4E8C\u7EF4\u7801": "Generate QQ QR code",
  "\u6B63\u5728\u751F\u6210\u4E8C\u7EF4\u7801\u2026": "Generating QR code\u2026",
  "\u6B63\u5728\u51C6\u5907\u6388\u6743\u4E8C\u7EF4\u7801": "Preparing authorization QR code",
  "\u6B63\u5728\u51C6\u5907\u6743\u9650\u6388\u6743\u4E8C\u7EF4\u7801": "Preparing permission authorization QR code",
  "\u6B63\u5728\u51C6\u5907\u5FAE\u4FE1\u4E8C\u7EF4\u7801": "Preparing WeChat QR code",
  "\u6B63\u5728\u6DFB\u52A0\u65B0\u673A\u5668\u4EBA": "Adding a new bot",
  "\u6B63\u5728\u7533\u8BF7\u9489\u9489\u6388\u6743\u4E8C\u7EF4\u7801\u2026": "Requesting DingTalk authorization QR code\u2026",
  "\u6B63\u5728\u7533\u8BF7\u4F01\u4E1A\u5FAE\u4FE1\u4E8C\u7EF4\u7801\u2026": "Requesting WeCom QR code\u2026",
  "\u6B63\u5728\u7533\u8BF7 QQ \u4E8C\u7EF4\u7801\u2026": "Requesting QQ QR code\u2026",
  "\u6B63\u5728\u751F\u6210 WhatsApp \u4E8C\u7EF4\u7801": "Generating WhatsApp QR code",
  "\u626B\u7801\uFF0C\u521B\u5EFA\u7B2C\u4E00\u4E2A\u98DE\u4E66\u5165\u53E3": "Scan to create your first Feishu bot",
  "\u626B\u7801\u53EA\u4F1A\u65B0\u589E\u4E00\u4E2A\u673A\u5668\u4EBA\uFF0C\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA\u4F1A\u7EE7\u7EED\u6B63\u5E38\u6536\u53D1\u6D88\u606F\u3002": "Scanning adds one bot. Existing bots will continue to send and receive messages.",
  "\u65E0\u9700\u624B\u52A8\u586B\u5199 App ID\u3002\u4EE5\u540E\u8FD8\u53EF\u4EE5\u7EE7\u7EED\u6DFB\u52A0\u673A\u5668\u4EBA\uFF0C\u5206\u522B\u670D\u52A1\u4E0D\u540C\u56E2\u961F\u6216\u98DE\u4E66\u79DF\u6237\u3002": "No App ID is required. You can add more bots later for different teams or Feishu tenants.",
  "\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u521B\u5EFA\u673A\u5668\u4EBA": "Scan with Feishu to create a bot",
  "\u5237\u65B0\u4E8C\u7EF4\u7801\u540E\u7EE7\u7EED": "Refresh the QR code to continue",
  "\u6253\u5F00\u98DE\u4E66\u79FB\u52A8\u7AEF\uFF0C\u4F7F\u7528\u626B\u4E00\u626B\u8BFB\u53D6\u4E8C\u7EF4\u7801": "Open Feishu on your phone and scan the QR code",
  "\u6838\u5BF9\u5E94\u7528\u540D\u79F0\u4E0E\u6743\u9650\u8303\u56F4\uFF0C\u5E76\u786E\u8BA4\u521B\u5EFA": "Review the app name and permissions, then confirm",
  "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u65B0\u673A\u5668\u4EBA\u7684\u957F\u8FDE\u63A5\u5C31\u7EEA": "Keep this page open until the bot connection is ready",
  "\u5728\u98DE\u4E66\u4E2D\u6253\u5F00": "Open in Feishu",
  "\u53D6\u6D88\u6DFB\u52A0": "Cancel",
  "\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u8865\u5168\u6743\u9650": "Scan with Feishu to complete permissions",
  "\u4F7F\u7528\u98DE\u4E66\u786E\u8BA4\u7FA4\u6D88\u606F\u6743\u9650": "Confirm group-message permission with Feishu",
  "\u626B\u7801\u4F1A\u66F4\u65B0\u73B0\u6709\u98DE\u4E66\u5E94\u7528\uFF0C\u53EA\u589E\u91CF\u5F00\u901A\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002\u786E\u8BA4\u540E\u4F1A\u81EA\u52A8\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u53D7\u5F71\u54CD\u3002": "Scanning updates the existing Feishu app with only the \u201CRead all messages in associated group chat\u201D scope. It does not create a new app. After confirmation, \u201CRespond to all group messages\u201D is enabled automatically; other bots are unaffected.",
  "\u6838\u5BF9\u73B0\u6709\u5E94\u7528\uFF0C\u5E76\u786E\u8BA4\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650": "Review the existing app and confirm the \u201CRead all messages in associated group chat\u201D permission",
  "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6743\u9650\u751F\u6548\u5E76\u81EA\u52A8\u5207\u6362\u54CD\u5E94\u65B9\u5F0F": "Keep this page open while the permission takes effect and the response mode switches automatically",
  "\u53D6\u6D88\u6388\u6743": "Cancel authorization",
  "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u542F\u7528\u5168\u90E8\u6D88\u606F\u6A21\u5F0F": "Confirmed. Enabling all-message mode",
  "\u6743\u9650\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u8BBE\u7F6E\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002": "The permission update was submitted. Saving the setting and reconnecting this bot. This stage cannot be cancelled; other bots will not be interrupted.",
  "\u6743\u9650\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u542F\u7528\u5168\u90E8\u6D88\u606F\u6A21\u5F0F\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002": "The permission update was submitted. Enabling all-message mode and reconnecting this bot. This stage cannot be cancelled; other bots will not be interrupted.",
  "\u6B63\u5728\u4E3A\u73B0\u6709\u98DE\u4E66\u5E94\u7528\u7533\u8BF7\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002": "Requesting a group-message permission QR code for the existing Feishu app\u2026",
  "\u7FA4\u6D88\u606F\u6743\u9650\u6CA1\u6709\u5F00\u901A\u5B8C\u6210": "Group-message permission was not granted",
  "\u626B\u7801\u4F1A\u66F4\u65B0\u73B0\u6709\u98DE\u4E66\u5E94\u7528\uFF0C\u6700\u591A\u589E\u91CF\u8865\u5145\u5361\u7247\u6309\u94AE\u56DE\u8C03\u3001\u8BFB\u53D6\u7528\u6237\u6D88\u606F\u5185\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:message:readonly\uFF08\u98DE\u4E66\u663E\u793A\u4E3A\u201C\u83B7\u53D6\u5355\u804A\u3001\u7FA4\u7EC4\u6D88\u606F\u201D\uFF09\uFF0C\u4EE5\u53CA\u4E0A\u4F20\u673A\u5668\u4EBA\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:resource\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002\u786E\u8BA4\u9875\u53EA\u663E\u793A\u5F53\u524D\u7F3A\u5C11\u9879\uFF0C\u5B8C\u6210\u540E\u6B64\u673A\u5668\u4EBA\u4F1A\u77ED\u6682\u91CD\u8FDE\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u53D7\u5F71\u54CD\u3002": "Scanning updates the existing Feishu app with up to three missing items: the card-button callback, im:message:readonly for reading images or files in user messages (shown by Feishu as \u201CRead direct and group messages\u201D), and im:resource for uploading images or files sent by the bot. It does not create a new app. The confirmation page shows only missing items; this bot reconnects briefly afterward, while other bots are unaffected.",
  "\u6838\u5BF9\u73B0\u6709\u5E94\u7528\u540D\u79F0\uFF0C\u5E76\u786E\u8BA4\u53EA\u65B0\u589E\u5F53\u524D\u7F3A\u5C11\u7684\u4E0A\u8FF0\u914D\u7F6E": "Review the existing app name and confirm that only the missing items described above are added",
  "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6743\u9650\u4E0E\u56DE\u8C03\u8865\u5168\u5B8C\u6210": "Keep this page open until permissions and the callback are complete",
  "\u53D6\u6D88\u8865\u5168": "Cancel setup",
  "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u5B8C\u6210\u6743\u9650\u4E0E\u56DE\u8C03\u914D\u7F6E": "Confirmed. Completing permissions and callback setup",
  "\u6B63\u5728\u51C6\u5907\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801": "Preparing the permission-completion QR code",
  "\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u6743\u9650\u3001\u9A8C\u8BC1\u5361\u7247\u56DE\u8C03\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002": "The update was submitted. Saving permissions, verifying the card callback, and reconnecting this bot. This stage cannot be cancelled; other bots will not be interrupted.",
  "\u6B63\u5728\u4E3A\u73B0\u6709\u98DE\u4E66\u5E94\u7528\u7533\u8BF7\u4E00\u6B21\u6027\u66F4\u65B0\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002": "Requesting a one-time update QR code for the existing Feishu app\u2026",
  "\u6743\u9650\u4E0E\u56DE\u8C03\u6CA1\u6709\u8865\u5168\u5B8C\u6210": "Permissions and callback setup did not finish",
  "\u8865\u5168\u6743\u9650": "Complete permissions",
  "\u8865\u5168\u8303\u56F4": "Completion scope",
  "\u6700\u591A\u589E\u91CF\u6DFB\u52A0\u5361\u7247\u56DE\u8C03 card.action.trigger\u3001\u8BFB\u53D6\u6D88\u606F\u5185\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:message:readonly\uFF08\u98DE\u4E66\u663E\u793A\u4E3A\u201C\u83B7\u53D6\u5355\u804A\u3001\u7FA4\u7EC4\u6D88\u606F\u201D\uFF09\uFF0C\u4EE5\u53CA\u4E0A\u4F20\u673A\u5668\u4EBA\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:resource\uFF1B\u786E\u8BA4\u9875\u53EA\u663E\u793A\u5F53\u524D\u7F3A\u5C11\u9879\uFF0C\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002": "Adds up to the missing card callback card.action.trigger, im:message:readonly for reading images or files in messages (shown by Feishu as \u201CRead direct and group messages\u201D), and im:resource for uploading images or files sent by the bot. The confirmation page shows only missing items; no new app is created.",
  "\u7B49\u5F85\u626B\u7801\u2026": "Waiting for scan\u2026",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801": "Feishu returned a permission-completion QR code for a different bot",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801": "Feishu returned a group-message permission QR code for a different bot",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u4FEE\u590D\u4FE1\u606F\u7F3A\u5C11 botId": "Feishu repair status is missing the bot ID",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u5E94\u7528\u66F4\u65B0\u4FE1\u606F\u7F3A\u5C11 botId": "Feishu app-update status is missing the bot ID",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u6CE8\u518C\u8FDB\u5EA6": "Feishu returned registration progress for a different operation",
  "\u6B64\u673A\u5668\u4EBA": "this bot",
  "\u7528\u4E8E\u4E3A${botName}\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801": "One-time QR code for granting group-message permission to ${botName}",
  "\u6B63\u5728\u4E3A\u300C${botName}\u300D\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650": "Granting group-message permission to \u201C${botName}\u201D",
  '${botName ?? "\u673A\u5668\u4EBA"}\u7684\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u3002': 'Permission-completion QR code generated for ${botName ?? "bot"}. Scan it with Feishu.',
  '${botName ?? "\u673A\u5668\u4EBA"}\u7684\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u786E\u8BA4\u3002': 'Group-message permission QR code generated for ${botName ?? "bot"}. Confirm it with Feishu.',
  "${targetBotName}\u5DF2\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\uFF0C\u5E76\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\u3002": "${targetBotName} now has group-message permission and \u201CRespond to all group messages\u201D is enabled.",
  "${targetBot.bot.name}\u5DF2\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\uFF0C\u5E76\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\u3002": "${targetBot.bot.name} now has group-message permission and \u201CRespond to all group messages\u201D is enabled.",
  "${targetBot.bot.name}\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5728\u98DE\u4E66\u4E2D\u5F00\u59CB\u804A\u5929\u3002": "${targetBot.bot.name} is connected and ready to chat in Feishu.",
  "\u5DF2\u53D6\u6D88\u8865\u5168\u6743\u9650\u4E0E\u56DE\u8C03\u3002": "Completing permissions and the callback was cancelled.",
  "\u5DF2\u53D6\u6D88\u7FA4\u6D88\u606F\u6743\u9650\u6388\u6743\u3002": "Group-message permission authorization was cancelled.",
  "\u6743\u9650\u4E0E\u56DE\u8C03\u5DF2\u66F4\u65B0\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u673A\u5668\u4EBA\u8FDE\u63A5\u72B6\u6001": "Permissions and the callback were updated, but the bot connection could not be confirmed yet",
  "\u7FA4\u6D88\u606F\u6743\u9650\u5DF2\u66F4\u65B0\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u673A\u5668\u4EBA\u8FDE\u63A5\u72B6\u6001": "The group-message permission was updated, but the bot connection could not be confirmed yet",
  "\u98DE\u4E66\u6743\u9650\u4E0E\u56DE\u8C03\u8865\u5168\u5931\u8D25": "Could not complete Feishu permissions and callback setup",
  "\u98DE\u4E66\u7FA4\u6D88\u606F\u6743\u9650\u5F00\u901A\u5931\u8D25": "Could not grant the Feishu group-message permission",
  "\u8BF7\u5148\u5B8C\u6210\u5F53\u524D\u98DE\u4E66\u6388\u6743\u64CD\u4F5C\uFF0C\u518D\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\u3002": "Finish the current Feishu authorization before granting group-message permission.",
  "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u8FDE\u63A5\u65B0\u673A\u5668\u4EBA": "Confirmed. Connecting the new bot",
  "\u6B63\u5728\u5B89\u5168\u4FDD\u5B58\u51ED\u636E\u5E76\u68C0\u67E5\u65B0\u673A\u5668\u4EBA\u7684\u6D88\u606F\u901A\u9053\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002": "Saving credentials and checking the new bot connection. Existing bots will not be interrupted.",
  "\u6B63\u5728\u5411\u98DE\u4E66\u7533\u8BF7\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002": "Requesting a one-time authorization QR code from Feishu\u2026",
  "\u65B0\u673A\u5668\u4EBA\u6CA1\u6709\u6DFB\u52A0\u5B8C\u6210": "The new bot was not added",
  "\u65B0\u98DE\u4E66\u673A\u5668\u4EBA\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u804A\u5929\u3002": "The new Feishu bot is connected and ready to chat.",
  "\u98DE\u4E66\u5E94\u7528\u521B\u5EFA\u5931\u8D25": "Could not create the Feishu app",
  "\u673A\u5668\u4EBA\u5DF2\u7ECF\u521B\u5EFA\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u8FDE\u63A5\u72B6\u6001": "The bot was created, but its connection could not be confirmed yet",
  "\u673A\u5668\u4EBA\u4ECD\u672A\u8FDE\u63A5": "The bot is still offline",
  "\u673A\u5668\u4EBA\u5C1A\u672A\u8FDE\u63A5": "The bot is not connected yet",
  "\u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38": "Persistent connection is healthy",
  "\u957F\u8FDE\u63A5": "Persistent connection",
  "\u5E94\u7528\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58": "App identifier stored securely",
  "\u673A\u5668\u4EBA\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58": "Bot identifier stored securely",
  "\u5DF2\u5B89\u5168\u4FDD\u5B58": "Stored securely",
  "\u5DF2\u63A5\u5165\u7684\u5FAE\u4FE1\u8D26\u53F7": "Connected WeChat accounts",
  "\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA": "Connected bots",
  "\u5DF2\u63A5\u5165\u7684\u9489\u9489\u673A\u5668\u4EBA": "Connected DingTalk bots",
  "\u5DF2\u7ED1\u5B9A\u7684\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "Connected WeCom bots",
  "\u5DF2\u7ED1\u5B9A\u7684 QQ \u673A\u5668\u4EBA": "Connected QQ bots",
  "\u5DF2\u63A5\u5165\u7684 WhatsApp \u673A\u5668\u4EBA": "Connected WhatsApp accounts",
  "\u4F7F\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u4E8C\u7EF4\u7801": "Scan with WeChat on your phone",
  "\u626B\u4E00\u6B21\u7801\uFF0C\u5C31\u80FD\u5728\u5FAE\u4FE1\u91CC\u4F7F\u7528 Harness": "Scan once to use Harness in WeChat",
  "\u6253\u5F00\u624B\u673A\u5FAE\u4FE1\u5E76\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801": "Open WeChat on your phone and scan the QR code",
  "\u5728\u5FAE\u4FE1\u4E2D\u786E\u8BA4\u8FDE\u63A5\u8BE5\u673A\u5668\u4EBA": "Confirm the bot connection in WeChat",
  "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u673A\u5668\u4EBA\u81EA\u52A8\u8FDE\u63A5": "Keep this page open while the bot connects",
  "\u7B49\u5F85\u5FAE\u4FE1\u626B\u7801": "Waiting for WeChat scan",
  "\u9700\u8981\u914D\u5BF9\u7801": "Pairing code required",
  "\u8F93\u5165\u624B\u673A\u5FAE\u4FE1\u663E\u793A\u7684\u6570\u5B57": "Enter the number shown in WeChat",
  "\u5FAE\u4FE1\u914D\u5BF9\u7801": "WeChat pairing code",
  "\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4": "Scanned. Confirm on your phone",
  "\u914D\u5BF9\u7801\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u7B49\u5F85\u5FAE\u4FE1\u786E\u8BA4\u3002": "Pairing code submitted. Waiting for WeChat confirmation.",
  "\u8FD9\u662F\u5FAE\u4FE1\u9644\u52A0\u7684\u5B89\u5168\u786E\u8BA4\u6B65\u9AA4\u3002\u914D\u5BF9\u7801\u53EA\u7528\u4E8E\u672C\u6B21\u626B\u7801\u8F6E\u8BE2\uFF0C\u4E0D\u4F1A\u5199\u5165\u914D\u7F6E\u6216\u65E5\u5FD7\u3002": "This is an additional WeChat confirmation step. The pairing code is used only for this connection and is never stored.",
  "\u6B63\u5728\u4FDD\u5B58\u51ED\u636E\u5E76\u9A8C\u8BC1 Harness \u4E0E\u5FAE\u4FE1\u957F\u8F6E\u8BE2\u3002": "Saving credentials and verifying the WeChat connection.",
  "\u5FAE\u4FE1\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u542F\u52A8\u6D88\u606F\u8FDE\u63A5": "Confirmed in WeChat. Starting the message connection",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u65E0\u6CD5\u8BFB\u53D6\u73B0\u6709\u767B\u5F55\u51ED\u636E\u3002\u8BF7\u68C0\u67E5 DSH \u51ED\u636E\u5B58\u50A8\u3002": "WeChat was authorized, but the existing login credential could not be read. Check the DSH credential store.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u767B\u5F55\u51ED\u636E\u65E0\u6CD5\u5199\u5165 DSH \u51ED\u636E\u5B58\u50A8\u3002\u8BF7\u68C0\u67E5\u51ED\u636E\u5B58\u50A8\u662F\u5426\u53EF\u5199\u3002": "WeChat was authorized, but the login credential could not be written to the DSH credential store. Check that the store is writable.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u8D26\u53F7\u914D\u7F6E\u65E0\u6CD5\u5199\u5165\u672C\u673A\u3002\u8BF7\u68C0\u67E5 DSH_HOME \u76EE\u5F55\u6743\u9650\u3002": "WeChat was authorized, but the account configuration could not be saved locally. Check the DSH_HOME directory permissions.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u65E0\u6CD5\u521D\u59CB\u5316\u8D26\u53F7\u72B6\u6001\u6216\u5DE5\u4F5C\u533A\u3002\u8BF7\u68C0\u67E5 DSH_HOME \u548C\u5DE5\u4F5C\u533A\u76EE\u5F55\u3002": "WeChat was authorized, but the account state or workspace could not be initialized. Check DSH_HOME and the workspace directory.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u63D2\u4EF6\u65E0\u6CD5\u8FDE\u63A5\u672C\u673A Harness\u3002\u8BF7\u68C0\u67E5 dsh web \u5730\u5740\u548C\u7AEF\u53E3\u3002": "WeChat was authorized, but the plugin could not connect to the local Harness. Check the dsh web address and port.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u5065\u5EB7\u68C0\u67E5\u8D85\u65F6\u3002\u8BF7\u786E\u8BA4 dsh web \u672A\u963B\u585E\u3002": "WeChat was authorized, but the Harness health check timed out. Confirm that dsh web is not blocked.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u62D2\u7EDD\u4E86\u672C\u673A\u5065\u5EB7\u68C0\u67E5\u3002\u8BF7\u68C0\u67E5 Host \u4FE1\u4EFB\u914D\u7F6E\u3002": "WeChat was authorized, but Harness denied the local health check. Check the Host trust configuration.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u627E\u4E0D\u5230 Harness \u5065\u5EB7\u68C0\u67E5\u63A5\u53E3\u3002\u8BF7\u786E\u8BA4 Harness \u4E0E\u63D2\u4EF6\u7248\u672C\u517C\u5BB9\u3002": "WeChat was authorized, but the Harness health endpoint was not found. Confirm that Harness and the plugin are compatible.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE\u670D\u52A1\u9519\u8BEF\u3002\u8BF7\u67E5\u770B dsh web \u65E5\u5FD7\u3002": "WeChat was authorized, but the Harness health check returned a service error. Check the dsh web logs.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94\u3002\u8BF7\u786E\u8BA4 Harness \u4E0E\u63D2\u4EF6\u7248\u672C\u517C\u5BB9\u3002": "WeChat was authorized, but Harness returned an unrecognized response. Confirm that Harness and the plugin are compatible.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u62D2\u7EDD\u4E86\u5065\u5EB7\u68C0\u67E5\u8BF7\u6C42\u3002\u8BF7\u67E5\u770B dsh web \u65E5\u5FD7\u3002": "WeChat was authorized, but Harness rejected the health-check request. Check the dsh web logs.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46 Harness \u5065\u5EB7\u68C0\u67E5\u53D1\u751F\u672A\u77E5\u9519\u8BEF\u3002\u8BF7\u67E5\u770B dsh web \u65E5\u5FD7\u3002": "WeChat was authorized, but the Harness health check failed unexpectedly. Check the dsh web logs.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u6D88\u606F\u8FDE\u63A5\u521D\u59CB\u5316\u5931\u8D25\u3002\u8BF7\u67E5\u770B dsh web \u65E5\u5FD7\u540E\u91CD\u8BD5\u3002": "WeChat was authorized, but the message connection could not be initialized. Check the dsh web logs and try again.",
  "\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u4F46\u6FC0\u6D3B\u8FC7\u7A0B\u4E2D\u53D1\u751F\u672A\u77E5\u9519\u8BEF\u3002\u8BF7\u67E5\u770B dsh web \u65E5\u5FD7\u3002": "WeChat was authorized, but an unknown error occurred during activation. Check the dsh web logs.",
  "\u5FAE\u4FE1\u5DF2\u7ED1\u5B9A\uFF0C\u53EF\u4EE5\u5F00\u59CB\u5411\u5DF2\u7ED1\u5B9A\u7684\u673A\u5668\u4EBA\u53D1\u6D88\u606F\u3002": "WeChat is connected and ready for messages.",
  "\u8FD9\u4E2A\u5FAE\u4FE1\u8D26\u53F7\u5DF2\u7ECF\u7ED1\u5B9A\u5E76\u4FDD\u6301\u5728\u7EBF\u3002": "This WeChat account is connected and online.",
  "\u5FAE\u4FE1\u8D26\u53F7\u53CA\u672C\u673A\u51ED\u636E\u5DF2\u79FB\u9664\u3002": "The WeChat account and local credentials were removed.",
  "\u5DF2\u53D6\u6D88\u5FAE\u4FE1\u7ED1\u5B9A\u3002": "WeChat setup was cancelled.",
  "\u6B63\u5728\u8054\u7CFB\u817E\u8BAF\u5FAE\u4FE1 iLink \u670D\u52A1\u3002": "Contacting the WeChat iLink service.",
  "iLink \u957F\u8F6E\u8BE2": "iLink long polling",
  "\u626B\u4E00\u6B21\u7801\uFF0C\u81EA\u52A8\u521B\u5EFA\u5E76\u8FDE\u63A5\u673A\u5668\u4EBA": "Scan once to create and connect a bot",
  "\u4F7F\u7528\u9489\u9489 App \u5B8C\u6210\u673A\u5668\u4EBA\u6388\u6743": "Authorize the bot with the DingTalk app",
  "\u4F7F\u7528\u5DF2\u52A0\u5165\u4F01\u4E1A/\u7EC4\u7EC7\u7684\u9489\u9489\u8D26\u53F7\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801": "Scan the QR code with a DingTalk account that belongs to an organization",
  "\u5728\u6388\u6743\u9875\u70B9\u51FB\u201C\u4E00\u952E\u521B\u5EFA\u65B0\u673A\u5668\u4EBA\u201D": "Select \u201CCreate new bot\u201D on the authorization page",
  "\u8BF7\u52FF\u5173\u95ED\u672C\u9875\uFF0C\u9489\u9489\u5B8C\u6210\u6388\u6743\u540E\u5C06\u81EA\u52A8\u7EE7\u7EED\u3002": "Keep this page open. Setup will continue after DingTalk authorization.",
  "\u7B49\u5F85\u9489\u9489\u626B\u7801\u6388\u6743": "Waiting for DingTalk authorization",
  "\u6388\u6743\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u521B\u5EFA\u9489\u9489\u673A\u5668\u4EBA": "Authorized. Creating the DingTalk bot",
  "\u6B63\u5728\u786E\u8BA4\u9489\u9489\u6388\u6743": "Confirming DingTalk authorization",
  "\u6B63\u5728\u68C0\u67E5\u9489\u9489 Stream \u957F\u8FDE\u63A5\uFF0C\u6210\u529F\u540E\u4F1A\u81EA\u52A8\u663E\u793A\u4E3A\u5728\u7EBF\u3002": "Checking the DingTalk Stream connection. It will appear online when ready.",
  "\u9489\u9489\u673A\u5668\u4EBA\u5DF2\u63A5\u5165\uFF0C\u53EF\u4EE5\u5F00\u59CB\u53D1\u9001\u6D88\u606F\u3002": "The DingTalk bot is connected and ready for messages.",
  "\u8FD9\u4E2A\u9489\u9489\u673A\u5668\u4EBA\u5DF2\u7ECF\u63A5\u5165\u5E76\u4FDD\u6301\u5728\u7EBF\u3002": "This DingTalk bot is connected and online.",
  "Stream \u957F\u8FDE\u63A5": "Stream persistent connection",
  "\u4F7F\u7528\u4F01\u4E1A\u5FAE\u4FE1 App \u626B\u7801\u521B\u5EFA\u667A\u80FD\u673A\u5668\u4EBA": "Scan with WeCom to create an AI bot",
  "\u4F7F\u7528\u4F01\u4E1A\u5FAE\u4FE1 App \u5B8C\u6210\u667A\u80FD\u673A\u5668\u4EBA\u6388\u6743": "Authorize the AI bot with WeCom",
  "\u6253\u5F00\u4F01\u4E1A\u5FAE\u4FE1 App\uFF0C\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801": "Open WeCom and scan the QR code",
  "\u5728\u817E\u8BAF\u6388\u6743\u9875\u9762\u786E\u8BA4\u521B\u5EFA\u667A\u80FD\u673A\u5668\u4EBA": "Confirm bot creation on the Tencent authorization page",
  "\u8FD4\u56DE\u8FD9\u91CC\u7B49\u5F85\u8FDE\u63A5\u5B8C\u6210": "Return here and wait for the connection to complete",
  "\u7B49\u5F85\u4F01\u4E1A\u5FAE\u4FE1 App \u626B\u7801": "Waiting for WeCom scan",
  "\u4F01\u4E1A\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u6B63\u5728\u8FDE\u63A5\u673A\u5668\u4EBA": "Authorized in WeCom. Connecting the bot",
  "\u51ED\u636E\u6B63\u5728\u5199\u5165\u672C\u673A\uFF0C\u5E76\u542F\u52A8\u4F01\u4E1A\u5FAE\u4FE1 WebSocket \u6D88\u606F\u8FDE\u63A5\u3002": "Saving credentials locally and starting the WeCom WebSocket connection.",
  "WebSocket \u957F\u8FDE\u63A5": "WebSocket persistent connection",
  "\u4F7F\u7528\u624B\u673A QQ \u626B\u7801\u521B\u5EFA\u5E76\u7ED1\u5B9A\u673A\u5668\u4EBA": "Scan with mobile QQ to create and connect a bot",
  "\u4F7F\u7528\u624B\u673A QQ \u5B8C\u6210\u673A\u5668\u4EBA\u7ED1\u5B9A": "Complete bot setup with mobile QQ",
  "\u6253\u5F00\u624B\u673A QQ\uFF0C\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801": "Open mobile QQ and scan the QR code",
  "\u5728\u817E\u8BAF\u6388\u6743\u9875\u9762\u786E\u8BA4\u521B\u5EFA\u6216\u7ED1\u5B9A\u673A\u5668\u4EBA": "Confirm bot creation or connection on the Tencent authorization page",
  "\u7B49\u5F85\u624B\u673A QQ \u626B\u7801": "Waiting for mobile QQ scan",
  "QQ \u5DF2\u6388\u6743\uFF0C\u6B63\u5728\u8FDE\u63A5\u673A\u5668\u4EBA": "Authorized in QQ. Connecting the bot",
  "\u51ED\u636E\u6B63\u5728\u5199\u5165\u672C\u673A\uFF0C\u5E76\u542F\u52A8 QQ WebSocket \u6D88\u606F\u8FDE\u63A5\u3002": "Saving credentials locally and starting the QQ WebSocket connection.",
  "\u4F7F\u7528\u624B\u673A WhatsApp \u626B\u63CF\u4E8C\u7EF4\u7801\u5373\u53EF\u63A5\u5165\u3002": "Scan the QR code with WhatsApp to connect.",
  "\u7528\u624B\u673A WhatsApp \u626B\u63CF\u4E8C\u7EF4\u7801": "Scan with WhatsApp on your phone",
  "\u6253\u5F00 WhatsApp \u2192 \u8BBE\u7F6E \u2192 \u5DF2\u5173\u8054\u8BBE\u5907": "Open WhatsApp \u2192 Settings \u2192 Linked devices",
  "\u70B9\u51FB\u201C\u5173\u8054\u8BBE\u5907\u201D\u5E76\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801": "Select \u201CLink a device\u201D and scan the QR code",
  "\u7B49\u5F85 WhatsApp \u626B\u7801": "Waiting for WhatsApp scan",
  "\u5DF2\u626B\u7801\uFF0C\u6B63\u5728\u8FDE\u63A5 WhatsApp": "Scanned. Connecting WhatsApp",
  "\u6B63\u5728\u5EFA\u7ACB\u5B89\u5168\u7684\u5173\u8054\u8BBE\u5907\u4F1A\u8BDD\u3002": "Creating a secure linked-device session.",
  "\u5173\u8054\u8BBE\u5907\u6B63\u5728\u63A5\u5165 DeepSeek Harness\u3002": "Linking the device to DeepSeek Harness.",
  "WhatsApp Web \u5173\u8054\u8BBE\u5907\u8FD0\u884C\u6B63\u5E38": "WhatsApp linked device is healthy",
  "\u67E5\u770B WhatsApp \u8BBF\u95EE\u6A21\u5F0F\u8BF4\u660E": "View WhatsApp access mode details",
  "WhatsApp \u8BBF\u95EE\u6A21\u5F0F": "WhatsApp access mode",
  "\u4EC5\u81EA\u5DF1\u6A21\u5F0F": "Only me",
  "\u6307\u5B9A\u8054\u7CFB\u4EBA\u6A21\u5F0F": "Selected contacts",
  "\u5F00\u653E\u54CD\u5E94\u6A21\u5F0F": "Open responses",
  "\u4EC5\u81EA\u5DF1\u6A21\u5F0F\uFF08\u9ED8\u8BA4\uFF09": "Only me (default)",
  "\u5DF2\u751F\u6548\uFF1A": "Active: ",
  "\u53EA\u54CD\u5E94\u5DF2\u7ED1\u5B9A WhatsApp \u8D26\u53F7\u7684\u81EA\u804A\u6D88\u606F\u3002": "Only respond to self-chat messages from the linked WhatsApp account.",
  "\u54CD\u5E94\u81EA\u804A\u548C\u767D\u540D\u5355\u8054\u7CFB\u4EBA\u7684\u79C1\u804A\uFF0C\u5FFD\u7565\u7FA4\u804A\u3002": "Respond to self-chat and allowlisted direct messages; ignore group messages.",
  "\u54CD\u5E94\u6240\u6709\u79C1\u804A\u3001\u5DF2\u7ED1\u5B9A\u8D26\u53F7\u81EA\u5DF1\u53D1\u51FA\u7684\u7FA4\u804A\u6D88\u606F\uFF0C\u4EE5\u53CA\u5176\u4ED6\u7FA4\u6210\u5458\u7684\u63D0\u53CA\u6216\u56DE\u590D\u3002": "Respond to all direct messages, group messages sent by the linked account, and mentions or replies from other group members.",
  "\u5141\u8BB8\u79C1\u804A\u7684 WhatsApp \u7535\u8BDD\u53F7\u7801": "WhatsApp phone numbers allowed to send direct messages",
  "\u6BCF\u884C\u4E00\u4E2A\u542B\u56FD\u5BB6\u6216\u5730\u533A\u4EE3\u7801\u7684\u53F7\u7801": "One number with country or region code per line",
  "\u53EF\u4EE5\u5305\u542B\u5F00\u5934\u7684 +\uFF0C\u4FDD\u5B58\u65F6\u4F1A\u81EA\u52A8\u79FB\u9664\u3002": "A leading + is allowed and removed when saved.",
  "\u4EC5\u6307\u5B9A\u8054\u7CFB\u4EBA\u6A21\u5F0F\u4F7F\u7528\u767D\u540D\u5355\uFF0C\u5207\u6362\u6A21\u5F0F\u65F6\u4F1A\u4FDD\u7559\u3002": "Only Selected contacts uses the allowlist; it is retained when modes change.",
  "\u767D\u540D\u5355\u4E3A\u7A7A\uFF1B\u4FDD\u5B58\u540E\u5C06\u53EA\u63A5\u53D7\u81EA\u804A\u6D88\u606F\u3002": "The allowlist is empty; only self-chat messages will be accepted after saving.",
  "\u7535\u8BDD\u53F7\u7801\u5FC5\u987B\u5305\u542B\u56FD\u5BB6\u6216\u5730\u533A\u4EE3\u7801\uFF0C\u6BCF\u884C\u4E00\u4E2A\u3002": "Each phone number must include a country or region code on its own line.",
  "WhatsApp \u8BBF\u95EE\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528\u3002": "WhatsApp access settings are currently unavailable.",
  "WhatsApp \u8BBF\u95EE\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002": "Could not save WhatsApp access settings.",
  "Bot API \u957F\u8F6E\u8BE2": "Bot API long polling",
  " Gateway \u957F\u8FDE\u63A5": " Gateway persistent connection",
  "Gateway \u957F\u8FDE\u63A5": "Gateway persistent connection",
  " Socket Mode \u957F\u8FDE\u63A5": " Socket Mode persistent connection",
  "Socket Mode \u957F\u8FDE\u63A5": "Socket Mode persistent connection",
  "\u63A5\u5165 Telegram \u673A\u5668\u4EBA": "Connect a Telegram bot",
  "\u5148\u901A\u8FC7 @BotFather \u83B7\u53D6 Bot Token\uFF0C\u518D\u5728\u8FD9\u91CC\u5B8C\u6210\u63A5\u5165\u3002": "Get a Bot Token from @BotFather, then connect it here.",
  "\u586B\u5199 @BotFather \u751F\u6210\u7684 Bot Token": "Enter the Bot Token from @BotFather",
  "\u8BBF\u95EE\u6A21\u5F0F": "Access mode",
  "\u8BBF\u95EE\u8BBE\u7F6E": "Access settings",
  "Telegram \u8BBF\u95EE\u6A21\u5F0F": "Telegram access mode",
  "\u67E5\u770B Telegram \u8BBF\u95EE\u6A21\u5F0F\u8BF4\u660E": "View Telegram access mode details",
  "\u7FA4\u804A\u5168\u90E8\u5FFD\u7565\uFF0C\u79C1\u804A\u4EC5\u5141\u8BB8\u767D\u540D\u5355\u7528\u6237\u3002": "All group messages are ignored; only allowlisted users may send DMs.",
  "\u4FDD\u6301\u539F\u6709\u884C\u4E3A\uFF1A\u79C1\u804A\u76F4\u63A5\u54CD\u5E94\uFF0C\u7FA4\u804A\u5728\u88AB\u63D0\u53CA\u6216\u56DE\u590D\u65F6\u54CD\u5E94\u3002": "Keep the original behavior: respond to DMs and to group mentions or replies.",
  "\u5B89\u5168\u6A21\u5F0F": "Safe mode",
  "\u517C\u5BB9\u6A21\u5F0F": "Compatible mode",
  "\u5DF2\u751F\u6548\uFF1A\u5B89\u5168\u6A21\u5F0F": "Active: Safe mode",
  "\u5DF2\u751F\u6548\uFF1A\u517C\u5BB9\u6A21\u5F0F": "Active: Compatible mode",
  "\u6A21\u5F0F": "Mode",
  "\u517C\u5BB9\u6A21\u5F0F\uFF08\u9ED8\u8BA4\uFF09": "Compatible mode (default)",
  "\u5B89\u5168\u6A21\u5F0F\uFF08\u79C1\u804A\u767D\u540D\u5355\uFF09": "Safe mode (private-chat allowlist)",
  "\u5141\u8BB8\u79C1\u804A\u7684 Telegram User ID": "Telegram User IDs allowed to send DMs",
  "\u6BCF\u884C\u4E00\u4E2A\u6570\u5B57 User ID": "One numeric User ID per line",
  "\u767D\u540D\u5355\u4EC5\u5C5E\u4E8E\u5F53\u524D\u673A\u5668\u4EBA\u3002": "This allowlist belongs only to the current bot.",
  "\u517C\u5BB9\u6A21\u5F0F\u4E0B\u6682\u4E0D\u4F7F\u7528\u767D\u540D\u5355\uFF0C\u5207\u6362\u6A21\u5F0F\u65F6\u4F1A\u4FDD\u7559\u3002": "Compatible mode does not enforce the allowlist; it is retained when modes change.",
  "\u767D\u540D\u5355\u4E3A\u7A7A\uFF1B\u4FDD\u5B58\u540E\u8BE5\u673A\u5668\u4EBA\u4F1A\u62D2\u7EDD\u6240\u6709\u5165\u7AD9\u6D88\u606F\u3002": "The allowlist is empty; this bot will reject all inbound messages after saving.",
  "\u6B63\u5728\u4FDD\u5B58\u2026": "Saving\u2026",
  "\u4FDD\u5B58\u8BBF\u95EE\u8BBE\u7F6E": "Save access settings",
  "User ID \u5FC5\u987B\u662F 1\u201316 \u4F4D\u6B63\u6574\u6570\uFF0C\u6BCF\u884C\u4E00\u4E2A\u3002": "Each User ID must be a 1\u201316 digit positive integer on its own line.",
  "Telegram \u8BBF\u95EE\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528\u3002": "Telegram access settings are currently unavailable.",
  "Telegram \u8BBF\u95EE\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002": "Could not save Telegram access settings.",
  "\u63A5\u5165 Discord \u673A\u5668\u4EBA": "Connect a Discord bot",
  "\u5148\u5728 Developer Portal \u521B\u5EFA Bot \u5E76\u9080\u8BF7\u5230\u670D\u52A1\u5668\uFF0C\u518D\u5728\u8FD9\u91CC\u5B8C\u6210\u63A5\u5165\u3002": "Create a bot in the Developer Portal and invite it to your server, then connect it here.",
  "\u586B\u5199 Discord Developer Portal \u7684 Bot Token": "Enter the Bot Token from the Discord Developer Portal",
  "\u63A5\u5165 Slack \u673A\u5668\u4EBA": "Connect a Slack bot",
  "\u5148\u7528 Manifest \u521B\u5EFA\u5E76\u914D\u7F6E Slack App": "Create and configure a Slack app with the manifest",
  "\u590D\u5236\u914D\u7F6E\u540E\uFF0C\u5728 Slack \u9009\u62E9 From a manifest\uFF1B\u521B\u5EFA\u5B8C\u6210\u540E\u751F\u6210 connections:write App Token\uFF0C\u5E76\u5C06\u5E94\u7528\u5B89\u88C5\u5230\u5DE5\u4F5C\u533A\u3002": "Copy the manifest and choose \u201CFrom a manifest\u201D in Slack. Then create a connections:write App Token and install the app to your workspace.",
  "\u590D\u5236 Manifest": "Copy manifest",
  "\u5DF2\u590D\u5236 Manifest": "Manifest copied",
  "\u6253\u5F00 Slack \u521B\u5EFA\u9875": "Open Slack app creation",
  "Bot Token \u6765\u81EA OAuth & Permissions\uFF1BApp Token \u6765\u81EA Basic Information\uFF0C\u5E76\u4E14\u5FC5\u987B\u5305\u542B connections:write\u3002": "Get the Bot Token from OAuth & Permissions and the App Token from Basic Information. The App Token must include connections:write.",
  "\u4F7F\u7528\u5B98\u65B9 App Manifest \u5FEB\u901F\u914D\u7F6E\u673A\u5668\u4EBA\uFF0C\u518D\u586B\u5199 Bot Token \u4E0E App Token \u5EFA\u7ACB\u672C\u5730 Socket Mode \u8FDE\u63A5\u3002": "Configure the bot with the official app manifest, then enter the Bot Token and App Token to start a local Socket Mode connection.",
  "Slack \u5DE5\u4F5C\u533A": "Slack workspace",
  "Bot Token \u4E0E App Token": "Bot Token and App Token",
  "\u586B\u5199 Bot Token": "Enter Bot Token",
  "\u624B\u52A8\u63A5\u5165\u98DE\u4E66\u673A\u5668\u4EBA": "Connect Feishu bot manually",
  "\u624B\u52A8\u63A5\u5165\u9489\u9489\u673A\u5668\u4EBA": "Connect DingTalk bot manually",
  "\u624B\u52A8\u63A5\u5165\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "Connect WeCom bot manually",
  "\u624B\u52A8\u63A5\u5165QQ\u673A\u5668\u4EBA": "Connect QQ bot manually",
  "\u586B\u5199\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 App ID": "Enter the Feishu Open Platform App ID",
  "\u586B\u5199\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 App Secret": "Enter the Feishu Open Platform App Secret",
  "\u586B\u5199\u9489\u9489\u5E94\u7528 Client ID": "Enter the DingTalk Client ID",
  "\u586B\u5199\u9489\u9489\u5E94\u7528 Client Secret": "Enter the DingTalk Client Secret",
  "\u586B\u5199\u4F01\u4E1A\u5FAE\u4FE1\u667A\u80FD\u673A\u5668\u4EBA Bot ID": "Enter the WeCom AI Bot ID",
  "\u586B\u5199\u4F01\u4E1A\u5FAE\u4FE1\u667A\u80FD\u673A\u5668\u4EBA Secret": "Enter the WeCom AI Bot Secret",
  "\u586B\u5199 QQ \u5F00\u653E\u5E73\u53F0 AppID": "Enter the QQ Open Platform AppID",
  "\u586B\u5199 QQ \u5F00\u653E\u5E73\u53F0 AppSecret": "Enter the QQ Open Platform AppSecret",
  "\u626B\u7801\u63A5\u5165\u5FAE\u4FE1\u673A\u5668\u4EBA": "Connect WeChat bot by QR code",
  "\u626B\u7801\u63A5\u5165\u98DE\u4E66\u673A\u5668\u4EBA": "Connect Feishu bot by QR code",
  "\u626B\u7801\u63A5\u5165\u9489\u9489\u673A\u5668\u4EBA": "Connect DingTalk bot by QR code",
  "\u626B\u7801\u63A5\u5165\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "Connect WeCom bot by QR code",
  "\u626B\u7801\u63A5\u5165 QQ \u673A\u5668\u4EBA": "Connect QQ bot by QR code",
  "\u626B\u7801\u63A5\u5165 WhatsApp \u673A\u5668\u4EBA": "Connect WhatsApp by QR code",
  "\u626B\u7801\u7ED1\u5B9A WhatsApp \u673A\u5668\u4EBA": "Connect WhatsApp by QR code",
  "\u4F7F\u7528 App ID \u548C App Secret \u7ED1\u5B9A\u98DE\u4E66\u673A\u5668\u4EBA": "Connect a Feishu bot with App ID and App Secret",
  "\u4F7F\u7528 Client ID \u548C Client Secret \u7ED1\u5B9A\u9489\u9489\u673A\u5668\u4EBA": "Connect a DingTalk bot with Client ID and Client Secret",
  "\u4F7F\u7528 Bot ID \u548C Secret \u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "Connect a WeCom bot with Bot ID and Secret",
  "\u4F7F\u7528 AppID \u548C AppSecret \u7ED1\u5B9A QQ \u673A\u5668\u4EBA": "Connect a QQ bot with AppID and AppSecret",
  "\u4F7F\u7528 Manifest \u548C\u53CC Token \u63A5\u5165 Slack \u673A\u5668\u4EBA": "Connect a Slack bot with a manifest and two tokens",
  "\u4F7F\u7528 Bot Token \u63A5\u5165 Telegram \u673A\u5668\u4EBA": "Connect a Telegram bot with a Bot Token",
  "\u4F7F\u7528 Bot Token \u63A5\u5165 Discord \u673A\u5668\u4EBA": "Connect a Discord bot with a Bot Token",
  "\u53D6\u6D88\u7ED1\u5B9A": "Cancel setup",
  "\u53D6\u6D88\u63A5\u5165": "Cancel setup",
  "\u4E8C\u7EF4\u7801\u7531\u817E\u8BAF\u5FAE\u4FE1 iLink \u670D\u52A1\u7B7E\u53D1\u3002\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u5E76\u786E\u8BA4\u540E\uFF0C\u8D26\u53F7\u51ED\u636E\u4F1A\u76F4\u63A5\u5199\u5165 Harness Host\uFF0C\u6D4F\u89C8\u5668\u4E0D\u4F1A\u6536\u5230 bot_token\u3002": "The QR code is issued by Tencent WeChat iLink. After you scan and confirm, account credentials are written directly to the Harness Host and are never exposed to the browser.",
  "\u626B\u7801\u8D26\u53F7\u5FC5\u987B\u5DF2\u52A0\u5165\u4F01\u4E1A/\u7EC4\u7EC7\u3002\u5982\u679C\u9489\u9489\u63D0\u793A\u5C1A\u672A\u52A0\u5165\u7EC4\u7EC7\uFF0C\u8BF7\u5728\u63D0\u793A\u9875\u521B\u5EFA\u7EC4\u7EC7\uFF0C\u6216\u6362\u7528\u5DF2\u52A0\u5165\u7EC4\u7EC7\u7684\u8D26\u53F7\u3002": "The DingTalk account must belong to an organization. If prompted, create an organization or use an account that already belongs to one.",
  "\u8BF7\u5728\u624B\u673A\u4E0A\u6838\u5BF9\u5E76\u786E\u8BA4\u6388\u6743\u3002\u90E8\u5206\u8D26\u53F7\u4F1A\u989D\u5916\u663E\u793A\u4E00\u4E2A\u914D\u5BF9\u6570\u5B57\uFF0C\u9875\u9762\u4F1A\u5728\u9700\u8981\u65F6\u63D0\u793A\u8F93\u5165\u3002": "Review and confirm authorization on your phone. Some accounts may also require a pairing number.",
  "\u6388\u6743\u7531\u9489\u9489\u5B98\u65B9\u9875\u9762\u5B8C\u6210\u3002\u626B\u7801\u8D26\u53F7\u5FC5\u987B\u5DF2\u52A0\u5165\u4E00\u4E2A\u4F01\u4E1A/\u7EC4\u7EC7\u5E76\u6709\u6743\u521B\u5EFA\u673A\u5668\u4EBA\uFF1B\u521B\u5EFA\u6210\u529F\u540E\uFF0C\u5E94\u7528\u51ED\u636E\u4F1A\u76F4\u63A5\u5199\u5165 Harness Host\u3002": "Authorization is completed on DingTalk\u2019s official page. The account must belong to an organization and be allowed to create bots. Credentials are written directly to the Harness Host.",
  "\u626B\u7801\u7531\u817E\u8BAF\u5B98\u65B9\u9875\u9762\u5B8C\u6210\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u586B\u5199 AppID \u6216 AppSecret\u3002\u626B\u7801\u6210\u529F\u540E\uFF0C\u673A\u5668\u4EBA\u4F1A\u81EA\u52A8\u8FDE\u63A5 DeepSeek Harness\u3002": "Scanning is completed on Tencent\u2019s official page. No AppID or AppSecret is required, and the bot connects automatically.",
  "\u626B\u7801\u7531\u817E\u8BAF\u5B98\u65B9\u9875\u9762\u5B8C\u6210\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u586B\u5199 Bot ID \u6216 Secret\u3002\u521B\u5EFA\u6210\u529F\u540E\uFF0C\u673A\u5668\u4EBA\u4F1A\u81EA\u52A8\u8FDE\u63A5 DeepSeek Harness\u3002": "Scanning is completed on Tencent\u2019s official page. No Bot ID or Secret is required, and the bot connects automatically.",
  "\u817E\u8BAF\u9875\u9762\u4F1A\u521B\u5EFA\u6216\u7ED1\u5B9A\u4E00\u4E2A QQ \u673A\u5668\u4EBA\uFF0C\u5E76\u628A\u8FDE\u63A5\u51ED\u636E\u5B89\u5168\u4EA4\u7ED9\u672C\u673A Harness Host\u3002": "Tencent will create or connect a QQ bot and securely deliver its credentials to the local Harness Host.",
  "\u4F01\u4E1A\u5FAE\u4FE1\u5B98\u65B9\u9875\u9762\u4F1A\u521B\u5EFA\u4E00\u4E2A\u667A\u80FD\u673A\u5668\u4EBA\uFF0C\u5E76\u628A\u8FDE\u63A5\u51ED\u636E\u5B89\u5168\u4EA4\u7ED9\u672C\u673A Harness Host\u3002": "WeCom will create an AI bot and securely deliver its credentials to the local Harness Host.",
  "\u4ECE\u6B64 Harness \u79FB\u9664\u8FD9\u4E2A\u5FAE\u4FE1\u8D26\u53F7\uFF1F": "Remove this WeChat account from Harness?",
  "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 bot_token\u3001\u8D26\u53F7\u914D\u7F6E\u548C\u4F1A\u8BDD\u6620\u5C04\u3002\u5176\u4ED6\u5FAE\u4FE1\u8D26\u53F7\u4E0D\u53D7\u5F71\u54CD\u3002": "This stops the message connection and removes the locally stored bot_token, account configuration, and session mappings. Other WeChat accounts are not affected.",
  "\u6B64\u64CD\u4F5C\u4F1A\u505C\u6B62\u8FD9\u4E2A\u673A\u5668\u4EBA\u7684\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u4FDD\u5B58\u5728\u672C\u673A\u7684\u63A5\u5165\u914D\u7F6E\u548C\u51ED\u636E\u3002\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E5F\u4E0D\u53D7\u5F71\u54CD\u3002": "This stops the bot connection and removes the locally stored configuration and credentials. The app in Feishu Open Platform is not deleted, and other bots are not affected.",
  "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u9489\u9489\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002": "This stops the message connection and removes the locally stored app credentials, bot configuration, and session mappings. The bot in DingTalk Open Platform is not deleted.",
  "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u4F01\u4E1A\u5FAE\u4FE1\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002": "This stops the message connection and removes the locally stored app credentials, bot configuration, and session mappings. The bot in WeCom is not deleted.",
  "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u817E\u8BAF\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002": "This stops the message connection and removes the locally stored app credentials, bot configuration, and session mappings. The bot on Tencent\u2019s platform is not deleted.",
  "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 WhatsApp \u5173\u8054\u8BBE\u5907\u548C\u4F1A\u8BDD\u6620\u5C04\u3002": "This stops the message connection and removes the locally stored WhatsApp linked device and session mappings.",
  "\u6B63\u5728\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA\u5217\u8868": "Loading Feishu bots",
  "\u6B63\u5728\u8BFB\u53D6\u98DE\u4E66\u8FDE\u63A5\u72B6\u6001\u2026": "Loading Feishu connection status\u2026",
  "\u6B63\u5728\u8BFB\u53D6\u5FAE\u4FE1\u8FDE\u63A5\u72B6\u6001\u2026": "Loading WeChat connection status\u2026",
  "\u6B63\u5728\u8BFB\u53D6\u9489\u9489\u8FDE\u63A5\u72B6\u6001\u2026": "Loading DingTalk connection status\u2026",
  "\u901A\u8FC7\u626B\u7801\u628A\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165 DeepSeek Harness": "Connect a DingTalk bot to DeepSeek Harness by QR code",
  "\u9489\u9489\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6": "DingTalk did not return QR setup progress",
  "\u9489\u9489\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1": "DingTalk did not return a valid setup attempt",
  "\u9489\u9489 Stream \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38": "DingTalk Stream connection is healthy",
  "\u9489\u9489\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868": "DingTalk did not return a valid bot list",
  "${totals.connected} / ${totals.configured} \u5728\u7EBF": "${totals.connected} / ${totals.configured} online",
  "\u7528\u4E8E\u628A\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165 DeepSeek Harness \u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801": "One-time QR code for connecting a DingTalk bot to DeepSeek Harness",
  "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\\n\u8BF7\u91CD\u65B0\u751F\u6210": "QR code expired\\nGenerate a new one",
  "\u673A\u5668\u4EBA\u5DF2\u521B\u5EFA\uFF0C\u6B63\u5728\u5EFA\u7ACB\u6D88\u606F\u8FDE\u63A5": "Bot created. Starting the message connection",
  "\u9489\u9489\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u5B89\u5168\u7684\u4E8C\u7EF4\u7801": "DingTalk did not return a secure QR code",
  "\u9489\u9489\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u9489\u9489 App \u626B\u63CF\u3002": "DingTalk QR code generated. Scan it with the DingTalk app.",
  "\u9489\u9489\u673A\u5668\u4EBA\u51ED\u636E\u5DF2\u7ED1\u5B9A\u3002": "DingTalk bot credentials connected.",
  "\u5DF2\u53D6\u6D88\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165\u3002": "DingTalk bot setup cancelled.",
  "\u9489\u9489\u673A\u5668\u4EBA\u53CA\u672C\u673A\u51ED\u636E\u5DF2\u79FB\u9664\u3002": "DingTalk bot and local credentials removed.",
  "\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u4E8C\u7EF4\u7801\u4FE1\u606F": "Feishu did not return QR code information",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u4E8C\u7EF4\u7801\u4FE1\u606F\u4E0D\u5B8C\u6574": "Feishu returned incomplete QR code information",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u673A\u5668\u4EBA\u72B6\u6001": "Feishu returned an invalid bot status",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u673A\u5668\u4EBA\u7F3A\u5C11 botId": "The Feishu bot is missing botId",
  "\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u8FDE\u63A5\u72B6\u6001": "Feishu did not return connection status",
  "\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u521B\u5EFA\u8FDB\u5EA6": "Feishu did not return creation progress",
  "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u672A\u77E5\u7684\u521B\u5EFA\u72B6\u6001": "Feishu returned an unknown creation status",
  "\u5DF2\u63A5\u5165 ${totals.configured} \u4E2A\u673A\u5668\u4EBA\uFF0C\u5176\u4E2D ${totals.connected} \u4E2A\u5728\u7EBF": "${totals.connected} of ${totals.configured} bots online",
  "\u5C1A\u672A\u63A5\u5165\u673A\u5668\u4EBA": "No bot connected yet",
  "\u7528\u4E8E\u65B0\u589E DeepSeek Harness \u98DE\u4E66\u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801": "One-time authorization QR code for adding a Feishu bot to DeepSeek Harness",
  "\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u626B\u7801": "Refresh and scan again",
  '${connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"}${bot.name}': '${connected ? "Check connection" : "Reconnect"} ${bot.name}',
  "\u65E0\u6CD5\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA": "Could not load Feishu bots",
  "\u6388\u6743\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u3002": "Authorization QR code generated. Scan it with Feishu.",
  "\u98DE\u4E66\u673A\u5668\u4EBA\u51ED\u636E\u5DF2\u7ED1\u5B9A\u3002": "Feishu bot credentials connected.",
  "\u5DF2\u53D6\u6D88\u6DFB\u52A0\u673A\u5668\u4EBA\u3002": "Adding the bot was cancelled.",
  "${newBot.bot.name}\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5728\u98DE\u4E66\u4E2D\u5F00\u59CB\u804A\u5929\u3002": "${newBot.bot.name} is connected and ready to chat in Feishu.",
  "${bot.name}\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u673A\u5668\u4EBA\u72B6\u6001\u3002": "${bot.name} operation failed. Check the bot status.",
  "${bot.name}\u5DF2\u4ECE\u6B64 DeepSeek Harness \u79FB\u9664\uFF1B\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u672A\u88AB\u5220\u9664\u3002": "${bot.name} was removed from this DeepSeek Harness. The app in Feishu Open Platform was not deleted.",
  "\u65E0\u6CD5\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001": "Could not load connection status",
  "QQ \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6": "QQ did not return QR setup progress",
  "QQ \u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1": "QQ did not return a valid setup attempt",
  "QQ WebSocket \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38": "QQ WebSocket connection is healthy",
  "QQ \u8FDE\u63A5\u672A\u5C31\u7EEA\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002": "The QQ connection is not ready; the plugin will retry automatically.",
  "QQ \u8FDE\u63A5\u672A\u5C31\u7EEA\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u91CD\u8BD5": "The QQ connection is not ready; the plugin will retry automatically",
  "QQ \u8FDE\u63A5\u5F53\u524D\u79BB\u7EBF": "The QQ connection is currently offline",
  "QQ \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868": "QQ did not return a valid bot list",
  "\u5C1A\u672A\u7ED1\u5B9A QQ \u673A\u5668\u4EBA": "No QQ bot connected yet",
  "\u7528\u4E8E\u7ED1\u5B9A QQ \u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801": "One-time QR code for connecting a QQ bot",
  "${channel}${connectionSummary}\u8FD0\u884C\u6B63\u5E38": "${channel}${connectionSummary} is healthy",
  "${channel} \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868": "${channel} did not return a valid bot list",
  "\u4F7F\u7528 Bot Token \u63A5\u5165 ${channel} \u673A\u5668\u4EBA": "Connect a ${channel} bot with a Bot Token",
  "${model.totals.connected} / ${model.totals.configured} \u5728\u7EBF": "${model.totals.connected}/${model.totals.configured} online",
  " Bot API \u957F\u8F6E\u8BE2": " Bot API long polling",
  "\u4F01\u4E1A\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6": "WeCom did not return QR setup progress",
  "\u4F01\u4E1A\u5FAE\u4FE1\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1": "WeCom did not return a valid setup attempt",
  "\u4F01\u4E1A\u5FAE\u4FE1 WebSocket \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38": "WeCom WebSocket connection is healthy",
  "\u4F01\u4E1A\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868": "WeCom did not return a valid bot list",
  "\u5C1A\u672A\u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA": "No WeCom bot connected yet",
  "\u7528\u4E8E\u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801": "One-time QR code for connecting a WeCom bot",
  "\u5FAE\u4FE1\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1": "WeChat did not return a valid setup attempt",
  "\u5FAE\u4FE1\u7ED1\u5B9A\u6CA1\u6709\u5B8C\u6210": "WeChat setup did not complete",
  "\u5FAE\u4FE1\u8FDE\u63A5\u6B63\u5E38": "WeChat connection is healthy",
  "\u5FAE\u4FE1\u8FDE\u63A5\u672A\u5C31\u7EEA": "WeChat connection is not ready",
  "\u5F53\u524D\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\uFF0C\u8BF7\u7528 /models \u67E5\u770B\u53EF\u7528\u6A21\u578B\uFF0C\u518D\u7528 /model <\u5E8F\u53F7> \u5207\u6362\u540E\u91CD\u53D1\u3002": "The current model does not support images. Use /models to list models, then /model <number> to switch and resend.",
  "\u56FE\u7247\u8D85\u8FC7\u5BBF\u4E3B\u5141\u8BB8\u7684\u5927\u5C0F\uFF0C\u8BF7\u538B\u7F29\u540E\u91CD\u8BD5\u3002": "The image exceeds the Host size limit. Compress it and try again.",
  "\u56FE\u7247\u5206\u8FA8\u7387\u8FC7\u9AD8\uFF0C\u8BF7\u538B\u7F29\u540E\u91CD\u8BD5\u3002": "The image resolution is too high. Compress it and try again.",
  "\u56FE\u7247\u5185\u5BB9\u65E0\u6548\u6216\u683C\u5F0F\u4E0D\u53D7\u652F\u6301\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u3002": "The image is invalid or unsupported. Send it again.",
  "\u672A\u80FD\u8BFB\u53D6\u56FE\u7247\u5185\u5BB9\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u3002": "The image could not be read. Send it again.",
  "\u56FE\u7247\u683C\u5F0F\u4E0E\u5B9E\u9645\u5185\u5BB9\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u3002": "The declared image format does not match its content. Send it again.",
  "\u4E00\u6B21\u53D1\u9001\u7684\u56FE\u7247\u6570\u91CF\u8D85\u8FC7\u5BBF\u4E3B\u9650\u5236\uFF0C\u8BF7\u51CF\u5C11\u540E\u91CD\u8BD5\u3002": "The message exceeds the Host image-count limit. Remove some images and try again.",
  "\u56FE\u7247\u603B\u5927\u5C0F\u8D85\u8FC7\u5BBF\u4E3B\u9650\u5236\uFF0C\u8BF7\u51CF\u5C11\u56FE\u7247\u6216\u538B\u7F29\u540E\u91CD\u8BD5\u3002": "The images exceed the Host total-size limit. Remove or compress some images and try again.",
  "\u56FE\u7247\u4E0B\u8F7D\u5730\u5740\u53D1\u751F\u4E86\u91CD\u5B9A\u5411\uFF0C\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u3002": "The image download redirected and cannot be read.",
  "\u56FE\u7247\u8D85\u8FC7 5 MB\uFF0C\u8BF7\u538B\u7F29\u540E\u91CD\u8BD5\u3002": "The image exceeds 5 MB. Compress it and try again.",
  "\u4E00\u6B21\u53D1\u9001\u7684\u56FE\u7247\u603B\u5927\u5C0F\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C11\u56FE\u7247\u6570\u91CF\u6216\u538B\u7F29\u540E\u91CD\u8BD5\u3002": "The images are too large in total. Remove or compress some images and try again.",
  "\u56FE\u7247\u4E0B\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u540E\u518D\u8BD5\u3002": "The image download failed. Send it again.",
  "\u6682\u4E0D\u652F\u6301\u8BE5\u56FE\u7247\u683C\u5F0F\uFF0C\u8BF7\u53D1\u9001 JPEG\u3001PNG\u3001WebP \u6216 GIF \u56FE\u7247\u3002": "This image format is unsupported. Send a JPEG, PNG, WebP, or GIF image.",
  "\u6D88\u606F\u5904\u7406\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002": "Message processing failed. Try again later.",
  "\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u8D26\u53F7\u5217\u8868": "WeChat did not return a valid account list",
  "\u5C1A\u672A\u7ED1\u5B9A\u5FAE\u4FE1": "No WeChat account connected yet",
  "\u7528\u4E8E\u628A\u5FAE\u4FE1\u673A\u5668\u4EBA\u7ED1\u5B9A\u5230 DeepSeek Harness \u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801": "One-time QR code for connecting a WeChat bot to DeepSeek Harness",
  "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6D88\u606F\u957F\u8F6E\u8BE2\u53D8\u4E3A\u5728\u7EBF": "Keep this page open until long polling is online",
  "\u5FAE\u4FE1\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u3002": "WeChat QR code generated. Scan it with WeChat on your phone.",
  "\u79FB\u9664\u5931\u8D25\uFF1A${presentError(error).message}": "Removal failed: ${presentError(error).message}",
  "\u65E0\u6CD5\u8BFB\u53D6\u5FAE\u4FE1\u72B6\u6001": "Could not load WeChat status",
  "WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u8FDB\u5EA6": "WhatsApp did not return QR setup progress",
  "WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u626B\u7801\u4EFB\u52A1": "WhatsApp did not return a valid setup attempt",
  "WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868": "WhatsApp did not return a valid account list",
  "\u7528\u4E8E\u5173\u8054 WhatsApp \u8BBE\u5907\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801": "One-time QR code for linking a WhatsApp device"
});
var en = EN;
var zh = Object.freeze(Object.fromEntries(
  Object.keys(EN).map((key) => [key, key === "$locale" ? "zh" : key])
));
var translate = (key) => key;
function setImTranslator(next) {
  translate = typeof next === "function" ? next : (key) => key;
}
function isEnglish() {
  return translate("$locale") === "en";
}
function channelName(value) {
  return localizeText(value);
}
function translateDynamic(text6) {
  let match = /^(\d+) \/ (\d+) 在线$/.exec(text6);
  if (match) return `${match[1]}/${match[2]} online`;
  match = /^已接入 (\d+) 个机器人，其中 (\d+) 个在线$/.exec(text6);
  if (match) return `${match[2]} of ${match[1]} bots online`;
  match = /^正在读取\s*(.+?)\s*机器人状态…$/.exec(text6);
  if (match) return `Loading ${channelName(match[1])} bot status\u2026`;
  match = /^无法读取\s*(.+?)\s*机器人状态$/.exec(text6);
  if (match) return `Could not load ${channelName(match[1])} bot status`;
  match = /^尚未接入\s*(.+?)\s*机器人$/.exec(text6);
  if (match) return `No ${channelName(match[1])} bot connected yet`;
  match = /^已接入的\s*(.+?)\s*机器人$/.exec(text6);
  if (match) return `Connected ${channelName(match[1])} bots`;
  match = /^手动接入(.+)机器人$/.exec(text6);
  if (match) return `Connect ${channelName(match[1])} bot manually`;
  match = /^(.+) 设置$/.exec(text6);
  if (match) return `${channelName(match[1])} settings`;
  match = /^从 DeepSeek Harness 移除“(.+)”？$/.exec(text6);
  if (match) return `Remove \u201C${match[1]}\u201D from DeepSeek Harness?`;
  match = /^从 DeepSeek Harness 移除(.+)$/.exec(text6);
  if (match) return `Remove ${match[1]} from DeepSeek Harness`;
  match = /^(.+)的飞书授权流程$/.exec(text6);
  if (match) return `Feishu authorization flow for ${match[1]}`;
  match = /^用于为(.+)补全权限与回调的一次性授权二维码$/.exec(text6);
  if (match) return `One-time QR code for completing permissions and the callback for ${match[1]}`;
  match = /^用于为(.+)开通群消息权限的一次性授权二维码$/.exec(text6);
  if (match) return `One-time QR code for granting group-message permission to ${match[1]}`;
  match = /^正在为「(.+)」补全权限与回调$/.exec(text6);
  if (match) return `Completing permissions and the callback for \u201C${match[1]}\u201D`;
  match = /^正在为「(.+)」开通群消息权限$/.exec(text6);
  if (match) return `Granting group-message permission to \u201C${match[1]}\u201D`;
  match = /^为(.+)补全权限与回调$/.exec(text6);
  if (match) return `Complete permissions and the callback for ${match[1]}`;
  match = /^(.+)的权限补全二维码已生成，请使用飞书扫码。$/.exec(text6);
  if (match) return `Permission-completion QR code generated for ${match[1]}. Scan it with Feishu.`;
  match = /^(.+)的群消息权限二维码已生成，请使用飞书确认。$/.exec(text6);
  if (match) return `Group-message permission QR code generated for ${match[1]}. Confirm it with Feishu.`;
  match = /^(.+)的权限与回调已补全。$/.exec(text6);
  if (match) return `Permissions and the callback completed for ${match[1]}.`;
  match = /^(.+)已开通群消息权限，并启用“响应所有群消息”。$/.exec(text6);
  if (match) return `${match[1]} now has group-message permission and \u201CRespond to all group messages\u201D is enabled.`;
  match = /^(检查连接|重试连接)(.+)$/.exec(text6);
  if (match) return `${localizeText(match[1])} ${match[2]}`;
  match = /^移除(.+)$/.exec(text6);
  if (match) return `Remove ${match[1]}`;
  match = /^这会停止消息连接，并删除本机保存的 (.+)、机器人配置及会话映射。(.+)中的机器人不会被自动删除。$/.exec(text6);
  if (match) {
    return `This stops the message connection and removes the locally stored ${localizeText(match[1])}, bot configuration, and session mappings. The bot in ${localizeText(match[2])} is not deleted.`;
  }
  match = /^二维码剩余 (.+)$/.exec(text6);
  if (match) return `QR code expires in ${match[1]}`;
  match = /^最近一条消息处理失败：(.+)$/.exec(text6);
  if (match) return `Latest message failed: ${localizeText(match[1])}`;
  match = /^图片下载失败（HTTP (.+)），请重新发送后再试。$/.exec(text6);
  if (match) return `The image download failed (HTTP ${match[1]}). Send it again.`;
  match = /^一次最多只能处理 (\d+) 张图片。$/.exec(text6);
  if (match) return `A message can contain at most ${match[1]} images.`;
  match = /^状态刷新失败：(.+)$/.exec(text6);
  if (match) return `Status refresh failed: ${match[1]}`;
  match = /^状态自动刷新失败：(.+)$/.exec(text6);
  if (match) return `Automatic status refresh failed: ${match[1]}`;
  match = /^操作失败：(.+)$/.exec(text6);
  if (match) return `Operation failed: ${match[1]}`;
  match = /^连接检查失败：(.+)$/.exec(text6);
  if (match) return `Connection check failed: ${match[1]}`;
  match = /^移除失败：(.+)$/.exec(text6);
  if (match) return `Removal failed: ${match[1]}`;
  const phrases = [
    ["\u4F01\u4E1A\u5FAE\u4FE1", "WeCom"],
    ["DeepSeek Harness", "DeepSeek Harness"],
    ["WhatsApp", "WhatsApp"],
    ["Telegram", "Telegram"],
    ["Discord", "Discord"],
    ["Slack", "Slack"],
    ["\u98DE\u4E66", "Feishu"],
    ["\u9489\u9489", "DingTalk"],
    ["\u5FAE\u4FE1", "WeChat"],
    ["\u673A\u5668\u4EBA", "bot"],
    ["\u8D26\u53F7", "account"],
    ["\u5E94\u7528", "app"],
    ["\u51ED\u636E", "credentials"],
    ["\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94", "service returned an unrecognized response"],
    ["\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868", "service did not return a valid bot list"],
    ["\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", "operation failed; try again later"],
    ["\u64CD\u4F5C\u5931\u8D25", "operation failed"],
    ["\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA", "connection is not ready"],
    ["\u6CA1\u6709\u63A5\u5165\u5B8C\u6210", "was not connected"],
    ["\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210", "was not connected"],
    ["\u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5", "settings are missing an RPC connection"],
    ["\u8BBE\u7F6E", "settings"],
    ["\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210", "connection check completed"],
    ["\u4ECD\u672A\u8FDE\u63A5\uFF0C\u63D2\u4EF6\u4F1A\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5", "is still offline; the plugin will keep retrying"],
    ["\u5DF2\u91CD\u65B0\u8FDE\u63A5", "reconnected"],
    ["\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", "could not be removed; try again"],
    ["\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u804A\u5929", "is connected and ready to chat"],
    ["\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u53D1\u9001\u6D88\u606F", "is connected and ready for messages"],
    ["\u670D\u52A1\u8BF7\u6C42\u5931\u8D25", "service request failed"],
    ["\u8FDE\u63A5\u9047\u5230\u95EE\u9898", "connection encountered a problem"],
    ["\u6B63\u5728\u8BFB\u53D6", "Loading "],
    ["\u8FDE\u63A5\u72B6\u6001", "connection status"],
    ["\u4E8C\u7EF4\u7801", "QR code"]
  ];
  let output = text6;
  for (const [source, target] of phrases) output = output.replaceAll(source, target);
  return output;
}
function localizeText(value) {
  if (typeof value !== "string") return value;
  const exact = translate(value);
  if (exact !== value || !isEnglish()) return exact;
  return translateDynamic(value);
}
var LOCALIZED_PROPS = Object.freeze([
  "aria-label",
  "alt",
  "placeholder",
  "title"
]);
function localizeChild(child) {
  if (typeof child === "string") return localizeText(child);
  if (Array.isArray(child)) return child.map(localizeChild);
  return child;
}
function h(type, props, ...children) {
  let localizedProps = props;
  if (props) {
    for (const key of LOCALIZED_PROPS) {
      if (typeof props[key] === "string") {
        localizedProps = localizedProps === props ? { ...props } : localizedProps;
        localizedProps[key] = localizeText(props[key]);
      }
    }
  }
  return React.createElement(type, localizedProps, ...children.map(localizeChild));
}

// plugin-src/client/feedback.js
var ActionButton = React2.forwardRef(function ActionButton2({ children, loading = false, className = "", disabled, ...props }, ref) {
  return React2.createElement(
    "button",
    {
      type: "button",
      ...props,
      ref,
      className: `${className} dim-busyButton`.trim(),
      disabled: disabled || loading,
      "aria-busy": loading || props["aria-busy"] || void 0,
      "data-loading": loading || void 0
    },
    React2.createElement("span", { className: "dim-buttonContent" }, children),
    loading ? React2.createElement("span", { className: "dim-buttonSpinner", "aria-hidden": true }) : null
  );
});
function BusyIndicator({ busy }) {
  return busy ? React2.createElement("span", { className: "dim-controlSpinner", "aria-hidden": true }) : null;
}
function FeedbackToast({ text: text6, tone, holdMs = null, actions, sequence = 0 }) {
  const [dismissed, setDismissed] = React2.useState(null);
  const showing = `${sequence}:${holdMs}:${text6}`;
  React2.useEffect(() => {
    setDismissed(null);
  }, [showing]);
  if (!text6 || dismissed === showing) return null;
  return React2.createElement(import_dsh_client_ui_primitives.Toast, {
    key: showing,
    text: localizeText(text6),
    holdMs,
    tone: tone === "success" ? "success" : void 0,
    icon: tone === "error" ? React2.createElement(import_dsh_client_ui_primitives.IconWarningOutlineRegular) : void 0,
    actions: actions?.map((action) => ({ ...action, label: localizeText(action.label) })),
    dismissLabel: holdMs === null ? localizeText("\u5173\u95ED") : void 0,
    onDone: () => setDismissed(showing)
  });
}
function ConfirmDialog({ children, onClose, busy = false, className = "", error, feedbackSequence, ...props }) {
  const dialogRef = React2.useRef(null);
  const ownerRef = React2.useRef(null);
  const heading = React2.Children.toArray(children).find((child) => React2.isValidElement(child) && ["strong", "h4"].includes(child.type));
  (0, import_dsh_client_ui_primitives.useModalLayer)(dialogRef, true, () => {
    if (!busy) onClose?.();
  }, ownerRef);
  const content = React2.createElement("div", {
    className: "dim-confirmBackdrop",
    onMouseDown: (event) => {
      if (event.target === event.currentTarget && !busy) onClose?.();
    }
  }, React2.createElement("section", {
    ...props,
    ref: dialogRef,
    className: `dim-confirmDialog ${className}`.trim(),
    role: "dialog",
    "aria-modal": true,
    "aria-label": props["aria-label"] ?? (props["aria-labelledby"] ? void 0 : heading?.props.children),
    tabIndex: -1,
    onKeyDown: void 0
  }, children, error ? React2.createElement(FeedbackToast, { text: error, tone: "error", sequence: feedbackSequence }) : null));
  return React2.createElement(
    React2.Fragment,
    null,
    React2.createElement("span", { ref: ownerRef, hidden: true, "data-dsh-modal-owner": "" }),
    typeof document === "undefined" ? content : (0, import_react_dom.createPortal)(content, document.body)
  );
}

// package.json
var package_default = {
  name: "@xmanrui/dsh-im",
  version: "3.0.1",
  description: "\u628A\u4E5D\u79CD IM \u673A\u5668\u4EBA\u548C\u516C\u7F51 AI Office \u63A5\u5165\u672C\u673A DeepSeek Harness\u3002 Connect nine IM channels and a public AI Office to a local DeepSeek Harness.",
  keywords: [
    "deepseek-harness",
    "dsh",
    "dsh-plugin",
    "ai-agent",
    "im",
    "instant-messaging",
    "chatbot",
    "feishu",
    "lark",
    "wechat",
    "wecom",
    "dingtalk",
    "qq",
    "slack",
    "telegram",
    "discord",
    "whatsapp",
    "ai-office"
  ],
  author: {
    name: "xmanrui",
    url: "https://github.com/xmanrui"
  },
  contributors: [
    {
      name: "C3H3-AI",
      url: "https://github.com/C3H3-AI"
    }
  ],
  license: "MIT",
  type: "module",
  repository: {
    type: "git",
    url: "git+https://github.com/xmanrui/dsh-im.git"
  },
  homepage: "https://github.com/xmanrui/dsh-im#readme",
  bugs: "https://github.com/xmanrui/dsh-im/issues",
  publishConfig: {
    access: "public"
  },
  bin: {
    "dsh-im": "bin/dsh-im.mjs"
  },
  main: "./lib/index.js",
  exports: {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  files: [
    "assets",
    "bin",
    "cordis.patch.yml",
    "lib",
    "plugin-src",
    "scripts",
    "src",
    "LICENSE",
    "README.md",
    "README.en.md",
    "THIRD_PARTY_NOTICES.md"
  ],
  dsh: {
    bundle: {
      patch: "./cordis.patch.yml"
    },
    client: {
      inject: [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-locale"
      ],
      platform: "web"
    }
  },
  scripts: {
    "test:desktop": "node --test *.test.mjs",
    build: "node plugin-src/client/build.mjs && node plugin-src/host/build.mjs",
    test: "npm run test:desktop",
    check: "npm run build && npm test && node scripts/verify-package.mjs"
  },
  engines: {
    node: ">=22.19"
  },
  dependencies: {
    "@tencent-connect/qqbot-connector": "1.2.0",
    "@tencent-connect/qqbot-nodejs": "1.0.4",
    "@wecom/aibot-node-sdk": "1.0.7",
    "dingtalk-stream": "2.1.4",
    qrcode: "1.5.4",
    sharp: "0.35.3"
  },
  devDependencies: {
    ws: "8.21.3",
    "@larksuiteoapi/node-sdk": "1.73.0",
    "@whiskeysockets/baileys": "7.0.0-rc14",
    esbuild: "0.25.9",
    "https-proxy-agent": "5.0.1",
    react: "18.3.1",
    "react-dom": "18.3.1",
    "react-test-renderer": "18.3.1"
  }
};

// plugin-src/client/channel-logos.js
var React3 = __toESM(require("react"), 1);
var h2 = React3.createElement;
function dimensions(size) {
  return size === void 0 ? {} : { width: size, height: size };
}
function WeixinLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "weixin"
  }, h2("path", {
    fill: "currentColor",
    d: "M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"
  }));
}
function FeishuLogoGlyph({ size } = {}) {
  return h2(
    "svg",
    {
      ...dimensions(size),
      viewBox: "0 0 24 24",
      focusable: "false",
      "aria-hidden": "true",
      "data-im-channel-logo": "feishu"
    },
    h2("path", { fill: "#00D6B9", d: "M7.2 4.5h7.6c1.2 0 2.1.55 2.7 1.58 1.05 1.8 1.55 3.45 1.58 4.95-2.04-.62-4.2-.15-6.22 1.45C11.3 9.7 9.42 7.04 7.2 4.5Z" }),
    h2("path", { fill: "#1456B8", d: "M10.8 13.55c3.3-2.93 5.72-4.24 9.47-2.52-1.2 1.45-2.27 4.18-3.86 5.43-1.67 1.31-3.9.5-5.61-.64v-2.27Z" }),
    h2("path", { fill: "#3370FF", d: "M4.4 8.35c3.47 3.61 7.25 6.1 10.33 5.7 1.06-.14 2.2-.72 3.4-1.72-1.04 2.65-2.6 4.8-5.06 6-2.46 1.2-5.56.52-7.42-.72A2.76 2.76 0 0 1 4.4 15.3V8.35Z" })
  );
}
function DingtalkLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 48 48",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "dingtalk"
  }, h2("path", {
    fill: "currentColor",
    d: "M37.05 22.783c-6.758-5.216-14.378-12.128-22.73-19.538-.655-.585-1.242-.354-1.536.42-1.88 4.973-.058 9.386 2.889 11.932s7.368 4.912 10.058 6.155c.105.049.013.203-.093.163-4.953-2.182-8.397-3.765-13.07-7.368-.497-.388-1.01-.242-1.07.521-.384 4.748 2.657 8.483 6.058 9.745 2.1.781 4.398 1.212 6.53 1.474.109.015.084.178-.027.178-2.747.01-6.058-.654-8.935-1.751-.606-.233-.818.25-.722.633.491 2.008 2.974 5.076 6.926 5.73a12 12 0 0 0 2.228.115c.164 0 .208.089.154.217q-2.685 4.6-2.803 4.797c-.091.152-.036.275.156.275h3.543c.164 0 .264.106.18.246l-4.958 8.196c-.191.328.035.565.395.301s15.212-11.133 15.636-11.448c.195-.142.148-.327-.124-.327h-3.18c-.206 0-.252-.14-.111-.28.14-.141 3.602-3.594 4.837-4.888 1.283-1.35 1.938-3.825-.231-5.498"
  }));
}
function QqLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "qq"
  }, h2("path", {
    fill: "currentColor",
    d: "M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"
  }));
}
function WecomLogoGlyph({ size } = {}) {
  return h2(
    "svg",
    {
      ...dimensions(size),
      viewBox: "0 0 24 24",
      focusable: "false",
      "aria-hidden": "true",
      "data-im-channel-logo": "wecom"
    },
    h2("path", {
      fill: "none",
      stroke: "#3370FF",
      strokeWidth: "2.35",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M17.7 14.5c1.05-1.12 1.65-2.52 1.65-4.03 0-3.82-3.58-6.92-8-6.92s-8 3.1-8 6.92 3.58 6.92 8 6.92c1.17 0 2.28-.22 3.28-.62"
    }),
    h2("path", { fill: "#07C160", d: "M16.1 15.15c.7-.7 1.83-.7 2.53 0s.7 1.83 0 2.53-1.83.7-2.53 0-.7-1.83 0-2.53Z" }),
    h2("path", { fill: "#FFB800", d: "M19.25 13.45a1.36 1.36 0 1 1 1.92 1.92 1.36 1.36 0 0 1-1.92-1.92Z" }),
    h2("path", { fill: "#FF7A00", d: "M19.55 18.05a1.16 1.16 0 1 1 1.64 1.64 1.16 1.16 0 0 1-1.64-1.64Z" }),
    h2("path", { fill: "#3370FF", d: "M15.25 18.75a.92.92 0 1 1 1.3 1.3.92.92 0 0 1-1.3-1.3Z" })
  );
}
function TelegramLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "telegram"
  }, h2("path", {
    fill: "currentColor",
    d: "M23.95 4.57c-.36-1.45-1.43-1.76-2.82-1.24L1.5 10.9c-1.34.52-1.32 1.27-.24 1.6l5.03 1.57 11.66-7.36c.55-.34 1.05-.16.64.21l-9.44 8.52-.37 5.12c.54 0 .78-.24 1.08-.53l2.59-2.51 5.38 3.97c.99.55 1.7.27 1.95-.92L23.95 4.57Z"
  }));
}
function DiscordLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "discord"
  }, h2("path", {
    fill: "currentColor",
    d: "M20.32 4.37a19.8 19.8 0 0 0-4.89-1.51c-.21.38-.46.89-.63 1.29a18.4 18.4 0 0 0-5.59 0 13 13 0 0 0-.64-1.29c-1.71.29-3.36.8-4.89 1.52C.59 9.09-.25 13.68.17 18.2a19.9 19.9 0 0 0 6 3.04c.48-.66.91-1.36 1.28-2.1-.7-.26-1.37-.58-2-.96.17-.12.33-.25.49-.38 3.86 1.79 8.04 1.79 11.86 0 .16.13.32.26.49.38-.64.38-1.31.7-2.01.97.37.73.8 1.44 1.28 2.09a19.8 19.8 0 0 0 6-3.04c.49-5.24-.84-9.79-3.24-13.83ZM8.02 15.42c-1.16 0-2.11-1.07-2.11-2.38s.93-2.38 2.11-2.38c1.18 0 2.13 1.08 2.11 2.38 0 1.31-.93 2.38-2.11 2.38Zm7.95 0c-1.16 0-2.11-1.07-2.11-2.38s.93-2.38 2.11-2.38c1.18 0 2.13 1.08 2.11 2.38 0 1.31-.93 2.38-2.11 2.38Z"
  }));
}
function SlackLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "slack"
  }, h2("path", {
    fill: "currentColor",
    d: "M6 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Zm2-8a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Zm8 2a2 2 0 1 1 2 2h-2v-2Zm-1 0a2 2 0 1 1-4 0V5a2 2 0 1 1 4 0v5Zm-2 8a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z"
  }));
}
function WhatsappLogoGlyph({ size } = {}) {
  return h2("svg", {
    ...dimensions(size),
    viewBox: "0 0 24 24",
    focusable: "false",
    "aria-hidden": "true",
    "data-im-channel-logo": "whatsapp"
  }, h2("path", {
    fill: "currentColor",
    d: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.521.149-.173.198-.297.298-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.83 9.83 0 0 1 2.893 6.991c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.8 11.8 0 0 0 12.055 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.9 11.9 0 0 0 5.688 1.448h.005c6.557 0 11.892-5.335 11.895-11.893a11.82 11.82 0 0 0-3.486-8.413"
  }));
}
function OfficeLogoGlyph({ size } = {}) {
  return h2(
    "svg",
    {
      ...dimensions(size),
      viewBox: "0 0 24 24",
      focusable: "false",
      "aria-hidden": "true",
      "data-im-channel-logo": "office"
    },
    h2("path", { fill: "currentColor", d: "M4 3.5h10.5a2 2 0 0 1 2 2v13H4v-15Zm2.2 3v1.8h2V6.5h-2Zm4.1 0v1.8h2V6.5h-2Zm-4.1 4v1.8h2v-1.8h-2Zm4.1 0v1.8h2v-1.8h-2ZM8.4 15v3.5h3V15h-3Z" }),
    h2("path", { fill: "currentColor", d: "M18.3 8.2h1.5v3h3v1.5h-3v3h-1.5v-3h-3v-1.5h3v-3Z" })
  );
}

// plugin-src/client/agent-preset.js
var React4 = __toESM(require("react"), 1);
var SET_AGENT_PRESET_ENDPOINT = "bot.preset.set";
var PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
var EMPTY_AGENT_PRESET_CATALOG = Object.freeze({
  defaultId: "",
  items: Object.freeze([])
});
var AgentPresetCatalogContext = React4.createContext(EMPTY_AGENT_PRESET_CATALOG);
function normalizeAgentPresetId(value) {
  if (typeof value !== "string") return "";
  const id5 = value.trim();
  return PRESET_ID.test(id5) ? id5 : "";
}
function normalizeAgentPresetCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { defaultId: "", items: [] };
  }
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(value.items) ? value.items : []) {
    const id5 = typeof entry === "string" ? normalizeAgentPresetId(entry) : normalizeAgentPresetId(entry?.id);
    if (!id5 || seen.has(id5)) continue;
    seen.add(id5);
    const label = typeof entry?.label === "string" && entry.label.trim() ? entry.label.trim().slice(0, 128) : typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 128) : id5;
    items.push({ id: id5, label });
  }
  return {
    defaultId: normalizeAgentPresetId(value.defaultId),
    items
  };
}
function AgentPresetEditor({ agentPreset = "", disabled = false, onSave }) {
  const catalog = React4.useContext(AgentPresetCatalogContext) ?? EMPTY_AGENT_PRESET_CATALOG;
  const helpId = React4.useId();
  const current = normalizeAgentPresetId(agentPreset);
  const [saving, setSaving] = React4.useState(false);
  const [error, setError] = React4.useState(null);
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of Array.isArray(catalog.items) ? catalog.items : []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const currentUnavailable = Boolean(current && !seen.has(current));
  if (currentUnavailable) items.push({ id: current, label: current, unavailable: true });
  const inheritLabel = "\u8DDF\u968F Host \u9ED8\u8BA4";
  const change = async (event) => {
    const next = event.target.value;
    if (next === current || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next || null);
    } catch (cause) {
      setError(cause?.message ?? "Agent Preset \u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setSaving(false);
    }
  };
  return h(
    "div",
    { className: "dim-preset" },
    h(
      "div",
      { className: "dim-presetHeader" },
      h(
        "span",
        { className: "dim-presetTitle" },
        h("span", null, "Agent Preset"),
        h(
          "span",
          { className: "dim-presetHelp" },
          h("button", {
            type: "button",
            className: "dim-presetHelpButton",
            "aria-label": "\u67E5\u770B Agent Preset \u8BF4\u660E",
            "aria-describedby": helpId
          }, h("span", { "aria-hidden": "true" }, "?")),
          h("span", {
            id: helpId,
            className: "dim-presetTooltip",
            role: "tooltip"
          }, "\u53EA\u5F71\u54CD\u65B0\u5EFA\u4F1A\u8BDD\uFF1B\u82E5\u5F53\u524D\u804A\u5929\u5DF2\u6709\u4F1A\u8BDD\uFF0C\u5148\u53D1\u9001 /new\uFF0C\u518D\u53D1\u9001\u666E\u901A\u6D88\u606F\u751F\u6548\u3002")
        )
      ),
      null
    ),
    h("span", { className: "dim-controlBusy" }, React4.createElement(
      "select",
      {
        className: "dim-presetSelect",
        value: current,
        disabled: disabled || saving,
        "aria-busy": saving || void 0,
        "aria-label": "Agent Preset",
        onChange: (event) => {
          void change(event);
        }
      },
      h("option", { value: "" }, inheritLabel),
      ...items.map((item) => h(
        "option",
        { key: item.id, value: item.id },
        item.unavailable ? [item.id, "\uFF08\u5DF2\u4E0D\u53EF\u7528\uFF09"] : item.label && item.label !== item.id ? `${item.label}\uFF08${item.id}\uFF09` : item.id
      ))
    ), h(BusyIndicator, { busy: saving })),
    error ? h(FeedbackToast, { text: error, tone: "error" }) : null,
    currentUnavailable ? h(
      "p",
      { className: "dim-presetError", role: "status" },
      "\u5F53\u524D Agent Preset \u5DF2\u4E0D\u53EF\u7528\uFF0C\u8BF7\u9009\u62E9\u5176\u4ED6 Preset \u6216\u8DDF\u968F Host \u9ED8\u8BA4\u3002"
    ) : null
  );
}

// plugin-src/client/last-message-error.js
function text(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
function normalizeLastMessageError(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = text(value.code, 64);
  const reason = text(value.reason, 64);
  const message = text(value.message, 500);
  const referenceId = text(value.referenceId, 40);
  const at = Number.isFinite(value.at) ? value.at : null;
  return code && reason && message && referenceId && at !== null ? { code, reason, message, referenceId, at } : null;
}

// plugin-src/client/channels/dingtalk/api.js
var DINGTALK_RPC_CHANNEL = "/dingtalk";
var DINGTALK_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  bindCredentials: "bot.bind-credentials",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
var ACCOUNT_STATES = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
var SNAPSHOT_STATES = /* @__PURE__ */ new Set(["disconnected", "offline", "provisioning", "connected", "degraded"]);
var PROVISION_STATES = /* @__PURE__ */ new Set([
  "starting",
  "pending",
  "scanned",
  "authorizing",
  "creating",
  "connecting",
  "connected",
  "expired",
  "failed",
  "cancelled"
]);
var HEALTH_STATES = /* @__PURE__ */ new Set(["healthy", "checking", "degraded", "offline"]);
var FORBIDDEN_ERROR_FIELDS = /(client[_-]?secret|secret[_-]?ref|device[_-]?code|app[_-]?secret|access[_-]?token|token)/i;
var QR_DATA_URL = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;
var MAX_QR_SOURCE_LENGTH = 2 * 1024 * 1024;
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optionalString(value, maxLength = 240) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : void 0;
}
function opaqueId(value) {
  const id5 = optionalString(value, 128);
  return id5 && /^[a-z\d_-]+$/i.test(id5) ? id5 : void 0;
}
function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function safeErrorCode(value, fallback) {
  const code = optionalString(value, 80);
  return code && /^[a-z][a-z\d_.:-]*$/i.test(code) && !FORBIDDEN_ERROR_FIELDS.test(code) ? code : fallback;
}
function sanitizeMessage(value, fallback) {
  const message = optionalString(value, 480) ?? fallback;
  if (FORBIDDEN_ERROR_FIELDS.test(message)) return fallback;
  return message.replace(/([=:]\s*)[^\s,;，。]+/g, "$1\u2022\u2022\u2022\u2022\u2022\u2022").slice(0, 240);
}
function normalizeError(value, fallbackCode, fallbackMessage) {
  if (!isRecord(value)) return void 0;
  return {
    code: safeErrorCode(value.code, fallbackCode),
    message: sanitizeMessage(value.message, fallbackMessage)
  };
}
function normalizeTestMessage(value) {
  if (!isRecord(value)) return null;
  if (value.sent === true) return { sent: true };
  if (value.sent !== false) return null;
  const code = value.code === "test-target-unavailable" ? "test-target-unavailable" : "test-message-failed";
  return { sent: false, code };
}
function unwrapRpcResult(result) {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error("\u9489\u9489\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const error = new Error(sanitizeMessage(result.error?.message, "\u9489\u9489\u64CD\u4F5C\u5931\u8D25"));
    error.code = safeErrorCode(result.error?.code, "DINGTALK_RPC_ERROR");
    throw error;
  }
  return result.value;
}
function safeQrSource(value) {
  if (typeof value !== "string" || value.length > MAX_QR_SOURCE_LENGTH) return void 0;
  return QR_DATA_URL.test(value) ? value : void 0;
}
function normalizeProvisioning(value, now = Date.now()) {
  const source = isRecord(value?.provisioning) ? value.provisioning : value;
  if (!isRecord(source)) throw new Error("\u9489\u9489\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6");
  const attemptId = opaqueId(source.attemptId);
  if (!attemptId) throw new Error("\u9489\u9489\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1");
  const reportedStatus = optionalString(source.status, 32) ?? optionalString(source.state, 32);
  const status = PROVISION_STATES.has(reportedStatus) ? reportedStatus : "failed";
  const expiresAt = timestamp(source.expiresAt) ?? now + clamp(source.expiresIn, 1, 2 * 60 * 60, 10 * 60) * 1e3;
  const result = {
    attemptId,
    status,
    expiresAt,
    pollIntervalMs: clamp(source.pollIntervalMs, 1e3, 1e4, 3e3)
  };
  const qrCodeDataUrl = safeQrSource(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (opaqueId(source.botId)) result.botId = opaqueId(source.botId);
  if (source.alreadyConnected === true) result.alreadyConnected = true;
  const error = normalizeError(
    source.error,
    "DINGTALK_PROVISION_FAILED",
    "\u9489\u9489\u673A\u5668\u4EBA\u6CA1\u6709\u63A5\u5165\u5B8C\u6210"
  );
  if (error) result.error = error;
  return result;
}
function normalizeBot(value) {
  if (!isRecord(value)) return void 0;
  const botId = opaqueId(value.botId);
  if (!botId) return void 0;
  const bot = isRecord(value.bot) ? value.bot : {};
  const connected = value.connected === true;
  const reportedState = ACCOUNT_STATES.has(value.state) ? value.state : "offline";
  const state = connected ? "connected" : reportedState === "connected" ? "connecting" : reportedState;
  const health = isRecord(value.health) ? value.health : {};
  const stats = isRecord(value.stats) ? value.stats : {};
  return {
    botId,
    state,
    connected,
    configured: value.configured !== false,
    workspace: optionalString(value.workspace, 4096) ?? "",
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    bot: {
      name: optionalString(bot.name, 100) ?? "\u9489\u9489\u673A\u5668\u4EBA",
      clientIdMasked: optionalString(bot.clientIdMasked, 140) ?? "\u5DF2\u5B89\u5168\u4FDD\u5B58"
    },
    health: {
      status: HEALTH_STATES.has(health.status) ? health.status : connected ? "healthy" : "offline",
      summary: optionalString(health.summary, 200) ?? (connected ? "\u9489\u9489 Stream \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38" : "\u9489\u9489\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA"),
      lastCheckedAt: timestamp(health.lastCheckedAt),
      lastConnectedAt: timestamp(health.lastConnectedAt)
    },
    stats: {
      messagesReceived: nonNegativeInteger(stats.messagesReceived),
      messagesReplied: nonNegativeInteger(stats.messagesReplied)
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: normalizeError(value.error, "DINGTALK_ACCOUNT_ERROR", "\u9489\u9489\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA") ?? null
  };
}
function normalizeSnapshot(value) {
  const source = isRecord(value?.snapshot) ? value.snapshot : value;
  if (!isRecord(source) || !Array.isArray(source.bots)) {
    throw new Error("\u9489\u9489\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868");
  }
  const seen = /* @__PURE__ */ new Set();
  const bots = source.bots.map(normalizeBot).filter((bot) => {
    if (!bot || seen.has(bot.botId)) return false;
    seen.add(bot.botId);
    return true;
  });
  return {
    schemaVersion: Number.isSafeInteger(source.schemaVersion) ? source.schemaVersion : 1,
    revision: nonNegativeInteger(source.revision),
    state: SNAPSHOT_STATES.has(source.state) ? source.state : "offline",
    bots,
    totals: {
      configured: bots.length,
      connected: bots.filter((bot) => bot.connected).length
    },
    provisioning: source.provisioning ? normalizeProvisioning(source.provisioning) : null,
    testMessage: normalizeTestMessage(source.testMessage),
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog)
  };
}
function connectionTestFeedback(result) {
  if (result?.sent === true) return "\u9489\u9489\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002";
  if (result?.code === "test-target-unavailable") {
    return "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
  }
  return result ? "\u9489\u9489\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002" : null;
}
function presentError(error) {
  return {
    code: safeErrorCode(error?.code, "DINGTALK_ERROR"),
    message: sanitizeMessage(error?.message, "\u9489\u9489\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")
  };
}
function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1e3) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// plugin-src/client/channels/dingtalk/index.js
var React10 = __toESM(require("react"), 1);

// plugin-src/client/credential-binding.js
var React5 = __toESM(require("react"), 1);
function ActionIcon({ children }) {
  return h("svg", {
    className: "dim-actionIcon",
    width: 15,
    height: 15,
    viewBox: "0 0 20 20",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    focusable: "false"
  }, children);
}
function QrActionIcon() {
  return h(
    ActionIcon,
    null,
    h("path", {
      d: "M2.5 2.5h5v5h-5v-5Zm10 0h5v5h-5v-5Zm-10 10h5v5h-5v-5Z",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinejoin: "round"
    }),
    h("path", {
      d: "M11.5 11.5h2v2h-2v-2Zm4 0h2v3h-2v-3Zm-4 4h3v2h-3v-2Zm5 1h1v1h-1v-1Z",
      fill: "currentColor"
    })
  );
}
function CredentialActionIcon() {
  return h(
    ActionIcon,
    null,
    h("circle", {
      cx: "6.25",
      cy: "10",
      r: "3.5",
      stroke: "currentColor",
      strokeWidth: "1.6"
    }),
    h("path", {
      d: "M9.75 10h7.75m-2.5 0v2m-2.5-2v2",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    })
  );
}
function CredentialBindingPanel({
  channel: channel4,
  identityLabel,
  identityPlaceholder,
  secretLabel,
  secretPlaceholder,
  busy = false,
  error = null,
  onSubmit,
  onCancel
}) {
  const [identity, setIdentity] = React5.useState("");
  const [secret, setSecret] = React5.useState("");
  const headingId = React5.useId();
  const hasIdentity = Boolean(identityLabel);
  const submit = (event) => {
    event.preventDefault();
    const normalizedIdentity = identity.trim();
    const normalizedSecret = secret.trim();
    if (hasIdentity && !normalizedIdentity || !normalizedSecret || busy) return;
    void onSubmit?.({ identity: normalizedIdentity, secret: normalizedSecret });
  };
  return h(
    "section",
    {
      className: "ddt-card dim-surfaceCard dim-credentialPanel",
      "aria-labelledby": headingId
    },
    h("h3", { id: headingId, className: "dim-credentialTitle" }, `\u624B\u52A8\u63A5\u5165${channel4}\u673A\u5668\u4EBA`),
    h(
      "form",
      {
        className: `dim-credentialForm${hasIdentity ? "" : " dim-credentialFormSingle"}`,
        onSubmit: submit
      },
      hasIdentity ? h(
        "label",
        { className: "dim-credentialField" },
        h("span", null, identityLabel),
        h("input", {
          value: identity,
          onChange: (event) => setIdentity(event.target.value),
          placeholder: identityPlaceholder,
          maxLength: 512,
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
          autoComplete: "off",
          disabled: busy,
          required: true
        })
      ) : null,
      h(
        "label",
        { className: "dim-credentialField" },
        h("span", null, secretLabel),
        h("input", {
          type: "password",
          value: secret,
          onChange: (event) => setSecret(event.target.value),
          placeholder: secretPlaceholder,
          maxLength: 1024,
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
          autoComplete: "new-password",
          disabled: busy,
          required: true
        })
      ),
      error ? h(FeedbackToast, { text: error.message ?? String(error), tone: "error" }) : null,
      h(
        "div",
        { className: "ddt-actions dim-viewActions dim-credentialActions" },
        h(ActionButton, {
          type: "submit",
          className: "ddt-button",
          "data-kind": "primary",
          disabled: busy || hasIdentity && !identity.trim() || !secret.trim(),
          loading: busy
        }, "\u7ED1\u5B9A\u5E76\u8FDE\u63A5"),
        h("button", {
          type: "button",
          className: "ddt-button",
          onClick: onCancel,
          disabled: busy
        }, "\u53D6\u6D88")
      )
    )
  );
}

// plugin-src/client/workspace-editor.js
var React7 = __toESM(require("react"), 1);

// plugin-src/client/workspace-directory-picker.js
var React6 = __toESM(require("react"), 1);
var import_react_dom2 = require("react-dom");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
function pickerErrorCode(error) {
  return error?.rpcError?.code ?? error?.code;
}
function pickerErrorDetails(error) {
  return error?.rpcError?.details ?? error?.details;
}
function pickerErrorMessage(error) {
  return error?.rpcError?.message ?? error?.message ?? "\u65E0\u6CD5\u8BFB\u53D6\u76EE\u5F55\uFF0C\u8BF7\u91CD\u8BD5\u3002";
}
function FolderIcon() {
  return React6.createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    },
    React6.createElement("path", { d: "M3.5 7.25A2.25 2.25 0 0 1 5.75 5h4.1l1.8 2h6.6a2.25 2.25 0 0 1 2.25 2.25v7A2.75 2.75 0 0 1 17.75 19h-12A2.25 2.25 0 0 1 3.5 16.75v-9.5Z" })
  );
}
function ChevronIcon() {
  return React6.createElement("svg", {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true"
  }, React6.createElement("path", { d: "m7.5 4.5 5 5.5-5 5.5" }));
}
function displayCrumbs(listing) {
  const homeIndex = listing.crumbs.findIndex((crumb) => crumb.path === listing.home);
  if (homeIndex < 0) return listing.crumbs;
  return listing.crumbs.slice(homeIndex);
}
function WorkspaceDirectoryPicker({
  open,
  startPath,
  picker,
  busy = false,
  saveError = null,
  onPicked,
  onCancel
}) {
  const [listing, setListing] = React6.useState(null);
  const [loading, setLoading] = React6.useState(false);
  const [error, setError] = React6.useState(null);
  const [showHidden, setShowHidden] = React6.useState(false);
  const [retryKey, setRetryKey] = React6.useState(0);
  const requestRef = React6.useRef(0);
  const controllerRef = React6.useRef(null);
  const dialogRef = React6.useRef(null);
  const ownerRef = React6.useRef(null);
  const bodyRef = React6.useRef(null);
  const titleId = React6.useId();
  const noticeId = React6.useId();
  const initialPathRef = React6.useRef(startPath);
  const onPickedRef = React6.useRef(onPicked);
  const onCancelRef = React6.useRef(onCancel);
  onPickedRef.current = onPicked;
  onCancelRef.current = onCancel;
  (0, import_dsh_client_ui_primitives2.useModalLayer)(dialogRef, open, () => {
    if (!busy) onCancel?.();
  }, ownerRef);
  const loadDirectory = React6.useCallback(async (path, { reportError = true } = {}) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    if (reportError) setError(null);
    try {
      const next = await picker.listDirectory(path, controller.signal);
      if (request !== requestRef.current || controller.signal.aborted) return { aborted: true };
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      setListing(next);
      setError(null);
      return { value: next };
    } catch (cause) {
      if (request !== requestRef.current || controller.signal.aborted) return { aborted: true };
      if (reportError) setError(pickerErrorMessage(cause));
      return { error: cause };
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [picker]);
  React6.useEffect(() => {
    if (!open) return void 0;
    let active = true;
    setListing(null);
    setError(null);
    setShowHidden(false);
    const start = async () => {
      const initialPath = initialPathRef.current;
      const initial = await loadDirectory(initialPath || void 0, { reportError: false });
      if (!active || initial.aborted || initial.value) return;
      const code = pickerErrorCode(initial.error);
      const details = pickerErrorDetails(initial.error);
      if (code === "directory-picker-unavailable" && details?.capability === "native" && typeof picker.pickDirectory === "function") {
        setLoading(true);
        try {
          const selected = await picker.pickDirectory();
          if (!active) return;
          if (selected !== null) await onPickedRef.current?.(selected);
          else onCancelRef.current?.();
        } catch (cause) {
          if (active) setError(pickerErrorMessage(cause));
        } finally {
          if (active) setLoading(false);
        }
        return;
      }
      if (initialPath && code === "directory-unreadable") {
        const home = await loadDirectory(void 0, { reportError: false });
        if (!active || home.aborted || home.value) return;
        setError(pickerErrorMessage(home.error));
        return;
      }
      setError(pickerErrorMessage(initial.error));
    };
    void start();
    return () => {
      active = false;
      requestRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [loadDirectory, open, picker, retryKey]);
  if (!open) return null;
  const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden);
  const crumbs = listing ? displayCrumbs(listing) : [];
  const presentedError = saveError ?? error;
  const content = h(
    "div",
    {
      className: "dim-directoryPickerBackdrop",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }
    },
    h(
      "section",
      {
        ref: dialogRef,
        className: "dim-directoryPicker",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        "aria-describedby": noticeId,
        tabIndex: -1
      },
      h(
        "header",
        { className: "dim-directoryPickerHeader" },
        h("h3", { id: titleId }, "\u9009\u62E9\u673A\u5668\u4EBA\u5DE5\u4F5C\u533A\u76EE\u5F55"),
        listing ? h(
          "nav",
          { className: "dim-directoryCrumbs", "aria-label": "\u5F53\u524D\u76EE\u5F55" },
          crumbs.map((crumb, index) => h(
            React6.Fragment,
            { key: crumb.path },
            index > 0 ? h("span", { className: "dim-directoryCrumbSeparator", "aria-hidden": "true" }, "\u203A") : null,
            React6.createElement("button", {
              type: "button",
              title: crumb.path,
              disabled: loading || busy,
              "aria-current": index === crumbs.length - 1 ? "page" : void 0,
              onClick: () => void loadDirectory(crumb.path)
            }, crumb.path === listing.home ? h("span", null, "\u4E3B\u76EE\u5F55") : crumb.name || crumb.path)
          ))
        ) : h("p", null, "\u6B63\u5728\u51C6\u5907\u76EE\u5F55\u9009\u62E9\u5668\u2026")
      ),
      h(
        "div",
        { ref: bodyRef, className: "dim-directoryPickerBody", "aria-busy": loading },
        loading && !listing ? h(
          "div",
          { className: "dim-directoryPickerState" },
          h("span", { className: "dim-directoryPickerSpinner", "aria-hidden": "true" }),
          h("p", null, "\u6B63\u5728\u8BFB\u53D6\u76EE\u5F55\u2026")
        ) : listing ? entries.length > 0 ? h("ul", { className: "dim-directoryList" }, entries.map((entry) => h(
          "li",
          { key: entry.path },
          React6.createElement(
            "button",
            {
              type: "button",
              title: entry.path,
              disabled: loading || busy,
              onClick: () => void loadDirectory(entry.path)
            },
            h("span", { className: "dim-directoryFolder" }, h(FolderIcon)),
            React6.createElement("span", { className: "dim-directoryName" }, entry.name),
            h("span", { className: "dim-directoryChevron" }, h(ChevronIcon))
          )
        ))) : h(
          "div",
          { className: "dim-directoryPickerState" },
          h("p", null, "\u8FD9\u4E2A\u76EE\u5F55\u4E2D\u6CA1\u6709\u5B50\u6587\u4EF6\u5939\u3002")
        ) : null,
        listing?.truncated ? h("p", { className: "dim-directoryPickerTruncated" }, "\u6B64\u76EE\u5F55\u7684\u5B50\u6587\u4EF6\u5939\u8FC7\u591A\uFF0C\u4EC5\u663E\u793A\u524D\u4E00\u90E8\u5206\u3002") : null,
        presentedError ? h(FeedbackToast, {
          text: presentedError,
          tone: "error",
          actions: !listing && !busy ? [{ label: "\u91CD\u8BD5", onClick: () => setRetryKey((value) => value + 1) }] : void 0
        }) : null
      ),
      h(
        "footer",
        { className: "dim-directoryPickerFooter" },
        h(
          "button",
          {
            type: "button",
            className: "dim-directoryHidden",
            "aria-pressed": showHidden,
            onClick: () => setShowHidden((value) => !value),
            disabled: busy || !listing
          },
          h("span", { className: "dim-directoryHiddenBox", "aria-hidden": "true" }),
          h("span", null, "\u663E\u793A\u9690\u85CF\u6587\u4EF6\u5939")
        ),
        h("p", { id: noticeId, className: "dim-directoryPickerNotice" }, "\u5207\u6362\u540E\u4F1A\u6E05\u9664\u8FD9\u4E2A\u673A\u5668\u4EBA\u7684\u65E7\u4F1A\u8BDD\u6620\u5C04\u3002"),
        h(
          "div",
          { className: "dim-directoryPickerActions" },
          h("button", { type: "button", onClick: onCancel, disabled: busy }, "\u53D6\u6D88"),
          h(ActionButton, {
            type: "button",
            className: "dim-directoryPickerPrimary",
            disabled: busy || loading || !listing,
            onClick: () => listing && void onPicked(listing.path),
            loading: busy
          }, "\u9009\u62E9\u6B64\u76EE\u5F55")
        )
      )
    )
  );
  return h(
    React6.Fragment,
    null,
    h("span", { ref: ownerRef, hidden: true, "data-dsh-modal-owner": "" }),
    typeof document === "undefined" ? content : (0, import_react_dom2.createPortal)(content, document.body)
  );
}

// plugin-src/client/workspace-editor.js
var WorkspaceDirectoryPickerContext = React7.createContext(null);
function WorkspaceEditor({ workspace, directoryPicker, disabled = false, onSave }) {
  const sharedDirectoryPicker = React7.useContext(WorkspaceDirectoryPickerContext);
  const activeDirectoryPicker = directoryPicker ?? sharedDirectoryPicker;
  const [open, setOpen] = React7.useState(false);
  const [saving, setSaving] = React7.useState(false);
  const [error, setError] = React7.useState(null);
  const editButtonRef = React7.useRef(null);
  const savingRef = React7.useRef(false);
  const close = React7.useCallback(() => {
    setOpen(false);
    setError(null);
    queueMicrotask(() => editButtonRef.current?.focus?.());
  }, []);
  const pick = React7.useCallback(async (value) => {
    if (!value || savingRef.current || disabled) return;
    if (value === workspace) {
      close();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(value);
      close();
    } catch (cause) {
      setError(cause?.message ?? "\u5DE5\u4F5C\u533A\u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [close, disabled, onSave, workspace]);
  return h(
    "div",
    { className: "dim-workspace" },
    h(
      "div",
      { className: "dim-workspaceHeader" },
      h("span", null, "\u5F53\u524D\u5DE5\u4F5C\u533A"),
      h("button", {
        type: "button",
        ref: editButtonRef,
        className: "dim-workspaceEdit",
        onClick: () => {
          setOpen(true);
          setError(null);
        },
        disabled: disabled || !activeDirectoryPicker
      }, "\u9009\u62E9\u76EE\u5F55")
    ),
    workspace ? React7.createElement("code", {
      className: "dim-workspacePath",
      title: workspace
    }, workspace) : h("code", { className: "dim-workspacePath" }, "\u672A\u8BBE\u7F6E"),
    open ? h(WorkspaceDirectoryPicker, {
      open,
      startPath: workspace,
      picker: activeDirectoryPicker,
      busy: saving || disabled,
      saveError: error,
      onPicked: pick,
      onCancel: close
    }) : null
  );
}

// plugin-src/client/workspace-snapshot-fence.js
var React8 = __toESM(require("react"), 1);
function useWorkspaceSnapshotFence() {
  const state = React8.useRef({ version: 0, pendingMutations: 0 });
  return React8.useMemo(() => Object.freeze({
    beginStatus() {
      return state.current.pendingMutations === 0 ? state.current.version : null;
    },
    canCommitStatus(version) {
      return version !== null && state.current.pendingMutations === 0 && state.current.version === version;
    },
    beginMutation() {
      state.current.pendingMutations += 1;
      state.current.version += 1;
      return state.current.version;
    },
    canCommitMutation(version) {
      return state.current.version === version;
    },
    endMutation() {
      state.current.pendingMutations = Math.max(0, state.current.pendingMutations - 1);
      return state.current.pendingMutations === 0;
    }
  }), []);
}

// plugin-src/client/channel-card-meta.js
var React9 = __toESM(require("react"), 1);
function messageErrorTime(value) {
  try {
    return new Intl.DateTimeFormat(isEnglish() ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return null;
  }
}
function ChannelListHeading({ className = "", id: id5, title, connectionLabel }) {
  const helpId = React9.useId();
  return h(
    "div",
    { className: `${className} dim-listHeading`.trim() },
    h(
      "div",
      { className: "dim-listTitle" },
      h("h3", id5 ? { id: id5 } : null, title),
      h(
        "span",
        { className: "dim-channelHelp" },
        h("button", {
          type: "button",
          className: "dim-channelHelpButton",
          "aria-label": "\u67E5\u770B\u6D88\u606F\u901A\u9053\u8BF4\u660E",
          "aria-describedby": helpId
        }, h("span", { "aria-hidden": "true" }, "?")),
        h(
          "span",
          {
            id: helpId,
            className: "dim-channelTooltip",
            role: "tooltip"
          },
          h("span", null, "\u6D88\u606F\u901A\u9053"),
          h("strong", null, connectionLabel)
        )
      )
    )
  );
}
function BotStatusMeta({
  className = "",
  dotClassName = "",
  tone,
  stateLabel: stateLabel2,
  lastCheckedAt,
  formatCheckedTime: formatCheckedTime2,
  healthState
}) {
  return h(
    "div",
    { className: "dim-botHealthGroup" },
    h(
      "div",
      {
        className: `${className} dim-botHealth`.trim(),
        ...healthState ? { "data-health": healthState } : {}
      },
      h("span", {
        className: `${dotClassName} dim-healthDot`.trim(),
        "data-tone": tone
      }),
      h("span", null, stateLabel2)
    ),
    h(
      "div",
      { className: "dim-lastChecked" },
      h("span", null, "\u6700\u8FD1\u68C0\u67E5"),
      h("span", null, formatCheckedTime2(lastCheckedAt))
    )
  );
}
function LastMessageErrorSummary({ className = "", error }) {
  if (!error) return null;
  const occurredAt = messageErrorTime(error.at);
  return h(
    "div",
    {
      className: `${className} dim-cardSummary`.trim(),
      role: "status"
    },
    h("strong", null, "\u6700\u8FD1\u4E00\u6761\u6D88\u606F\u5904\u7406\u5931\u8D25"),
    "\uFF1A",
    h("span", null, error.message),
    "\uFF08",
    h("span", null, "\u9519\u8BEF\u7801"),
    ` ${error.code} \xB7 `,
    h("span", null, "\u53C2\u8003\u53F7"),
    ` ${error.referenceId}`,
    occurredAt ? h(
      React9.Fragment,
      null,
      " \xB7 ",
      h("time", { dateTime: new Date(error.at).toISOString() }, occurredAt)
    ) : null,
    "\uFF09"
  );
}

// plugin-src/client/channels/dingtalk/styles.js
var DINGTALK_STYLE_ID = "xmanrui-dsh-im-dingtalk-settings";
var CSS = String.raw`
.ddt-page {
  --ddt-accent: #1677ff;
  --ddt-accent-deep: #0958d9;
  --ddt-accent-wash: #eaf3ff;
  --ddt-success: var(--dsw-alias-state-success-primary, #20a162);
  --ddt-warning: var(--dsw-alias-state-warn-primary, #d97706);
  --ddt-error: var(--dsw-alias-state-error-primary, #d54941);
  width: 100%;
  max-width: 880px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 2px 0 28px;
  container-type: inline-size;
  color: var(--dsw-alias-label-primary, #1f2329);
  box-sizing: border-box;
}
.ddt-page *, .ddt-page *::before, .ddt-page *::after { box-sizing: border-box; }
.ddt-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.ddt-headingCopy { min-width: 0; }
.ddt-heading h2, .ddt-heading p, .ddt-card h3, .ddt-card h4, .ddt-card p { margin: 0; }
.ddt-eyebrow { margin-bottom: 3px; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.ddt-heading h2 { font-size: 20px; line-height: 28px; font-weight: 700; }
.ddt-heading p { margin-top: 5px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 20px; white-space: nowrap; }
.ddt-tools, .ddt-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.ddt-tools { width: 100%; justify-content: space-between; flex-wrap: nowrap; }
.ddt-badge { min-height: 30px; display: inline-flex; align-items: center; gap: 7px; padding: 0 11px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-bg-module-platform, #f2f3f5); font-size: 12px; white-space: nowrap; }
.ddt-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #aeb3bb; }
.ddt-dot[data-tone="success"] { background: var(--ddt-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ddt-success) 14%, transparent); }
.ddt-dot[data-tone="warning"] { background: var(--ddt-warning); }
.ddt-dot[data-tone="error"] { background: var(--ddt-error); }
.ddt-button { height: 36px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; color: var(--dsw-alias-label-primary); background: transparent; font: inherit; font-size: 13px; font-weight: 500; text-decoration: none; cursor: pointer; box-shadow: none; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.ddt-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
.ddt-button:active:not(:disabled) { transform: translateY(1px); }
.ddt-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.ddt-button:disabled { cursor: not-allowed; opacity: .55; }
.ddt-button[data-kind="primary"] { color: var(--dsw-alias-label-primary-foreground); border: none; background: var(--dsw-alias-button-primary-fill); }
.ddt-button[data-kind="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.ddt-button[data-kind="danger"] { color: var(--ddt-error); }
.ddt-button[data-kind="quiet"] { height: 28px; min-height: 28px; padding: 0 10px; border-radius: 14px; border-color: transparent; background: transparent; }
.ddt-card { overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: none; }
.ddt-cardBody { padding: 24px; }
.ddt-empty { min-height: 230px; display: grid; grid-template-columns: minmax(0, 1fr) 180px; align-items: center; gap: 30px; }
.ddt-empty h3 { margin: 8px 0; font-size: 18px; }
.ddt-empty p { max-width: 560px; color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.65; }
.ddt-empty .ddt-actions { margin-top: 20px; }
.ddt-brandMark { width: 110px; height: 110px; display: grid; place-items: center; justify-self: center; border-radius: 28px; color: #fff; background: linear-gradient(145deg, #2997ff, var(--ddt-accent)); box-shadow: none; }
.ddt-brandMark svg { filter: drop-shadow(0 3px 8px rgb(0 35 96 / 16%)); }
.ddt-qrLayout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 34px; align-items: start; }
.ddt-qrColumn { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.ddt-qrFrame { position: relative; width: min(270px, 100%); aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; padding: 10px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 16px; background: #fff; }
.ddt-qrFrame::before { content: ''; position: absolute; inset: 6px; border: 1px solid rgb(22 119 255 / 10%); border-radius: 11px; pointer-events: none; }
.ddt-qrFrame img { display: block; width: 100%; height: 100%; object-fit: contain; }
.ddt-qrFallback { padding: 24px; color: #646a73; text-align: center; }
.ddt-expired { position: absolute; inset: 0; display: grid; place-items: center; padding: 30px; color: #fff; text-align: center; font-weight: 600; white-space: pre-line; background: rgb(31 35 41 / 76%); backdrop-filter: blur(3px); }
.ddt-countdown { width: min(270px, 100%); color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.ddt-countdownTop { display: flex; justify-content: space-between; margin-bottom: 6px; }
.ddt-countdown strong { color: var(--dsw-alias-label-primary, #1f2329); font-variant-numeric: tabular-nums; }
.ddt-progress { height: 4px; overflow: hidden; border-radius: 99px; background: #eef0f3; }
.ddt-progress span { display: block; width: var(--ddt-progress); height: 100%; background: var(--dsw-alias-state-business-primary); transition: width .2s linear; }
.ddt-stateLabel { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; font-weight: 600; }
.ddt-qrCopy { min-width: 0; overflow-wrap: anywhere; }
.ddt-qrCopy h3 { margin: 9px 0 8px; font-size: 18px; }
.ddt-qrCopy > p { color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.65; }
.ddt-steps { margin: 18px 0 16px; padding: 0; list-style: none; counter-reset: ddt-step; }
.ddt-steps li { position: relative; min-height: 28px; padding: 3px 0 3px 36px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 22px; counter-increment: ddt-step; }
.ddt-steps li::before { content: counter(ddt-step); position: absolute; left: 0; top: 1px; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; color: var(--ddt-accent-deep); background: var(--ddt-accent-wash); font-size: 12px; font-weight: 700; }
.ddt-loading { padding: 38px; color: var(--dsw-alias-label-secondary, #646a73); text-align: center; }
.ddt-loading h3 { margin: 0 0 7px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 17px; }
.ddt-loading p { line-height: 1.6; }
.ddt-spinner { width: 24px; height: 24px; margin: 0 auto 13px; border: 3px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-state-business-primary); border-radius: 50%; animation: ddt-spin .8s linear infinite; }
.ddt-statusNotice, .ddt-inlineError { display: flex; align-items: flex-start; gap: 10px; padding: 13px 15px; border: 1px solid color-mix(in srgb, var(--ddt-error) 28%, transparent); border-radius: 10px; color: var(--ddt-error); background: color-mix(in srgb, var(--ddt-error) 7%, transparent); font-size: 13px; }
.ddt-inlineError { flex-direction: column; padding: 22px; }
.ddt-inlineError h3 { font-size: 17px; }
.ddt-inlineError p { line-height: 1.55; }
.ddt-errorCode { font: 11px ui-monospace, SFMono-Regular, monospace; opacity: .8; }
.ddt-listHeading { display: flex; align-items: center; justify-content: space-between; margin: 2px 0 9px; }
.ddt-listHeading h3 { margin: 0; font-size: 14px; }
.ddt-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.ddt-accountTop { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ddt-accountIdentity { min-width: 0; display: flex; align-items: center; gap: 12px; }
.ddt-avatar { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 12px; color: #fff; background: linear-gradient(145deg, #2997ff, var(--ddt-accent)); }
.ddt-accountIdentity h3 { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.ddt-accountIdentity p { margin-top: 4px; color: var(--dsw-alias-label-secondary, #646a73); font: 12px ui-monospace, SFMono-Regular, monospace; }
.ddt-health { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; white-space: nowrap; }
.ddt-accountFooter { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1, #eef0f3); }
.ddt-accountFooter .ddt-actions { flex: none; flex-wrap: nowrap; gap: 8px; margin-top: 0; }
.ddt-accountFooter .ddt-button { flex: none; white-space: nowrap; }
.ddt-summary { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.ddt-confirm { padding: 18px 24px; border-top: 1px solid color-mix(in srgb, var(--ddt-error) 25%, transparent); background: color-mix(in srgb, var(--ddt-error) 5%, transparent); }
.ddt-confirm strong { display: block; margin-bottom: 6px; font-size: 14px; }
.ddt-confirm p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.55; }
.ddt-confirm .ddt-actions { margin-top: 13px; }
.ddt-visuallyHidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes ddt-spin { to { transform: rotate(360deg); } }
@container (max-width: 680px) {
  .ddt-heading { flex-direction: column; align-items: stretch; }
  .ddt-tools { width: 100%; flex-wrap: nowrap; gap: 6px; }
  .ddt-tools .ddt-badge { min-height: 34px; padding-inline: 8px; }
  .ddt-tools .ddt-button { flex: none; padding-inline: 10px; white-space: nowrap; }
  .ddt-empty { grid-template-columns: minmax(0, 1fr); }
  .ddt-brandMark { display: none; }
  .ddt-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 24px; }
  .ddt-qrColumn { width: 100%; min-width: 0; }
  .ddt-qrCopy { width: 100%; }
}
@media (max-width: 720px) {
  .ddt-heading, .ddt-accountTop { flex-direction: column; align-items: stretch; }
  .ddt-heading p { white-space: normal; }
  .ddt-empty { grid-template-columns: minmax(0, 1fr); }
  .ddt-brandMark { display: none; }
  .ddt-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .ddt-qrCopy { width: 100%; }
  .ddt-cardBody { padding: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .ddt-page *, .ddt-page *::before, .ddt-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;
function installDingtalkStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${DINGTALK_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = DINGTALK_STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/dingtalk/index.js
var ACTIVE_PROVISION_STATES = /* @__PURE__ */ new Set(["pending", "scanned", "authorizing", "creating", "connecting"]);
function DingtalkIcon({ size = 28 }) {
  return h("svg", {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    focusable: "false"
  }, h("path", {
    fill: "currentColor",
    d: "M37.05 22.783c-6.758-5.216-14.378-12.128-22.73-19.538-.655-.585-1.242-.354-1.536.42-1.88 4.973-.058 9.386 2.889 11.932s7.368 4.912 10.058 6.155c.105.049.013.203-.093.163-4.953-2.182-8.397-3.765-13.07-7.368-.497-.388-1.01-.242-1.07.521-.384 4.748 2.657 8.483 6.058 9.745 2.1.781 4.398 1.212 6.53 1.474.109.015.084.178-.027.178-2.747.01-6.058-.654-8.935-1.751-.606-.233-.818.25-.722.633.491 2.008 2.974 5.076 6.926 5.73a12 12 0 0 0 2.228.115c.164 0 .208.089.154.217q-2.685 4.6-2.803 4.797c-.091.152-.036.275.156.275h3.543c.164 0 .264.106.18.246l-4.958 8.196c-.191.328.035.565.395.301s15.212-11.133 15.636-11.448c.195-.142.148-.327-.124-.327h-3.18c-.206 0-.252-.14-.111-.28.14-.141 3.602-3.594 4.837-4.888 1.283-1.35 1.938-3.825-.231-5.498"
  }));
}
var Button = React10.forwardRef(function Button2({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `ddt-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function Heading({ totals, adding, busy, onAdd, onCredential, credentialOpen, addButtonRef }) {
  return h(
    "div",
    { className: "ddt-heading" },
    h(
      "div",
      { className: "ddt-headingCopy" },
      h("div", { className: "ddt-eyebrow" }, "Channel"),
      h("h2", null, "\u9489\u9489\u673A\u5668\u4EBA"),
      h("p", null, "\u901A\u8FC7\u626B\u7801\u628A\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165 DeepSeek Harness")
    ),
    h(
      "div",
      { className: "ddt-tools" },
      h(
        "div",
        { className: "dim-bindActions" },
        h(Button, {
          kind: "primary",
          className: "dim-scanButton",
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          "aria-label": "\u626B\u7801\u63A5\u5165\u9489\u9489\u673A\u5668\u4EBA",
          loading: adding
        }, h(QrActionIcon), "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA"),
        h(Button, {
          kind: "credential",
          className: "dim-credentialButton",
          onClick: onCredential,
          disabled: adding || busy,
          "aria-pressed": credentialOpen,
          "aria-label": "\u4F7F\u7528 Client ID \u548C Client Secret \u7ED1\u5B9A\u9489\u9489\u673A\u5668\u4EBA"
        }, h(CredentialActionIcon), credentialOpen ? "\u6536\u8D77\u51ED\u636E" : "\u624B\u52A8\u63A5\u5165")
      ),
      totals.configured > 0 ? h(
        "div",
        { className: "ddt-badge dim-onlineBadge" },
        h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)
      ) : null
    )
  );
}
function LoadingView() {
  return h(
    "div",
    { className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "ddt-spinner dim-spinner" }),
    h("span", null, "\u6B63\u5728\u8BFB\u53D6\u9489\u9489\u8FDE\u63A5\u72B6\u6001\u2026")
  );
}
function EmptyView({ busy, onStart }) {
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "dim-emptyCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u63A5\u5165\u9489\u9489\u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u626B\u4E00\u6B21\u7801\uFF0C\u81EA\u52A8\u521B\u5EFA\u5E76\u8FDE\u63A5\u673A\u5668\u4EBA"),
        h("p", null, "\u6388\u6743\u7531\u9489\u9489\u5B98\u65B9\u9875\u9762\u5B8C\u6210\u3002\u626B\u7801\u8D26\u53F7\u5FC5\u987B\u5DF2\u52A0\u5165\u4E00\u4E2A\u4F01\u4E1A/\u7EC4\u7EC7\u5E76\u6709\u6743\u521B\u5EFA\u673A\u5668\u4EBA\uFF1B\u521B\u5EFA\u6210\u529F\u540E\uFF0C\u5E94\u7528\u51ED\u636E\u4F1A\u76F4\u63A5\u5199\u5165 Harness Host\u3002"),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(
            Button,
            { kind: "primary", onClick: onStart, disabled: busy, loading: busy },
            "\u751F\u6210\u9489\u9489\u4E8C\u7EF4\u7801"
          )
        )
      ),
      h(
        "div",
        { className: "ddt-brandMark dim-emptyBrand", "aria-hidden": "true" },
        h(DingtalkIcon, { size: 68 })
      )
    )
  );
}
function QrPanel({ provision, now, busy, onRefresh, onCancel }) {
  const [imageFailed, setImageFailed] = React10.useState(false);
  const source = safeQrSource(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = remaining === 0 || provision.status === "expired";
  const duration = Math.max(1, provision.durationMs ?? 10 * 6e4);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  React10.useEffect(() => setImageFailed(false), [source]);
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "ddt-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "ddt-qrFrame dim-qrFrame" },
          source && !imageFailed ? h("img", {
            src: source,
            alt: "\u7528\u4E8E\u628A\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165 DeepSeek Harness \u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801",
            onError: () => setImageFailed(true)
          }) : h("div", { className: "ddt-qrFallback dim-qrFallback" }, "\u4E8C\u7EF4\u7801\u56FE\u7247\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u3002"),
          expired ? h("div", { className: "ddt-expired dim-qrExpired" }, "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\n\u8BF7\u91CD\u65B0\u751F\u6210") : null
        ),
        h(
          "div",
          { className: "ddt-countdown dim-countdown" },
          h(
            "div",
            { className: "ddt-countdownTop dim-countdownTop" },
            h("span", null, "\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, formatRemaining(remaining))
          ),
          h(
            "div",
            { className: "ddt-progress dim-progress", "aria-hidden": "true" },
            h("span", { style: { "--ddt-progress": `${progress}%` } })
          )
        )
      ),
      h(
        "div",
        { className: "ddt-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot", "data-tone": expired ? "error" : "warning" }),
          h("span", null, expired ? "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548" : "\u7B49\u5F85\u9489\u9489\u626B\u7801\u6388\u6743")
        ),
        h("h3", null, expired ? "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801\u540E\u7EE7\u7EED" : "\u4F7F\u7528\u9489\u9489 App \u5B8C\u6210\u673A\u5668\u4EBA\u6388\u6743"),
        h("p", null, "\u626B\u7801\u8D26\u53F7\u5FC5\u987B\u5DF2\u52A0\u5165\u4F01\u4E1A/\u7EC4\u7EC7\u3002\u5982\u679C\u9489\u9489\u63D0\u793A\u5C1A\u672A\u52A0\u5165\u7EC4\u7EC7\uFF0C\u8BF7\u5728\u63D0\u793A\u9875\u521B\u5EFA\u7EC4\u7EC7\uFF0C\u6216\u6362\u7528\u5DF2\u52A0\u5165\u7EC4\u7EC7\u7684\u8D26\u53F7\u3002"),
        h(
          "ol",
          { className: "ddt-steps dim-steps" },
          h("li", null, "\u4F7F\u7528\u5DF2\u52A0\u5165\u4F01\u4E1A/\u7EC4\u7EC7\u7684\u9489\u9489\u8D26\u53F7\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801"),
          h("li", null, "\u5728\u6388\u6743\u9875\u70B9\u51FB\u201C\u4E00\u952E\u521B\u5EFA\u65B0\u673A\u5668\u4EBA\u201D"),
          h("li", null, "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u673A\u5668\u4EBA\u81EA\u52A8\u8FDE\u63A5")
        ),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          expired ? h(Button, { kind: "primary", onClick: onRefresh, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801") : null,
          !expired ? h(Button, { onClick: onRefresh, disabled: busy }, "\u6362\u4E00\u4E2A\u4E8C\u7EF4\u7801") : null,
          h(Button, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
        )
      )
    )
  );
}
function ProgressPanel({ status, busy, onCancel }) {
  const connecting = status === "connecting";
  const creating = status === "creating";
  return h(
    "div",
    { className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "ddt-spinner dim-spinner" }),
    h("h3", null, connecting ? "\u673A\u5668\u4EBA\u5DF2\u521B\u5EFA\uFF0C\u6B63\u5728\u5EFA\u7ACB\u6D88\u606F\u8FDE\u63A5" : creating ? "\u6388\u6743\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u521B\u5EFA\u9489\u9489\u673A\u5668\u4EBA" : "\u6B63\u5728\u786E\u8BA4\u9489\u9489\u6388\u6743"),
    h("p", null, connecting ? "\u6B63\u5728\u68C0\u67E5\u9489\u9489 Stream \u957F\u8FDE\u63A5\uFF0C\u6210\u529F\u540E\u4F1A\u81EA\u52A8\u663E\u793A\u4E3A\u5728\u7EBF\u3002" : "\u8BF7\u52FF\u5173\u95ED\u672C\u9875\uFF0C\u9489\u9489\u5B8C\u6210\u6388\u6743\u540E\u5C06\u81EA\u52A8\u7EE7\u7EED\u3002"),
    h(
      "div",
      { className: "ddt-actions dim-viewActions", style: { justifyContent: "center", marginTop: 14 } },
      h(Button, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88\u63A5\u5165")
    )
  );
}
function ProvisionError({ provision, busy, onRetry, onClose }) {
  const error = provision.error ?? {
    code: "DINGTALK_PROVISION_FAILED",
    message: "\u9489\u9489\u673A\u5668\u4EBA\u6CA1\u6709\u63A5\u5165\u5B8C\u6210"
  };
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-inlineError dim-inlineError", role: "alert" },
      h("h3", null, provision.status === "expired" ? "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F" : "\u9489\u9489\u673A\u5668\u4EBA\u6CA1\u6709\u63A5\u5165\u5B8C\u6210"),
      h("p", null, error.message),
      h("span", { className: "ddt-errorCode" }, error.code),
      h(
        "div",
        { className: "ddt-actions dim-viewActions" },
        h(Button, { kind: "primary", onClick: onRetry, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
        h(Button, { onClick: onClose, disabled: busy }, "\u5173\u95ED")
      )
    )
  );
}
function checkedTime(value) {
  if (!value) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "\u521A\u521A";
  }
}
function RemoveConfirmation({ account, busy, error, feedbackSequence, onConfirm, onCancel }) {
  const cancelRef = React10.useRef(null);
  React10.useEffect(() => cancelRef.current?.focus(), []);
  return h(
    ConfirmDialog,
    {
      className: "ddt-confirm dim-confirm",
      role: "alertdialog",
      "aria-label": `\u79FB\u9664${account.bot.name}`,
      onKeyDown: (event) => {
        if (event.key === "Escape" && !busy) onCancel();
      },
      onClose: onCancel,
      busy: Boolean(busy),
      error,
      feedbackSequence
    },
    h("strong", null, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${account.bot.name}\u201D\uFF1F`),
    h("p", null, "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u9489\u9489\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002"),
    h(
      "div",
      { className: "ddt-actions dim-viewActions" },
      h(Button, { ref: cancelRef, onClick: onCancel, disabled: busy }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(
        Button,
        { kind: "danger", onClick: onConfirm, disabled: busy, loading: busy },
        "\u786E\u8BA4\u79FB\u9664\u63A5\u5165"
      )
    )
  );
}
function AccountCard({
  account,
  busy,
  feedback,
  removing,
  removeError,
  removeFeedbackSequence,
  onReconnect,
  onWorkspaceSave,
  onAgentPresetSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove
}) {
  const state = busy === "reconnect" ? "connecting" : account.state;
  const tone = account.connected ? "success" : state === "error" ? "error" : "warning";
  const stateLabel2 = account.connected ? "\u8FD0\u884C\u6B63\u5E38" : state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA";
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h(
    "article",
    { className: "ddt-card dim-botCard", tabIndex: -1, "data-bot-id": account.botId },
    h(
      "div",
      { className: "ddt-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "ddt-accountTop dim-botCardTop" },
        h(
          "div",
          { className: "ddt-accountIdentity dim-botIdentity" },
          h("div", { className: "ddt-avatar dim-botAvatar", "aria-hidden": "true" }, h(DingtalkIcon, { size: 29 })),
          h(
            "div",
            { className: "dim-botName" },
            h("h3", { title: account.bot.name }, account.bot.name),
            h("p", { title: account.bot.clientIdMasked }, account.bot.clientIdMasked)
          )
        ),
        h(BotStatusMeta, {
          className: "ddt-health",
          dotClassName: "ddt-dot",
          tone,
          stateLabel: stateLabel2,
          lastCheckedAt: account.health.lastCheckedAt,
          formatCheckedTime: checkedTime
        })
      ),
      h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(
        "div",
        { className: "ddt-accountFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "ddt-actions dim-cardActions" },
            h(
              Button,
              { className: "dim-cardAction", onClick: onReconnect, disabled: Boolean(busy), loading: busy === "reconnect" },
              account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"
            ),
            h(
              Button,
              { className: "dim-cardAction", kind: "danger", onClick: onRequestRemove, disabled: Boolean(busy) },
              "\u79FB\u9664\u63A5\u5165"
            )
          ),
          summary ? h("div", { className: "ddt-summary dim-cardSummary" }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: "ddt-summary",
            error: account.lastMessageError
          }) : null,
          null
        )
      )
    ),
    removing ? h(RemoveConfirmation, {
      account,
      busy: busy === "delete",
      error: removeError,
      feedbackSequence: removeFeedbackSequence,
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function AccountList(props) {
  return h(
    "section",
    { className: "dim-listSection" },
    h(ChannelListHeading, {
      className: "ddt-listHeading",
      title: "\u5DF2\u63A5\u5165\u7684\u9489\u9489\u673A\u5668\u4EBA",
      connectionLabel: "Stream \u957F\u8FDE\u63A5"
    }),
    h("ul", { className: "ddt-list dim-botList" }, props.bots.map((account) => h(
      "li",
      { key: account.botId },
      h(AccountCard, {
        account,
        busy: props.busyByBot[account.botId],
        feedback: props.feedbackByBot[account.botId]?.message,
        removing: props.removeTarget === account.botId,
        removeError: props.removeErrorsByBot[account.botId]?.message,
        removeFeedbackSequence: props.removeErrorsByBot[account.botId]?.sequence,
        onReconnect: () => props.onReconnect(account),
        onWorkspaceSave: (workspace) => props.onWorkspaceSave(account, workspace),
        onAgentPresetSave: (agentPreset) => props.onAgentPresetSave(account, agentPreset),
        onRequestRemove: () => props.onRequestRemove(account),
        onConfirmRemove: () => props.onConfirmRemove(account),
        onCancelRemove: props.onCancelRemove
      })
    )))
  );
}
var EMPTY_TOTALS = Object.freeze({ configured: 0, connected: 0 });
function DingtalkSettingsTab({ rpcCall }) {
  const [model, setModel] = React10.useState({
    phase: "loading",
    bots: [],
    totals: EMPTY_TOTALS,
    revision: 0,
    error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [provision, setProvision] = React10.useState(null);
  const [busy, setBusy] = React10.useState(false);
  const [busyByBot, setBusyByBot] = React10.useState({});
  const [feedbackByBot, setFeedbackByBot] = React10.useState({});
  const [removeTarget, setRemoveTarget] = React10.useState(null);
  const [removeErrorsByBot, setRemoveErrorsByBot] = React10.useState({});
  const [credentialOpen, setCredentialOpen] = React10.useState(false);
  const [credentialError, setCredentialError] = React10.useState(null);
  const [notice, setNotice] = React10.useState("");
  const [now, setNow] = React10.useState(() => Date.now());
  const addButtonRef = React10.useRef(null);
  const mountedRef = React10.useRef(true);
  const statusRequestRef = React10.useRef(0);
  const workspaceFence = useWorkspaceSnapshotFence();
  const noticeFrameRef = React10.useRef(null);
  const focusFrameRef = React10.useRef(null);
  React10.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      statusRequestRef.current += 1;
      if (noticeFrameRef.current !== null) {
        window.cancelAnimationFrame(noticeFrameRef.current);
        noticeFrameRef.current = null;
      }
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, []);
  React10.useEffect(() => installDingtalkStyles(), []);
  const announce = React10.useCallback((message) => {
    if (!mountedRef.current) return;
    if (noticeFrameRef.current !== null) {
      window.cancelAnimationFrame(noticeFrameRef.current);
      noticeFrameRef.current = null;
    }
    setNotice("");
    if (message) {
      noticeFrameRef.current = window.requestAnimationFrame(() => {
        noticeFrameRef.current = null;
        if (mountedRef.current) setNotice(message);
      });
    }
  }, []);
  const discardStaleFeedback = React10.useCallback((snapshot) => {
    const botsById = new Map(snapshot.bots.map((bot) => [bot.botId, bot]));
    setFeedbackByBot((current) => {
      let changed = false;
      const next = { ...current };
      for (const [botId, feedback] of Object.entries(next)) {
        const bot = botsById.get(botId);
        if (!bot || feedback.clearWhenDisconnected && (!bot.connected || bot.error)) {
          delete next[botId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);
  const focusAddButton = React10.useCallback(() => {
    if (!mountedRef.current) return;
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (mountedRef.current) addButtonRef.current?.focus();
    });
  }, []);
  const invoke = React10.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== "function") throw new TypeError("\u9489\u9489\u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5");
    return unwrapRpcResult(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const loadStatus = React10.useCallback(async ({
    signal,
    silent = false,
    restoreProvisioning = false
  } = {}) => {
    if (!mountedRef.current || signal?.aborted) return void 0;
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return void 0;
    const requestId = statusRequestRef.current + 1;
    statusRequestRef.current = requestId;
    const canCommit = () => mountedRef.current && !signal?.aborted && statusRequestRef.current === requestId && workspaceFence.canCommitStatus(workspaceVersion);
    if (!silent && canCommit()) {
      setModel((current) => ({ ...current, phase: "loading", error: null }));
    }
    try {
      const snapshot = normalizeSnapshot(await invoke(DINGTALK_ENDPOINTS.status, {}, signal));
      if (!canCommit()) return void 0;
      setModel({
        phase: "ready",
        bots: snapshot.bots,
        totals: snapshot.totals,
        revision: snapshot.revision,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
      });
      discardStaleFeedback(snapshot);
      if (restoreProvisioning && snapshot.provisioning) {
        setProvision((current) => !current || current.attemptId === snapshot.provisioning.attemptId ? {
          ...current,
          ...snapshot.provisioning,
          durationMs: current?.durationMs ?? Math.max(1, snapshot.provisioning.expiresAt - Date.now())
        } : current);
      }
      return snapshot;
    } catch (error) {
      if (error?.name === "AbortError" || !canCommit()) return void 0;
      setModel((current) => ({
        ...current,
        phase: silent && current.phase === "ready" ? "ready" : "error",
        error: presentError(error)
      }));
      return void 0;
    }
  }, [discardStaleFeedback, invoke, workspaceFence]);
  React10.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadStatus]);
  React10.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    let running = false;
    const timer = window.setInterval(async () => {
      if (running || controller.signal.aborted || !mountedRef.current) return;
      running = true;
      await loadStatus({
        signal: controller.signal,
        silent: true,
        restoreProvisioning: false
      });
      running = false;
    }, 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React10.useEffect(() => {
    if (!provision || !ACTIVE_PROVISION_STATES.has(provision.status)) return void 0;
    const timer = window.setInterval(() => {
      if (mountedRef.current) setNow(Date.now());
    }, 1e3);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);
  const startProvisioning = React10.useCallback(async ({ replace = false } = {}) => {
    if (!mountedRef.current) return;
    setCredentialOpen(false);
    setCredentialError(null);
    setBusy(true);
    try {
      if (replace && provision?.attemptId) {
        await invoke(DINGTALK_ENDPOINTS.cancelProvisioning, {
          attemptId: provision.attemptId
        });
        if (!mountedRef.current) return;
      }
      setProvision({ status: "starting" });
      const started = normalizeProvisioning(await invoke(
        DINGTALK_ENDPOINTS.beginProvisioning,
        { locale: "zh-CN" }
      ));
      if (!mountedRef.current) return;
      if (!started.qrCodeDataUrl) {
        throw new Error("\u9489\u9489\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u5B89\u5168\u7684\u4E8C\u7EF4\u7801");
      }
      setNow(Date.now());
      setProvision({
        ...started,
        durationMs: Math.max(1, started.expiresAt - Date.now())
      });
      announce("\u9489\u9489\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u9489\u9489 App \u626B\u63CF\u3002");
    } catch (error) {
      if (!mountedRef.current) return;
      setProvision({
        attemptId: provision?.attemptId,
        status: "failed",
        error: presentError(error)
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);
  const bindCredentials = React10.useCallback(async ({ identity, secret }) => {
    if (!mountedRef.current) return;
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeSnapshot(await invoke(
        DINGTALK_ENDPOINTS.bindCredentials,
        { clientId: identity, clientSecret: secret }
      ));
      if (!mountedRef.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
        discardStaleFeedback(snapshot);
      }
      setCredentialOpen(false);
      announce("\u9489\u9489\u673A\u5668\u4EBA\u51ED\u636E\u5DF2\u7ED1\u5B9A\u3002");
    } catch (error) {
      if (mountedRef.current) setCredentialError(presentError(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, discardStaleFeedback, invoke, loadStatus, workspaceFence]);
  const cancelProvisioning = React10.useCallback(async () => {
    if (!mountedRef.current) return;
    setBusy(true);
    try {
      if (provision?.attemptId && !["failed", "expired", "cancelled"].includes(provision.status)) {
        await invoke(DINGTALK_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
        if (!mountedRef.current) return;
      }
      setProvision(null);
      announce("\u5DF2\u53D6\u6D88\u9489\u9489\u673A\u5668\u4EBA\u63A5\u5165\u3002");
      focusAddButton();
    } catch (error) {
      if (!mountedRef.current) return;
      setProvision((current) => ({ ...current, status: "failed", error: presentError(error) }));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [announce, focusAddButton, invoke, provision?.attemptId, provision?.status]);
  React10.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_PROVISION_STATES.has(provision.status)) return void 0;
    const controller = new AbortController();
    let disposed = false;
    let timer = null;
    const canCommit = () => !disposed && !controller.signal.aborted && mountedRef.current;
    const schedule = (delay) => {
      if (!canCommit()) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (canCommit()) void poll();
      }, delay);
    };
    const poll = async () => {
      try {
        const response = await invoke(
          DINGTALK_ENDPOINTS.pollProvisioning,
          { attemptId },
          controller.signal
        );
        if (!canCommit()) return;
        const result = normalizeProvisioning(response);
        if (result.status === "connected") {
          const snapshot = await loadStatus({
            signal: controller.signal,
            silent: true,
            restoreProvisioning: false
          });
          if (!canCommit()) return;
          const account = result.botId ? snapshot?.bots.find((bot) => bot.botId === result.botId) : snapshot?.bots.find((bot) => bot.connected);
          if (!account?.connected) {
            setProvision((current) => current?.attemptId === attemptId ? { ...current, ...result, status: "connecting" } : current);
            schedule(result.pollIntervalMs);
            return;
          }
          setProvision(null);
          announce(result.alreadyConnected ? "\u8FD9\u4E2A\u9489\u9489\u673A\u5668\u4EBA\u5DF2\u7ECF\u63A5\u5165\u5E76\u4FDD\u6301\u5728\u7EBF\u3002" : "\u9489\u9489\u673A\u5668\u4EBA\u5DF2\u63A5\u5165\uFF0C\u53EF\u4EE5\u5F00\u59CB\u53D1\u9001\u6D88\u606F\u3002");
          return;
        }
        if (!canCommit()) return;
        setProvision((current) => current?.attemptId === attemptId ? { ...current, ...result, durationMs: current.durationMs } : current);
        if (ACTIVE_PROVISION_STATES.has(result.status)) {
          schedule(result.pollIntervalMs);
        }
      } catch (error) {
        if (error?.name === "AbortError" || !canCommit()) return;
        setProvision((current) => current?.attemptId === attemptId ? { ...current, status: "failed", error: presentError(error) } : current);
      }
    };
    schedule(provision.pollIntervalMs ?? 3e3);
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
  }, [announce, invoke, loadStatus, provision?.attemptId, provision?.pollIntervalMs, provision?.status]);
  const setBotBusy = React10.useCallback((botId, operation) => {
    if (!mountedRef.current) return;
    setBusyByBot((current) => {
      const next = { ...current };
      if (operation) next[botId] = operation;
      else delete next[botId];
      return next;
    });
  }, []);
  const runBotAction = React10.useCallback(async ({ account, operation, endpoint, payload, success }) => {
    if (!mountedRef.current) return void 0;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, operation);
    if (operation === "reconnect") {
      setFeedbackByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
    try {
      const snapshot = normalizeSnapshot(await invoke(endpoint, payload));
      if (!mountedRef.current) return void 0;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
        discardStaleFeedback(snapshot);
      }
      const successMessage = typeof success === "function" ? success(snapshot) : success;
      if (operation === "reconnect") {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: {
            message: successMessage,
            clearWhenDisconnected: snapshot.testMessage?.sent === true
          }
        }));
      }
      announce(successMessage);
      return snapshot;
    } catch (error) {
      if (!mountedRef.current) return void 0;
      const failureMessage = operation === "reconnect" ? "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : `\u64CD\u4F5C\u5931\u8D25\uFF1A${presentError(error).message}`;
      if (operation === "reconnect") {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: { message: failureMessage, clearWhenDisconnected: false }
        }));
      }
      if (operation === "delete") {
        setRemoveErrorsByBot((current) => ({
          ...current,
          [account.botId]: {
            message: failureMessage,
            sequence: (current[account.botId]?.sequence ?? 0) + 1
          }
        }));
      } else {
        announce(failureMessage);
      }
      return void 0;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true, restoreProvisioning: false });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [announce, discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);
  const reconnect = React10.useCallback((account) => runBotAction({
    account,
    operation: "reconnect",
    endpoint: DINGTALK_ENDPOINTS.reconnectBot,
    payload: { botId: account.botId, sendTest: true },
    success: (snapshot) => {
      const refreshed = snapshot?.bots.find((bot) => bot.botId === account.botId);
      if (!refreshed?.connected) return "\u9489\u9489\u4ECD\u672A\u8FDE\u63A5\uFF0C\u63D2\u4EF6\u4F1A\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002";
      return connectionTestFeedback(snapshot.testMessage) ?? "\u9489\u9489\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002";
    }
  }), [runBotAction]);
  const saveWorkspace = React10.useCallback(async (account, workspace) => {
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "workspace");
    try {
      const snapshot = normalizeSnapshot(await invoke(
        DINGTALK_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
        discardStaleFeedback(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);
  const saveAgentPreset = React10.useCallback(async (account, agentPreset) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "preset");
    try {
      const snapshot = normalizeSnapshot(await invoke(
        DINGTALK_ENDPOINTS.setAgentPreset,
        { botId: account.botId, agentPreset }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
        discardStaleFeedback(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [discardStaleFeedback, invoke, loadStatus, setBotBusy, workspaceFence]);
  const remove = React10.useCallback(async (account) => {
    const snapshot = await runBotAction({
      account,
      operation: "delete",
      endpoint: DINGTALK_ENDPOINTS.deleteBot,
      payload: { botId: account.botId, confirm: true },
      success: "\u9489\u9489\u673A\u5668\u4EBA\u53CA\u672C\u673A\u51ED\u636E\u5DF2\u79FB\u9664\u3002"
    });
    if (snapshot && mountedRef.current) {
      setRemoveTarget(null);
      setRemoveErrorsByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
  }, [runBotAction]);
  let provisionView = null;
  if (provision?.status === "starting") {
    provisionView = h(
      "div",
      { className: "ddt-card ddt-loading", "aria-busy": "true" },
      h("div", { className: "ddt-spinner" }),
      h("span", null, "\u6B63\u5728\u7533\u8BF7\u9489\u9489\u6388\u6743\u4E8C\u7EF4\u7801\u2026")
    );
  } else if (provision?.status === "pending") {
    provisionView = h(QrPanel, {
      provision,
      now,
      busy,
      onRefresh: () => void startProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning()
    });
  } else if (["scanned", "authorizing", "creating", "connecting"].includes(provision?.status)) {
    provisionView = h(ProgressPanel, {
      status: provision.status,
      busy,
      onCancel: () => void cancelProvisioning()
    });
  } else if (provision && ["failed", "expired", "cancelled"].includes(provision.status)) {
    provisionView = h(ProvisionError, {
      provision,
      busy,
      onRetry: () => void startProvisioning({ replace: Boolean(provision.attemptId) }),
      onClose: () => void cancelProvisioning()
    });
  }
  const credentialView = credentialOpen ? h(CredentialBindingPanel, {
    channel: "\u9489\u9489",
    identityLabel: "Client ID",
    identityPlaceholder: "\u586B\u5199\u9489\u9489\u5E94\u7528 Client ID",
    secretLabel: "Client Secret",
    secretPlaceholder: "\u586B\u5199\u9489\u9489\u5E94\u7528 Client Secret",
    busy,
    error: credentialError,
    onSubmit: bindCredentials,
    onCancel: () => {
      setCredentialOpen(false);
      setCredentialError(null);
    }
  }) : null;
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    { className: "ddt-page dim-channelPage", "aria-label": "\u9489\u9489\u8BBE\u7F6E" },
    h(Heading, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      onCredential: () => {
        setCredentialOpen((value) => !value);
        setCredentialError(null);
      },
      credentialOpen,
      addButtonRef
    }),
    notice ? h(FeedbackToast, { text: notice }) : null,
    Object.entries(removeErrorsByBot).map(([botId, failure]) => botId !== removeTarget ? h(FeedbackToast, { key: botId, text: failure.message, tone: "error", sequence: failure.sequence }) : null),
    model.error && model.phase === "ready" ? h(FeedbackToast, { text: `\u72B6\u6001\u5237\u65B0\u5931\u8D25\uFF1A${model.error.message}`, tone: "error" }) : null,
    model.phase === "loading" ? h(LoadingView) : model.phase === "error" ? h(
      "div",
      { className: "ddt-card dim-surfaceCard" },
      h(
        "div",
        { className: "ddt-inlineError dim-inlineError", role: "alert" },
        h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6\u9489\u9489\u673A\u5668\u4EBA\u72B6\u6001"),
        h("p", null, model.error?.message ?? "\u8BF7\u7A0D\u540E\u91CD\u8BD5"),
        h(Button, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6")
      )
    ) : h(
      React10.Fragment,
      null,
      credentialView,
      provisionView,
      model.bots.length === 0 && !provision && !credentialOpen ? h(EmptyView, { busy, onStart: () => void startProvisioning() }) : null,
      model.bots.length > 0 ? h(AccountList, {
        bots: model.bots,
        busyByBot,
        feedbackByBot,
        removeTarget,
        removeErrorsByBot,
        onReconnect: (account) => void reconnect(account),
        onWorkspaceSave: saveWorkspace,
        onAgentPresetSave: saveAgentPreset,
        onRequestRemove: (account) => setRemoveTarget(account.botId),
        onConfirmRemove: (account) => void remove(account),
        onCancelRemove: () => setRemoveTarget(null)
      }) : null
    )
  ));
}

// plugin-src/client/channels/shared/token-api.js
var ACCOUNT_STATES2 = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text2(value, fallback, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}
function id(value) {
  const result = text2(value, "", 128);
  return /^[a-z\d_-]+$/i.test(result) ? result : void 0;
}
function timestamp2(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? void 0 : parsed;
}
var TOKEN_BOT_ENDPOINTS = Object.freeze({
  status: "connection.status",
  bindCredentials: "bot.bind-credentials",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
function createTokenChannelApi(channel4, connectionSummary, {
  normalizeBotExtension = () => ({})
} = {}) {
  const unwrapRpcResult10 = (result) => {
    if (!isRecord2(result) || typeof result.ok !== "boolean") {
      throw new Error(`${channel4} \u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94`);
    }
    if (!result.ok) {
      const error = new Error(text2(result.error?.message, `${channel4} \u64CD\u4F5C\u5931\u8D25`));
      error.code = text2(result.error?.code, `${channel4.toUpperCase()}_RPC_ERROR`, 80);
      throw error;
    }
    return result.value;
  };
  const normalizeBot7 = (value) => {
    if (!isRecord2(value) || !id(value.botId)) return void 0;
    const connected = value.connected === true;
    const state = ACCOUNT_STATES2.has(value.state) ? value.state : "offline";
    const extension = normalizeBotExtension(value);
    return {
      botId: id(value.botId),
      connected,
      state: connected ? "connected" : state,
      workspace: text2(value.workspace, "", 4096),
      agentPreset: normalizeAgentPresetId(value.agentPreset),
      bot: {
        name: text2(value.bot?.name, `${channel4}\u673A\u5668\u4EBA`, 100),
        username: text2(value.bot?.username, "", 100),
        idMasked: text2(value.bot?.idMasked, "\u673A\u5668\u4EBA\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58", 140)
      },
      health: {
        summary: text2(
          value.health?.summary,
          connected ? `${channel4}${connectionSummary}\u8FD0\u884C\u6B63\u5E38` : `${channel4}\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA`
        ),
        lastCheckedAt: timestamp2(value.health?.lastCheckedAt)
      },
      lastMessageError: normalizeLastMessageError(value.lastMessageError),
      error: isRecord2(value.error) ? {
        code: text2(value.error.code, `${channel4.toUpperCase()}_ACCOUNT_ERROR`, 80),
        message: text2(value.error.message, `${channel4}\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA`)
      } : null,
      ...isRecord2(extension) ? extension : {}
    };
  };
  const normalizeSnapshot9 = (value) => {
    const source = isRecord2(value?.snapshot) ? value.snapshot : value;
    if (!isRecord2(source) || !Array.isArray(source.bots)) {
      throw new Error(`${channel4} \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868`);
    }
    const bots = source.bots.map(normalizeBot7).filter(Boolean);
    return {
      revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
      bots,
      totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
      agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog)
    };
  };
  const presentError10 = (error) => ({
    code: text2(error?.code, `${channel4.toUpperCase()}_ERROR`, 80),
    message: text2(error?.message, `${channel4}\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5`)
  });
  return Object.freeze({ unwrapRpcResult: unwrapRpcResult10, normalizeSnapshot: normalizeSnapshot9, presentError: presentError10 });
}

// plugin-src/client/channels/discord/api.js
var DISCORD_RPC_CHANNEL = "/discord";
var DISCORD_ENDPOINTS = TOKEN_BOT_ENDPOINTS;
var api = createTokenChannelApi("Discord", " Gateway \u957F\u8FDE\u63A5");
var unwrapRpcResult2 = api.unwrapRpcResult;
var normalizeSnapshot2 = api.normalizeSnapshot;
var presentError2 = api.presentError;

// plugin-src/client/channels/shared/token-channel.js
var React11 = __toESM(require("react"), 1);
var Button3 = React11.forwardRef(function Button4({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `ddt-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function checkedTime2(value) {
  if (!value) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "\u521A\u521A";
  }
}
function connectionTestNotice(value) {
  if (value?.testMessage?.sent === true) return "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230\u5BF9\u5E94\u673A\u5668\u4EBA\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002";
  if (value?.testMessage?.code === "test-target-unavailable") {
    return "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
  }
  return value?.testMessage ? "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002" : null;
}
function createTokenChannelSettings(definition) {
  const {
    channel: channel4,
    endpoints,
    api: api4,
    LogoGlyph,
    installStyles,
    pageClass,
    avatarClass,
    connectionLabel,
    tokenPlaceholder,
    emptyTitle,
    emptyDescription,
    platformLabel,
    CredentialPanel = null,
    credentialPayload = ({ secret }) => ({ token: secret }),
    credentialAriaLabel = `\u4F7F\u7528 Bot Token \u63A5\u5165 ${channel4} \u673A\u5668\u4EBA`,
    credentialOpenLabel = "\u624B\u52A8\u63A5\u5165",
    credentialCloseLabel = "\u6536\u8D77\u51ED\u636E",
    credentialNoun = "Bot Token",
    emptyActionLabel = "\u586B\u5199 Bot Token",
    AccountSettings = null,
    accountSettingsEndpoint = null
  } = definition;
  function AccountCard5({ account, busy, testNotice, testNoticeSequence, removeError, removeErrorSequence, removing, onReconnect, onWorkspaceSave, onAgentPresetSave, onAccountSettingsSave, onRequestRemove, onConfirmRemove, onCancelRemove }) {
    const state = busy === "reconnect" ? "connecting" : account.state;
    const tone = account.connected ? "success" : state === "error" ? "error" : "warning";
    const stateLabel2 = account.connected ? "\u8FD0\u884C\u6B63\u5E38" : state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA";
    const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
    const identity = account.bot.username ? `@${account.bot.username}` : account.bot.idMasked;
    return h(
      "article",
      { className: "ddt-card dim-botCard", "data-bot-id": account.botId },
      h(
        "div",
        { className: "ddt-cardBody dim-botCardBody" },
        h(
          "div",
          { className: "ddt-accountTop dim-botCardTop" },
          h(
            "div",
            { className: "ddt-accountIdentity dim-botIdentity" },
            h(
              "div",
              { className: `ddt-avatar dim-botAvatar ${avatarClass}`, "aria-hidden": "true" },
              h(LogoGlyph, { size: 29 })
            ),
            h(
              "div",
              { className: "dim-botName" },
              h("h3", null, account.bot.name),
              h("p", null, identity)
            )
          ),
          h(BotStatusMeta, {
            className: "ddt-health",
            dotClassName: "ddt-dot",
            tone,
            stateLabel: stateLabel2,
            lastCheckedAt: account.health.lastCheckedAt,
            formatCheckedTime: checkedTime2
          })
        ),
        h(WorkspaceEditor, {
          workspace: account.workspace,
          disabled: Boolean(busy),
          onSave: onWorkspaceSave
        }),
        h(AgentPresetEditor, {
          agentPreset: account.agentPreset,
          disabled: Boolean(busy),
          onSave: onAgentPresetSave
        }),
        AccountSettings ? h(AccountSettings, {
          account,
          busy: Boolean(busy),
          onSave: onAccountSettingsSave
        }) : null,
        h(
          "div",
          { className: "ddt-accountFooter dim-cardFooter" },
          h(
            "div",
            { className: "dim-cardFooterLayout" },
            h(
              "div",
              { className: "ddt-actions dim-cardActions" },
              h(Button3, {
                className: "dim-cardAction",
                onClick: onReconnect,
                disabled: Boolean(busy),
                loading: busy === "reconnect"
              }, account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
              h(Button3, {
                className: "dim-cardAction",
                kind: "danger",
                onClick: onRequestRemove,
                disabled: Boolean(busy)
              }, "\u79FB\u9664\u63A5\u5165")
            ),
            summary ? h("div", { className: "ddt-summary dim-cardSummary" }, summary) : null,
            account.lastMessageError ? h(LastMessageErrorSummary, {
              className: "ddt-summary",
              error: account.lastMessageError
            }) : null,
            testNotice ? h(FeedbackToast, { text: testNotice, sequence: testNoticeSequence }) : null
          )
        )
      ),
      removing ? h(
        ConfirmDialog,
        { className: "ddt-confirm dim-confirm", role: "alertdialog", onClose: onCancelRemove, busy: Boolean(busy), error: removeError, feedbackSequence: removeErrorSequence },
        h("strong", null, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${account.bot.name}\u201D\uFF1F`),
        h("p", null, `\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 ${credentialNoun}\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002${platformLabel}\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002`),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(Button3, { onClick: onCancelRemove, disabled: Boolean(busy) }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
          h(
            Button3,
            { kind: "danger", onClick: onConfirmRemove, disabled: Boolean(busy), loading: busy === "delete" },
            "\u786E\u8BA4\u79FB\u9664\u63A5\u5165"
          )
        )
      ) : null
    );
  }
  function SettingsTab({ rpcCall }) {
    const [model, setModel] = React11.useState({
      phase: "loading",
      bots: [],
      totals: { configured: 0, connected: 0 },
      error: null,
      agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
    });
    const [credentialOpen, setCredentialOpen] = React11.useState(false);
    const [credentialError, setCredentialError] = React11.useState(null);
    const [busy, setBusy] = React11.useState(false);
    const [busyByBot, setBusyByBot] = React11.useState({});
    const [testNoticeByBot, setTestNoticeByBot] = React11.useState({});
    const [testNoticeSequenceByBot, setTestNoticeSequenceByBot] = React11.useState({});
    const [removeTarget, setRemoveTarget] = React11.useState(null);
    const [actionError, setActionError] = React11.useState(null);
    const [actionErrorSequence, setActionErrorSequence] = React11.useState(0);
    const mounted = React11.useRef(true);
    const workspaceFence = useWorkspaceSnapshotFence();
    React11.useEffect(() => {
      const disposeDingtalk = installDingtalkStyles();
      const disposeChannel = installStyles();
      mounted.current = true;
      return () => {
        mounted.current = false;
        disposeChannel();
        disposeDingtalk();
      };
    }, []);
    const invoke = React11.useCallback(async (endpoint, payload = {}, signal) => {
      if (typeof rpcCall !== "function") throw new TypeError(`${channel4} \u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5`);
      return api4.unwrapRpcResult(await rpcCall(endpoint, payload, signal));
    }, [rpcCall]);
    const loadStatus = React11.useCallback(async ({ signal, silent = false } = {}) => {
      const workspaceVersion = workspaceFence.beginStatus();
      if (workspaceVersion === null) return;
      if (!silent && mounted.current) setModel((current) => ({ ...current, phase: "loading", error: null }));
      try {
        const snapshot = api4.normalizeSnapshot(await invoke(endpoints.status, {}, signal));
        if (!mounted.current || signal?.aborted || !workspaceFence.canCommitStatus(workspaceVersion)) return;
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      } catch (error) {
        if (error?.name !== "AbortError" && mounted.current && !signal?.aborted && workspaceFence.canCommitStatus(workspaceVersion)) {
          setModel((current) => ({
            ...current,
            phase: silent ? current.phase : "error",
            error: api4.presentError(error)
          }));
        }
      }
    }, [invoke, workspaceFence]);
    React11.useEffect(() => {
      const controller = new AbortController();
      void loadStatus({ signal: controller.signal });
      return () => controller.abort();
    }, [loadStatus]);
    React11.useEffect(() => {
      if (model.phase !== "ready") return void 0;
      const controller = new AbortController();
      const timer = window.setInterval(
        () => void loadStatus({ signal: controller.signal, silent: true }),
        15e3
      );
      return () => {
        controller.abort();
        window.clearInterval(timer);
      };
    }, [loadStatus, model.phase]);
    const bindCredentials = React11.useCallback(async (values) => {
      const snapshotVersion = workspaceFence.beginMutation();
      setBusy(true);
      setCredentialError(null);
      try {
        const snapshot = api4.normalizeSnapshot(await invoke(
          endpoints.bindCredentials,
          credentialPayload(values)
        ));
        if (!mounted.current) return;
        if (workspaceFence.canCommitMutation(snapshotVersion)) {
          setModel({
            phase: "ready",
            bots: snapshot.bots,
            totals: snapshot.totals,
            error: null,
            agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
          });
        }
        setCredentialOpen(false);
      } catch (error) {
        if (mounted.current) setCredentialError(api4.presentError(error));
      } finally {
        const shouldRefresh = workspaceFence.endMutation();
        if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
        if (mounted.current) setBusy(false);
      }
    }, [invoke, loadStatus, workspaceFence]);
    const botAction = React11.useCallback(async (account, operation, endpoint, payload) => {
      const snapshotVersion = workspaceFence.beginMutation();
      setBusyByBot((current) => ({ ...current, [account.botId]: operation }));
      try {
        const value = await invoke(endpoint, payload);
        const snapshot = api4.normalizeSnapshot(value);
        if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
          setModel({
            phase: "ready",
            bots: snapshot.bots,
            totals: snapshot.totals,
            error: null,
            agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
          });
        }
        if (mounted.current && operation === "reconnect") {
          setTestNoticeByBot((current) => ({
            ...current,
            [account.botId]: connectionTestNotice(value)
          }));
        }
      } catch (error) {
        if (operation !== "reconnect") throw error;
        if (mounted.current) {
          setTestNoticeByBot((current) => ({
            ...current,
            [account.botId]: "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
          }));
        }
      } finally {
        if (mounted.current && operation === "reconnect") {
          setTestNoticeSequenceByBot((current) => ({ ...current, [account.botId]: (current[account.botId] ?? 0) + 1 }));
        }
        const shouldRefresh = workspaceFence.endMutation();
        if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
        if (mounted.current) setBusyByBot((current) => {
          const next = { ...current };
          delete next[account.botId];
          return next;
        });
      }
    }, [invoke, loadStatus, workspaceFence]);
    const botList = model.bots.length > 0 ? h(
      "section",
      { className: "dim-listSection" },
      h(ChannelListHeading, {
        className: "ddt-listHeading",
        title: `\u5DF2\u63A5\u5165\u7684 ${channel4} \u673A\u5668\u4EBA`,
        connectionLabel
      }),
      h("ul", { className: "ddt-list dim-botList" }, model.bots.map((account) => h("li", { key: account.botId }, h(AccountCard5, {
        account,
        busy: busyByBot[account.botId],
        testNotice: testNoticeByBot[account.botId],
        testNoticeSequence: testNoticeSequenceByBot[account.botId],
        removeError: removeTarget === account.botId ? actionError : null,
        removeErrorSequence: actionErrorSequence,
        removing: removeTarget === account.botId,
        onReconnect: () => void botAction(
          account,
          "reconnect",
          endpoints.reconnectBot,
          { botId: account.botId, sendTest: true }
        ),
        onWorkspaceSave: (workspace) => botAction(
          account,
          "workspace",
          endpoints.setWorkspace,
          { botId: account.botId, workspace }
        ),
        onAgentPresetSave: (agentPreset) => botAction(
          account,
          "preset",
          endpoints.setAgentPreset,
          { botId: account.botId, agentPreset }
        ),
        onAccountSettingsSave: AccountSettings && accountSettingsEndpoint ? (payload) => botAction(
          account,
          "settings",
          accountSettingsEndpoint,
          { botId: account.botId, ...payload }
        ) : void 0,
        onRequestRemove: () => setRemoveTarget(account.botId),
        onCancelRemove: () => setRemoveTarget(null),
        onConfirmRemove: async () => {
          try {
            await botAction(account, "delete", endpoints.deleteBot, {
              botId: account.botId,
              confirm: true
            });
            if (mounted.current) {
              setRemoveTarget(null);
              setActionError(null);
            }
          } catch (cause) {
            setActionError(cause?.message ?? "\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
            setActionErrorSequence((value) => value + 1);
          }
        }
      }))))
    ) : null;
    return h(AgentPresetCatalogContext.Provider, {
      value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
    }, h(
      "section",
      {
        className: `ddt-page ${pageClass} dim-channelPage`,
        "aria-label": `${channel4} \u8BBE\u7F6E`
      },
      actionError && !removeTarget ? h(FeedbackToast, { text: actionError, tone: "error", sequence: actionErrorSequence }) : null,
      h(
        "div",
        { className: "ddt-heading" },
        h(
          "div",
          { className: "ddt-tools" },
          h(
            "div",
            { className: "dim-bindActions" },
            h(Button3, {
              kind: "credential",
              className: "dim-credentialButton",
              onClick: () => {
                setCredentialOpen((value) => !value);
                setCredentialError(null);
              },
              disabled: busy,
              "aria-pressed": credentialOpen,
              "aria-label": credentialAriaLabel
            }, h(CredentialActionIcon), credentialOpen ? credentialCloseLabel : credentialOpenLabel)
          ),
          model.totals.configured > 0 ? h(
            "div",
            { className: "ddt-badge dim-onlineBadge" },
            h("span", null, `${model.totals.connected} / ${model.totals.configured} \u5728\u7EBF`)
          ) : null
        )
      ),
      model.phase === "loading" ? h("div", {
        className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView",
        "aria-busy": "true"
      }, h("div", { className: "ddt-spinner dim-spinner" }), `\u6B63\u5728\u8BFB\u53D6 ${channel4} \u673A\u5668\u4EBA\u72B6\u6001\u2026`) : model.phase === "error" ? h(
        "div",
        { className: "ddt-card dim-surfaceCard" },
        h(
          "div",
          { className: "ddt-inlineError dim-inlineError" },
          h("h3", null, `\u65E0\u6CD5\u8BFB\u53D6 ${channel4} \u673A\u5668\u4EBA\u72B6\u6001`),
          h("p", null, model.error?.message),
          h(Button3, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6")
        )
      ) : h(
        React11.Fragment,
        null,
        credentialOpen ? CredentialPanel ? h(CredentialPanel, {
          busy,
          error: credentialError,
          onSubmit: bindCredentials,
          onCancel: () => {
            setCredentialOpen(false);
            setCredentialError(null);
          }
        }) : h(CredentialBindingPanel, {
          channel: channel4,
          secretLabel: "Bot Token",
          secretPlaceholder: tokenPlaceholder,
          busy,
          error: credentialError,
          onSubmit: bindCredentials,
          onCancel: () => {
            setCredentialOpen(false);
            setCredentialError(null);
          }
        }) : null,
        model.bots.length === 0 && !credentialOpen ? h(
          "div",
          { className: "ddt-card dim-surfaceCard" },
          h(
            "div",
            { className: "ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView" },
            h(
              "div",
              { className: "dim-emptyCopy" },
              h(
                "div",
                { className: "ddt-stateLabel dim-stateLabel" },
                h("span", { className: "ddt-dot dim-stateDot" }),
                h("span", null, `\u5C1A\u672A\u63A5\u5165 ${channel4} \u673A\u5668\u4EBA`)
              ),
              h("h3", null, emptyTitle),
              h("p", null, emptyDescription),
              h(
                "div",
                { className: "ddt-actions dim-viewActions" },
                h(Button3, {
                  kind: "primary",
                  onClick: () => setCredentialOpen(true)
                }, emptyActionLabel)
              )
            ),
            h("div", {
              className: `ddt-brandMark dim-emptyBrand ${avatarClass}`,
              "aria-hidden": "true"
            }, h(LogoGlyph, { size: 64 }))
          )
        ) : null,
        botList
      )
    ));
  }
  return { SettingsTab, AccountCard: AccountCard5 };
}

// plugin-src/client/channels/discord/styles.js
var DISCORD_STYLE_ID = "xmanrui-dsh-im-discord-settings";
var CSS2 = String.raw`
.ddc-page { --ddt-accent: #5865f2; --ddt-accent-deep: #4752c4; --ddt-accent-wash: #eef0ff; }
.ddc-avatar { color: #fff; background: #5865f2; }
.ddc-avatar svg { display: block; }
`;
function installDiscordStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${DISCORD_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = DISCORD_STYLE_ID;
  style.textContent = CSS2;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/discord/index.js
var channel = createTokenChannelSettings({
  channel: "Discord",
  endpoints: DISCORD_ENDPOINTS,
  api,
  LogoGlyph: DiscordLogoGlyph,
  installStyles: installDiscordStyles,
  pageClass: "ddc-page",
  avatarClass: "ddc-avatar",
  connectionLabel: "Gateway \u957F\u8FDE\u63A5",
  tokenPlaceholder: "\u586B\u5199 Discord Developer Portal \u7684 Bot Token",
  emptyTitle: "\u63A5\u5165 Discord \u673A\u5668\u4EBA",
  emptyDescription: "\u5148\u5728 Developer Portal \u521B\u5EFA Bot \u5E76\u9080\u8BF7\u5230\u670D\u52A1\u5668\uFF0C\u518D\u5728\u8FD9\u91CC\u5B8C\u6210\u63A5\u5165\u3002",
  platformLabel: "Discord Developer Portal"
});
var DiscordSettingsTab = channel.SettingsTab;
var DiscordAccountCard = channel.AccountCard;

// plugin-src/client/channels/feishu/index.js
var React13 = __toESM(require("react"), 1);

// src/channels/feishu/rpc-protocol.mjs
var FEISHU_RPC_CHANNEL = "/feishu";
var FEISHU_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  beginCallbackRepair: "bot.callback-repair.begin",
  beginGroupMessagePermission: "bot.group-message-permission.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  bindCredentials: "bot.bind-credentials",
  reconnectBot: "bot.reconnect",
  disconnectBot: "bot.disconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: "bot.preset.set",
  setGroupResponseMode: "bot.group-response-mode.set",
  // Kept for rolling upgrades. The multi-bot UI never calls these endpoints.
  testConnection: "connection.test",
  disconnect: "connection.disconnect"
});

// plugin-src/client/channels/feishu/api.js
var FEISHU_REGISTRATION_OPERATIONS = Object.freeze({
  PROVISION: "provision",
  CALLBACK_REPAIR: "callback_repair",
  GROUP_MESSAGE_PERMISSION: "group_message_permission"
});
var CONNECTION_STATES = /* @__PURE__ */ new Set([
  "disconnected",
  "offline",
  "provisioning",
  "connecting",
  "reconnecting",
  "connected",
  "error"
]);
var POLL_STATES = /* @__PURE__ */ new Set([
  "pending",
  "scanned",
  "connecting",
  "connected",
  "expired",
  "failed"
]);
function isRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function optionalString2(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
function optionalTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? void 0 : parsed;
  }
  return void 0;
}
function normalizeGroupResponseMode(value) {
  return value === "all" ? "all" : "mention";
}
function clamp2(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function normalizeRegistrationOperation(value) {
  if (value === FEISHU_REGISTRATION_OPERATIONS.CALLBACK_REPAIR) {
    return FEISHU_REGISTRATION_OPERATIONS.CALLBACK_REPAIR;
  }
  if (value === FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION) {
    return FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION;
  }
  return FEISHU_REGISTRATION_OPERATIONS.PROVISION;
}
function isTargetedAppUpdate(operation) {
  return operation === FEISHU_REGISTRATION_OPERATIONS.CALLBACK_REPAIR || operation === FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION;
}
function unwrapRpcResult3(result) {
  if (!isRecord3(result) || typeof result.ok !== "boolean") {
    throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const message = optionalString2(result.error?.message) ?? "\u98DE\u4E66\u670D\u52A1\u8BF7\u6C42\u5931\u8D25";
    const error = new Error(message);
    error.code = optionalString2(result.error?.code) ?? "FEISHU_RPC_ERROR";
    throw error;
  }
  return result.value;
}
function normalizeProvisioning2(value, now = Date.now()) {
  const source = isRecord3(value?.provisioning) ? value.provisioning : value;
  if (!isRecord3(source)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u4E8C\u7EF4\u7801\u4FE1\u606F");
  const attemptId = optionalString2(source.attemptId) ?? optionalString2(source.provisioningId);
  const verificationUrl = optionalString2(source.verificationUrl);
  const qrCodeDataUrl = optionalString2(source.qrCodeDataUrl);
  const submitted = source.submitted === true;
  if (!attemptId || !verificationUrl && !qrCodeDataUrl && !submitted) {
    throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u4E8C\u7EF4\u7801\u4FE1\u606F\u4E0D\u5B8C\u6574");
  }
  const explicitExpiry = optionalTimestamp(source.expiresAt);
  const expireIn = clamp2(source.expireIn, 1, 60 * 60, 5 * 60);
  const operation = normalizeRegistrationOperation(source.operation);
  const botId = optionalString2(source.botId);
  if (isTargetedAppUpdate(operation) && !botId) {
    throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u5E94\u7528\u66F4\u65B0\u4FE1\u606F\u7F3A\u5C11 botId");
  }
  return {
    attemptId,
    operation,
    botId,
    verificationUrl,
    qrCodeDataUrl,
    submitted,
    expiresAt: explicitExpiry ?? now + expireIn * 1e3,
    pollIntervalMs: clamp2(source.pollIntervalMs, 800, 1e4, 1800)
  };
}
function normalizeBot2(value) {
  const source = isRecord3(value) ? value : {};
  return {
    name: optionalString2(source.name) ?? "\u98DE\u4E66\u673A\u5668\u4EBA",
    avatarUrl: optionalString2(source.avatarUrl),
    appIdMasked: optionalString2(source.appIdMasked),
    tenantName: optionalString2(source.tenantName),
    domain: source.domain === "lark" ? "lark" : "feishu",
    activated: typeof source.activated === "boolean" || typeof source.activated === "number" ? source.activated : void 0
  };
}
function normalizeHealth(value, connected = false) {
  const source = isRecord3(value) ? value : {};
  const fallbackStatus = connected ? "healthy" : "offline";
  const status = ["healthy", "degraded", "offline", "checking"].includes(source.status) ? source.status : fallbackStatus;
  return {
    status,
    summary: optionalString2(source.summary) ?? (connected ? "\u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38" : "\u673A\u5668\u4EBA\u5C1A\u672A\u8FDE\u63A5"),
    lastCheckedAt: optionalTimestamp(source.lastCheckedAt),
    lastConnectedAt: optionalTimestamp(source.lastConnectedAt)
  };
}
function normalizeError2(value) {
  if (!isRecord3(value)) return void 0;
  const message = optionalString2(value.message);
  if (!message) return void 0;
  return { message, code: optionalString2(value.code) };
}
function authoritativeState(value, connected) {
  if (connected) return "connected";
  const reported = CONNECTION_STATES.has(value) ? value : "disconnected";
  if (reported === "connected" || reported === "connecting" || reported === "reconnecting") {
    return "connecting";
  }
  if (reported === "error") return "error";
  return "offline";
}
function normalizeBotConnection(value, fallbackBotId) {
  if (!isRecord3(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u673A\u5668\u4EBA\u72B6\u6001");
  const botId = optionalString2(value.botId) ?? optionalString2(fallbackBotId);
  if (!botId) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u7684\u673A\u5668\u4EBA\u7F3A\u5C11 botId");
  const connected = value.connected === true;
  return {
    botId,
    state: authoritativeState(value.state, connected),
    connected,
    configured: value.configured !== false,
    workspace: optionalString2(value.workspace)?.slice(0, 4096) ?? "",
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    groupResponseMode: normalizeGroupResponseMode(value.groupResponseMode),
    groupMessagePermissionGranted: value.groupMessagePermissionGranted === true,
    bot: normalizeBot2(value.bot),
    health: normalizeHealth(value.health, connected),
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: normalizeError2(value.error)
  };
}
function normalizeBotsSnapshot(value) {
  if (!isRecord3(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u8FDE\u63A5\u72B6\u6001");
  let sourceBots = Array.isArray(value.bots) ? value.bots : [];
  if (sourceBots.length === 0 && value.configured === true) {
    sourceBots = [{
      botId: optionalString2(value.botId) ?? "legacy-default",
      state: value.state,
      connected: value.connected,
      configured: true,
      bot: value.bot,
      health: value.health,
      lastMessageError: value.lastMessageError,
      error: value.error
    }];
  }
  const seen = /* @__PURE__ */ new Set();
  const bots = [];
  for (const source of sourceBots) {
    const bot = normalizeBotConnection(source);
    if (seen.has(bot.botId)) continue;
    seen.add(bot.botId);
    bots.push(bot);
  }
  const configured = bots.filter((bot) => bot.configured).length;
  const connected = bots.filter((bot) => bot.connected).length;
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0;
  const state = CONNECTION_STATES.has(value.state) ? value.state : "disconnected";
  return {
    schemaVersion: value.schemaVersion === 2 ? 2 : 1,
    revision,
    state,
    bots,
    // Derive counts from the authoritative list so stale summary fields never
    // make the UI claim that an unavailable bot is online.
    totals: { configured, connected },
    provisioning: value.provisioning ? normalizeProvisioning2(value.provisioning) : void 0,
    error: normalizeError2(value.error),
    agentPresetCatalog: normalizeAgentPresetCatalog(value.agentPresetCatalog)
  };
}
function normalizeConnectionSnapshot(value) {
  if (!isRecord3(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u8FDE\u63A5\u72B6\u6001");
  const connected = value.connected === true;
  const reportedState = CONNECTION_STATES.has(value.state) ? value.state : "disconnected";
  const state = connected ? "connected" : reportedState === "connected" ? "connecting" : reportedState;
  const snapshot = {
    state,
    configured: value.configured === true,
    bot: normalizeBot2(value.bot),
    health: normalizeHealth(value.health, connected),
    provisioning: void 0,
    errorMessage: optionalString2(value.error?.message) ?? optionalString2(value.message)
  };
  if (value.provisioning) snapshot.provisioning = normalizeProvisioning2(value.provisioning);
  return snapshot;
}
function normalizePollResult(value) {
  if (!isRecord3(value)) throw new Error("\u98DE\u4E66\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u521B\u5EFA\u8FDB\u5EA6");
  const status = POLL_STATES.has(value.status) ? value.status : POLL_STATES.has(value.state) ? value.state : void 0;
  if (!status) throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u672A\u77E5\u7684\u521B\u5EFA\u72B6\u6001");
  const normalized = {
    status,
    operation: normalizeRegistrationOperation(value.operation),
    botId: optionalString2(value.botId),
    message: optionalString2(value.error?.message) ?? optionalString2(value.message),
    connection: void 0,
    provisioning: void 0
  };
  if (value.provisioning) normalized.provisioning = normalizeProvisioning2(value.provisioning);
  if (status === "connected" && isRecord3(value.connection)) {
    normalized.connection = value.connection.botId ? normalizeBotConnection(value.connection) : normalizeConnectionSnapshot(value.connection);
  }
  return normalized;
}
function presentError3(error) {
  const raw = optionalString2(error?.message) ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  const message = raw.replace(/(client[_-]?secret|app[_-]?secret|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=\u2022\u2022\u2022\u2022\u2022\u2022").slice(0, 240);
  return { message, code: optionalString2(error?.code) };
}
function formatRemaining2(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1e3));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// plugin-src/client/lifecycle.js
var React12 = __toESM(require("react"), 1);
function createPollScheduler({ setTimeoutFn, clearTimeoutFn }) {
  let disposed = false;
  let timer;
  return {
    get disposed() {
      return disposed;
    },
    schedule(callback, delayMs) {
      if (disposed) return false;
      if (timer !== void 0) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => {
        timer = void 0;
        if (!disposed) void callback();
      }, delayMs);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== void 0) clearTimeoutFn(timer);
      timer = void 0;
    }
  };
}
function createAnimationFrameScheduler({ requestFrame, cancelFrame }) {
  let disposed = false;
  const frames = /* @__PURE__ */ new Set();
  const keyedFrames = /* @__PURE__ */ new Map();
  return {
    schedule(callback, key) {
      if (disposed) return false;
      const previous = key === void 0 ? void 0 : keyedFrames.get(key);
      if (previous !== void 0) {
        keyedFrames.delete(key);
        frames.delete(previous);
        cancelFrame(previous);
      }
      let frame;
      let completed = false;
      frame = requestFrame(() => {
        completed = true;
        if (frame !== void 0) frames.delete(frame);
        if (key !== void 0 && keyedFrames.get(key) === frame) keyedFrames.delete(key);
        if (!disposed) callback();
      });
      if (!completed) {
        frames.add(frame);
        if (key !== void 0) keyedFrames.set(key, frame);
      }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const frame of frames) cancelFrame(frame);
      frames.clear();
      keyedFrames.clear();
    }
  };
}
function useAnimationFrameScheduler() {
  const schedulerRef = React12.useRef(null);
  React12.useEffect(() => {
    const scheduler = createAnimationFrameScheduler({
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (frame) => window.cancelAnimationFrame(frame)
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, []);
  return React12.useCallback(
    (callback, key) => schedulerRef.current?.schedule(callback, key) ?? false,
    []
  );
}

// plugin-src/client/channels/feishu/index.js
var CALLBACK_REPAIR_OPERATION = FEISHU_REGISTRATION_OPERATIONS.CALLBACK_REPAIR;
var GROUP_MESSAGE_PERMISSION_OPERATION = FEISHU_REGISTRATION_OPERATIONS.GROUP_MESSAGE_PERMISSION;
function isCallbackRepair(value) {
  return value?.operation === CALLBACK_REPAIR_OPERATION;
}
function isGroupMessagePermission(value) {
  return value?.operation === GROUP_MESSAGE_PERMISSION_OPERATION;
}
function isTargetedAppUpdate2(value) {
  return isCallbackRepair(value) || isGroupMessagePermission(value);
}
function SvgIcon({ children, size = 18, className, viewBox = "0 0 24 24" }) {
  return h("svg", {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
    focusable: "false",
    className
  }, children);
}
function RobotIcon({ size = 26 }) {
  return h(
    SvgIcon,
    { size },
    h("rect", {
      x: "5",
      y: "7.5",
      width: "14",
      height: "11",
      rx: "4",
      stroke: "currentColor",
      strokeWidth: "1.7"
    }),
    h("path", {
      d: "M12 4.5v3M8.7 12h.01M15.3 12h.01M9.2 15.3c1.67 1.08 3.93 1.08 5.6 0M3.5 11.5v3M20.5 11.5v3",
      stroke: "currentColor",
      strokeWidth: "1.7",
      strokeLinecap: "round"
    })
  );
}
function QrIcon({ size = 58 }) {
  return h(SvgIcon, { size }, h("path", {
    d: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v4h-2v-4Zm-4 4h4v2h-4v-2Z",
    fill: "currentColor"
  }));
}
var Button5 = React13.forwardRef(function Button6({ children, kind = "secondary", size, icon, className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `bxf-button ${className}`.trim(),
    "data-kind": kind,
    "data-size": size
  }, icon, h("span", null, children));
});
function BrandMark() {
  return h("div", { className: "bxf-brandMark" }, h(RobotIcon, { size: 34 }));
}
function Heading2({ totals, onAdd, onCredential, credentialOpen, adding, busy, addButtonRef }) {
  const hasBots = totals.configured > 0;
  return h(
    "div",
    { className: "bxf-heading" },
    h(
      "div",
      { className: "bxf-headingTools" },
      h(
        "div",
        { className: "dim-bindActions" },
        h(Button5, {
          kind: "primary",
          className: "bxf-bindButton dim-scanButton",
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          "aria-busy": busy ? "true" : void 0,
          "aria-label": "\u626B\u7801\u63A5\u5165\u98DE\u4E66\u673A\u5668\u4EBA",
          icon: h(QrActionIcon),
          loading: adding
        }, "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA"),
        h(Button5, {
          kind: "credential",
          className: "dim-credentialButton",
          onClick: onCredential,
          disabled: adding || busy,
          "aria-pressed": credentialOpen,
          "aria-label": "\u4F7F\u7528 App ID \u548C App Secret \u7ED1\u5B9A\u98DE\u4E66\u673A\u5668\u4EBA",
          icon: h(CredentialActionIcon)
        }, credentialOpen ? "\u6536\u8D77\u51ED\u636E" : "\u624B\u52A8\u63A5\u5165")
      ),
      hasBots ? h("div", {
        className: "bxf-totalBadge dim-onlineBadge",
        "aria-label": `\u5DF2\u63A5\u5165 ${totals.configured} \u4E2A\u673A\u5668\u4EBA\uFF0C\u5176\u4E2D ${totals.connected} \u4E2A\u5728\u7EBF`
      }, h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)) : null
    )
  );
}
function LoadingView2() {
  return h(
    "div",
    {
      className: "bxf-card dim-surfaceCard dim-loadingView",
      "aria-busy": "true",
      "aria-label": "\u6B63\u5728\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA\u5217\u8868"
    },
    h("div", { className: "dim-spinner", "aria-hidden": "true" }),
    h("span", null, "\u6B63\u5728\u8BFB\u53D6\u98DE\u4E66\u8FDE\u63A5\u72B6\u6001\u2026")
  );
}
function EmptyView2({ onStart, busy }) {
  return h(
    "div",
    { className: "bxf-card dim-surfaceCard" },
    h(
      "div",
      { className: "bxf-cardBody bxf-intro dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "bxf-introCopy dim-emptyCopy" },
        h(
          "div",
          { className: "bxf-stateLabel dim-stateLabel" },
          h("span", { className: "bxf-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u63A5\u5165\u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u626B\u7801\uFF0C\u521B\u5EFA\u7B2C\u4E00\u4E2A\u98DE\u4E66\u5165\u53E3"),
        h("p", null, "\u65E0\u9700\u624B\u52A8\u586B\u5199 App ID\u3002\u4EE5\u540E\u8FD8\u53EF\u4EE5\u7EE7\u7EED\u6DFB\u52A0\u673A\u5668\u4EBA\uFF0C\u5206\u522B\u670D\u52A1\u4E0D\u540C\u56E2\u961F\u6216\u98DE\u4E66\u79DF\u6237\u3002"),
        h(
          "div",
          { className: "bxf-actions dim-viewActions" },
          h(Button5, {
            kind: "primary",
            onClick: onStart,
            disabled: busy,
            "aria-busy": busy ? "true" : void 0,
            loading: busy
          }, "\u751F\u6210\u98DE\u4E66\u4E8C\u7EF4\u7801")
        )
      ),
      h("div", { className: "bxf-markStage dim-emptyBrand", "aria-hidden": "true" }, h(BrandMark))
    )
  );
}
function safeVerificationHref(value) {
  if (!value) return void 0;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && [
      "accounts.feishu.cn",
      "accounts.larksuite.com",
      "open.feishu.cn",
      "open.larksuite.com"
    ].includes(url.hostname) && !url.port && !url.username && !url.password ? url.toString() : void 0;
  } catch {
    return void 0;
  }
}
function safeQrSource2(value) {
  if (!value) return void 0;
  return /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value) ? value : void 0;
}
function QrPane({ provision, now, onRefresh, onCancel, busy }) {
  const [imageFailed, setImageFailed] = React13.useState(false);
  const qrSource = safeQrSource2(provision.qrCodeDataUrl);
  const href = safeVerificationHref(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = provision.expired === true || remaining === 0;
  const progress = Math.min(1, remaining / Math.max(1, provision.durationMs ?? remaining));
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  const botName = provision.botName ?? "\u6B64\u673A\u5668\u4EBA";
  React13.useEffect(() => setImageFailed(false), [qrSource]);
  return h(
    "div",
    { className: "bxf-card bxf-provisionCard dim-surfaceCard" },
    h(
      "div",
      { className: "bxf-cardBody bxf-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "bxf-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "bxf-qrFrame dim-qrFrame" },
          qrSource && !imageFailed ? h("img", {
            src: qrSource,
            alt: repairing ? `\u7528\u4E8E\u4E3A${botName}\u8865\u5168\u6743\u9650\u4E0E\u56DE\u8C03\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801` : grantingGroupMessages ? `\u7528\u4E8E\u4E3A${botName}\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801` : "\u7528\u4E8E\u65B0\u589E DeepSeek Harness \u98DE\u4E66\u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801",
            onError: () => setImageFailed(true)
          }) : h(
            "div",
            { className: "bxf-qrFallback dim-qrFallback" },
            h("div", null, h(QrIcon), h("span", null, "\u4E8C\u7EF4\u7801\u672A\u5C31\u7EEA\uFF0C\u8BF7\u6253\u5F00\u6388\u6743\u94FE\u63A5"))
          ),
          expired ? h(
            "div",
            { className: "bxf-expiredOverlay dim-qrExpired", role: "status" },
            h("div", null, "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548", h("br"), "\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u626B\u7801")
          ) : null
        ),
        h(
          "div",
          {
            className: "bxf-countdown dim-countdown",
            "aria-label": expired ? "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548" : `\u4E8C\u7EF4\u7801\u5269\u4F59 ${formatRemaining2(remaining)}`
          },
          h(
            "div",
            { className: "bxf-countdownTop dim-countdownTop", "aria-hidden": "true" },
            h("span", null, expired ? "\u7B49\u5F85\u5237\u65B0" : "\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, formatRemaining2(remaining))
          ),
          h(
            "div",
            { className: "bxf-progress dim-progress", "aria-hidden": "true" },
            h("span", { style: { "--bxf-progress": `${Math.round(progress * 100)}%` } })
          )
        )
      ),
      h(
        "div",
        { className: "bxf-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "bxf-stateLabel dim-stateLabel" },
          h("span", { className: "bxf-dot dim-stateDot", "data-tone": "warning" }),
          h("span", null, repairing ? `\u6B63\u5728\u4E3A\u300C${botName}\u300D\u8865\u5168\u6743\u9650\u4E0E\u56DE\u8C03` : grantingGroupMessages ? `\u6B63\u5728\u4E3A\u300C${botName}\u300D\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650` : "\u6B63\u5728\u6DFB\u52A0\u65B0\u673A\u5668\u4EBA")
        ),
        h("h3", null, expired ? "\u5237\u65B0\u4E8C\u7EF4\u7801\u540E\u7EE7\u7EED" : repairing ? "\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u8865\u5168\u6743\u9650" : grantingGroupMessages ? "\u4F7F\u7528\u98DE\u4E66\u786E\u8BA4\u7FA4\u6D88\u606F\u6743\u9650" : "\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u521B\u5EFA\u673A\u5668\u4EBA"),
        h("p", null, repairing ? "\u626B\u7801\u4F1A\u66F4\u65B0\u73B0\u6709\u98DE\u4E66\u5E94\u7528\uFF0C\u6700\u591A\u589E\u91CF\u8865\u5145\u5361\u7247\u6309\u94AE\u56DE\u8C03\u3001\u8BFB\u53D6\u7528\u6237\u6D88\u606F\u5185\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:message:readonly\uFF08\u98DE\u4E66\u663E\u793A\u4E3A\u201C\u83B7\u53D6\u5355\u804A\u3001\u7FA4\u7EC4\u6D88\u606F\u201D\uFF09\uFF0C\u4EE5\u53CA\u4E0A\u4F20\u673A\u5668\u4EBA\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:resource\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002\u786E\u8BA4\u9875\u53EA\u663E\u793A\u5F53\u524D\u7F3A\u5C11\u9879\uFF0C\u5B8C\u6210\u540E\u6B64\u673A\u5668\u4EBA\u4F1A\u77ED\u6682\u91CD\u8FDE\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u53D7\u5F71\u54CD\u3002" : grantingGroupMessages ? "\u626B\u7801\u4F1A\u66F4\u65B0\u73B0\u6709\u98DE\u4E66\u5E94\u7528\uFF0C\u53EA\u589E\u91CF\u5F00\u901A\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF1B\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002\u786E\u8BA4\u540E\u4F1A\u81EA\u52A8\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u53D7\u5F71\u54CD\u3002" : "\u626B\u7801\u53EA\u4F1A\u65B0\u589E\u4E00\u4E2A\u673A\u5668\u4EBA\uFF0C\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA\u4F1A\u7EE7\u7EED\u6B63\u5E38\u6536\u53D1\u6D88\u606F\u3002"),
        h(
          "ol",
          { className: "bxf-steps dim-steps" },
          h("li", null, "\u6253\u5F00\u98DE\u4E66\u79FB\u52A8\u7AEF\uFF0C\u4F7F\u7528\u626B\u4E00\u626B\u8BFB\u53D6\u4E8C\u7EF4\u7801"),
          h("li", null, repairing ? "\u6838\u5BF9\u73B0\u6709\u5E94\u7528\u540D\u79F0\uFF0C\u5E76\u786E\u8BA4\u53EA\u65B0\u589E\u5F53\u524D\u7F3A\u5C11\u7684\u4E0A\u8FF0\u914D\u7F6E" : grantingGroupMessages ? "\u6838\u5BF9\u73B0\u6709\u5E94\u7528\uFF0C\u5E76\u786E\u8BA4\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650" : "\u6838\u5BF9\u5E94\u7528\u540D\u79F0\u4E0E\u6743\u9650\u8303\u56F4\uFF0C\u5E76\u786E\u8BA4\u521B\u5EFA"),
          h("li", null, repairing ? "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6743\u9650\u4E0E\u56DE\u8C03\u8865\u5168\u5B8C\u6210" : grantingGroupMessages ? "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6743\u9650\u751F\u6548\u5E76\u81EA\u52A8\u5207\u6362\u54CD\u5E94\u65B9\u5F0F" : "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u65B0\u673A\u5668\u4EBA\u7684\u957F\u8FDE\u63A5\u5C31\u7EEA")
        ),
        h(
          "div",
          { className: "bxf-actions dim-viewActions" },
          expired ? h(Button5, {
            kind: "primary",
            onClick: onRefresh,
            disabled: busy,
            loading: busy
          }, "\u5237\u65B0\u4E8C\u7EF4\u7801") : href ? h("a", {
            className: "bxf-button bxf-link",
            "data-kind": "secondary",
            href,
            target: "_blank",
            rel: "noopener noreferrer"
          }, h("span", null, "\u5728\u98DE\u4E66\u4E2D\u6253\u5F00")) : null,
          !expired ? h(Button5, { onClick: onRefresh, disabled: busy }, "\u6362\u4E00\u4E2A\u4E8C\u7EF4\u7801") : null,
          h(Button5, { onClick: onCancel, disabled: busy }, repairing ? "\u53D6\u6D88\u8865\u5168" : grantingGroupMessages ? "\u53D6\u6D88\u6388\u6743" : "\u53D6\u6D88\u6DFB\u52A0")
        )
      )
    )
  );
}
function ProvisionProgress({ phase, provision, onCancel, busy }) {
  const connecting = phase === "connecting";
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  return h(
    "div",
    {
      className: "bxf-card bxf-provisionCard dim-surfaceCard dim-loadingView",
      "aria-busy": "true"
    },
    h("div", { className: "dim-spinner", "aria-hidden": "true" }),
    h("h3", null, connecting ? repairing ? "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u5B8C\u6210\u6743\u9650\u4E0E\u56DE\u8C03\u914D\u7F6E" : grantingGroupMessages ? "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u542F\u7528\u5168\u90E8\u6D88\u606F\u6A21\u5F0F" : "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u8FDE\u63A5\u65B0\u673A\u5668\u4EBA" : repairing ? "\u6B63\u5728\u51C6\u5907\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801" : grantingGroupMessages ? "\u6B63\u5728\u51C6\u5907\u6743\u9650\u6388\u6743\u4E8C\u7EF4\u7801" : "\u6B63\u5728\u51C6\u5907\u6388\u6743\u4E8C\u7EF4\u7801"),
    h("p", null, connecting ? repairing ? "\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u6743\u9650\u3001\u9A8C\u8BC1\u5361\u7247\u56DE\u8C03\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002" : grantingGroupMessages ? "\u6743\u9650\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u8BBE\u7F6E\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002" : "\u6B63\u5728\u5B89\u5168\u4FDD\u5B58\u51ED\u636E\u5E76\u68C0\u67E5\u65B0\u673A\u5668\u4EBA\u7684\u6D88\u606F\u901A\u9053\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002" : repairing ? "\u6B63\u5728\u4E3A\u73B0\u6709\u98DE\u4E66\u5E94\u7528\u7533\u8BF7\u4E00\u6B21\u6027\u66F4\u65B0\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002" : grantingGroupMessages ? "\u6B63\u5728\u4E3A\u73B0\u6709\u98DE\u4E66\u5E94\u7528\u7533\u8BF7\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002" : "\u6B63\u5728\u5411\u98DE\u4E66\u7533\u8BF7\u4E00\u6B21\u6027\u6388\u6743\u4E8C\u7EF4\u7801\uFF0C\u8BF7\u7A0D\u5019\u3002"),
    connecting && onCancel ? h(
      "div",
      { className: "bxf-actions dim-viewActions", style: { justifyContent: "center" } },
      h(Button5, { onClick: onCancel, disabled: busy }, repairing ? "\u53D6\u6D88\u8865\u5168" : grantingGroupMessages ? "\u53D6\u6D88\u6388\u6743" : "\u53D6\u6D88\u6DFB\u52A0")
    ) : null
  );
}
function ProvisionError2({ error, provision, onRetry, onCancel, busy }) {
  const repairing = isCallbackRepair(provision);
  const grantingGroupMessages = isGroupMessagePermission(provision);
  return h(
    "div",
    { className: "bxf-card bxf-provisionCard dim-surfaceCard" },
    h(
      "div",
      { className: "bxf-inlineError dim-inlineError", role: "alert" },
      h(
        "div",
        null,
        h("h3", null, repairing ? "\u6743\u9650\u4E0E\u56DE\u8C03\u6CA1\u6709\u8865\u5168\u5B8C\u6210" : grantingGroupMessages ? "\u7FA4\u6D88\u606F\u6743\u9650\u6CA1\u6709\u5F00\u901A\u5B8C\u6210" : "\u65B0\u673A\u5668\u4EBA\u6CA1\u6709\u6DFB\u52A0\u5B8C\u6210"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions dim-viewActions" },
          h(
            Button5,
            { kind: "primary", onClick: onRetry, disabled: busy, loading: busy },
            "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"
          ),
          h(Button5, { onClick: onCancel, disabled: busy }, "\u5173\u95ED")
        )
      )
    )
  );
}
var HEALTH_LABELS = {
  connected: "\u8FD0\u884C\u6B63\u5E38",
  connecting: "\u6B63\u5728\u8FDE\u63A5",
  offline: "\u8FDE\u63A5\u4E2D\u65AD",
  error: "\u9700\u8981\u5904\u7406"
};
function formatCheckedTime(timestamp7) {
  if (!timestamp7) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp7));
  } catch {
    return "\u521A\u521A";
  }
}
function connectionTestNotice2(value) {
  if (value?.testMessage?.sent === true) {
    return "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230\u98DE\u4E66\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002";
  }
  if (value?.testMessage?.code === "test-target-unavailable") {
    return "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
  }
  return value?.testMessage ? "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002" : null;
}
function RemoveConfirmation2({ bot, busy, error, onConfirm, onCancel }) {
  const cancelRef = React13.useRef(null);
  const idPart = bot.botId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const titleId = `bxf-remove-title-${idPart}`;
  const descriptionId = `bxf-remove-description-${idPart}`;
  return h(
    ConfirmDialog,
    {
      onClose: onCancel,
      busy,
      error: error?.message,
      role: "alertdialog",
      "aria-labelledby": titleId,
      "aria-describedby": descriptionId,
      onKeyDown: (event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onCancel();
        }
      }
    },
    h("h4", { id: titleId }, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${bot.bot.name}\u201D\uFF1F`),
    h(
      "p",
      { id: descriptionId },
      "\u6B64\u64CD\u4F5C\u4F1A\u505C\u6B62\u8FD9\u4E2A\u673A\u5668\u4EBA\u7684\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u4FDD\u5B58\u5728\u672C\u673A\u7684\u63A5\u5165\u914D\u7F6E\u548C\u51ED\u636E\u3002\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E5F\u4E0D\u53D7\u5F71\u54CD\u3002"
    ),
    h(
      "div",
      { className: "bxf-actions dim-viewActions" },
      h(Button5, { ref: cancelRef, onClick: onCancel, disabled: busy, "data-modal-autofocus": true }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(
        Button5,
        { kind: "danger", onClick: onConfirm, disabled: busy, loading: busy },
        "\u786E\u8BA4\u79FB\u9664\u63A5\u5165"
      )
    )
  );
}
function GroupResponseModeEditor({
  value,
  permissionGranted = false,
  disabled = false,
  authorizationDisabled = false,
  onSave,
  onAuthorize
}) {
  const current = normalizeGroupResponseMode(value);
  const [saving, setSaving] = React13.useState(false);
  const [authorizing, setAuthorizing] = React13.useState(false);
  const [error, setError] = React13.useState(null);
  const change = async (event) => {
    const next = normalizeGroupResponseMode(event.target.value);
    if (next === current || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave?.(next);
    } catch (cause) {
      setError(cause?.message ?? "\u7FA4\u804A\u54CD\u5E94\u65B9\u5F0F\u4FEE\u6539\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setSaving(false);
    }
  };
  const authorize = async () => {
    if (current !== "all" || saving || authorizing || disabled || authorizationDisabled) return;
    setAuthorizing(true);
    setError(null);
    try {
      await onAuthorize?.();
    } catch (cause) {
      setError(cause?.message ?? "\u7FA4\u6D88\u606F\u6743\u9650\u6388\u6743\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002");
    } finally {
      setAuthorizing(false);
    }
  };
  return h(
    "div",
    { className: "bxf-responseMode dim-responseMode" },
    h(
      "div",
      { className: "bxf-responseModeHeader dim-responseModeHeader" },
      h("span", null, "\u7FA4\u804A\u54CD\u5E94\u65B9\u5F0F"),
      null
    ),
    h("span", { className: "dim-controlBusy" }, h(
      "select",
      {
        className: "bxf-responseModeSelect dim-responseModeSelect",
        value: current,
        disabled: disabled || saving,
        "aria-busy": saving || void 0,
        "aria-label": "\u7FA4\u804A\u54CD\u5E94\u65B9\u5F0F",
        onChange: (event) => {
          void change(event);
        }
      },
      h("option", { value: "mention" }, "\u4EC5\u5728 @\u673A\u5668\u4EBA\u65F6\u54CD\u5E94\uFF08\u63A8\u8350\uFF09"),
      h("option", { value: "all" }, "\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F")
    ), h(BusyIndicator, { busy: saving })),
    h(
      "small",
      { className: "bxf-responseModeHelp dim-responseModeHelp" },
      current === "mention" ? permissionGranted ? "\u79C1\u804A\u59CB\u7EC8\u54CD\u5E94\uFF1B\u7FA4\u804A\u4EC5\u5904\u7406\u660E\u786E @\u5F53\u524D\u673A\u5668\u4EBA\u7684\u6D88\u606F\u3002\u7FA4\u6D88\u606F\u6743\u9650\u5DF2\u5F00\u901A\uFF0C\u518D\u6B21\u5207\u6362\u65E0\u9700\u6388\u6743\u3002" : "\u79C1\u804A\u59CB\u7EC8\u54CD\u5E94\uFF1B\u7FA4\u804A\u4EC5\u5904\u7406\u660E\u786E @\u5F53\u524D\u673A\u5668\u4EBA\u7684\u6D88\u606F\u3002\u9009\u62E9\u5168\u90E8\u6D88\u606F\u540E\u4F1A\u6253\u5F00\u98DE\u4E66\u5B98\u65B9\u6388\u6743\u6D41\u7A0B\u3002" : permissionGranted ? "\u5DF2\u5F00\u901A\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF08im:message.group_msg\uFF09\uFF1B\u673A\u5668\u4EBA\u4F1A\u5904\u7406\u7FA4\u804A\u4E2D\u7684\u6240\u6709\u53EF\u89C1\u6D88\u606F\u3002" : "\u5C1A\u672A\u786E\u8BA4\u201C\u83B7\u53D6\u7FA4\u7EC4\u4E2D\u6240\u6709\u6D88\u606F\u201D\u6743\u9650\uFF0C\u8BF7\u5B8C\u6210\u98DE\u4E66\u6388\u6743\u3002"
    ),
    current === "all" ? h(
      "div",
      { className: "bxf-responseModePermissionAction dim-responseModePermissionAction" },
      h(Button5, {
        className: "bxf-responseModePermissionButton",
        size: "small",
        disabled: disabled || authorizationDisabled || saving || authorizing,
        "aria-busy": authorizing ? "true" : void 0,
        "aria-label": permissionGranted ? "\u91CD\u65B0\u6388\u6743\u7FA4\u6D88\u606F\u6743\u9650" : "\u6388\u6743\u7FA4\u6D88\u606F\u6743\u9650",
        onClick: () => {
          void authorize();
        },
        loading: authorizing
      }, permissionGranted ? "\u91CD\u65B0\u6388\u6743" : "\u53BB\u6388\u6743")
    ) : null,
    error ? h(FeedbackToast, { text: error, tone: "error" }) : null
  );
}
function BotCard({
  connection,
  busy,
  repairDisabled,
  provisionContent,
  provisionRef,
  actionError,
  testNotice,
  removing,
  onReconnect,
  onRepairCallback,
  onWorkspaceSave,
  onAgentPresetSave,
  onGroupResponseModeSave,
  onGroupMessagePermissionAuthorize,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
  cardRef,
  removeButtonRef
}) {
  const { bot, health, state, connected } = connection;
  const repairTooltipId = React13.useId();
  const stateForDisplay = busy === "reconnect" ? "connecting" : state;
  const tone = stateForDisplay === "connected" ? "success" : stateForDisplay === "connecting" ? "warning" : "error";
  const summary = connection.error?.message ?? (connected ? null : health.summary);
  const titleId = `bxf-bot-${connection.botId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return h(
    "article",
    {
      className: "bxf-card bxf-botCard dim-botCard",
      "aria-labelledby": titleId,
      "data-bot-id": connection.botId,
      tabIndex: -1,
      ref: cardRef
    },
    h(
      "div",
      { className: "bxf-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "bxf-connectedTop dim-botCardTop" },
        h(
          "div",
          { className: "bxf-botIdentity dim-botIdentity" },
          h(
            "div",
            { className: "bxf-avatar dim-botAvatar", "aria-hidden": "true" },
            h(FeishuLogoGlyph, { size: 34 })
          ),
          h(
            "div",
            { className: "bxf-botName dim-botName" },
            h("h3", { id: titleId, title: bot.name }, bot.name),
            h("p", { title: bot.appIdMasked }, bot.appIdMasked ?? "\u5E94\u7528\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58")
          )
        ),
        h(BotStatusMeta, {
          className: "bxf-healthPill",
          dotClassName: "bxf-dot",
          tone,
          stateLabel: HEALTH_LABELS[stateForDisplay] ?? "\u72B6\u6001\u672A\u77E5",
          lastCheckedAt: health.lastCheckedAt,
          formatCheckedTime,
          healthState: stateForDisplay
        })
      ),
      h(WorkspaceEditor, {
        workspace: connection.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: connection.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(GroupResponseModeEditor, {
        value: connection.groupResponseMode,
        permissionGranted: connection.groupMessagePermissionGranted,
        disabled: Boolean(busy),
        authorizationDisabled: repairDisabled,
        onSave: onGroupResponseModeSave,
        onAuthorize: onGroupMessagePermissionAuthorize
      }),
      provisionContent ? h("section", {
        className: "bxf-botProvision dim-botProvision",
        "aria-label": `${bot.name}\u7684\u98DE\u4E66\u6388\u6743\u6D41\u7A0B`,
        "data-provision-for": connection.botId,
        ref: provisionRef,
        tabIndex: -1
      }, provisionContent) : null,
      h(
        "div",
        { className: "bxf-connectedFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "bxf-actions bxf-botActions dim-cardActions" },
            h(Button5, {
              className: "dim-cardAction",
              onClick: onReconnect,
              disabled: Boolean(busy),
              "aria-busy": busy === "reconnect" ? "true" : void 0,
              "aria-label": `${connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"}${bot.name}`,
              loading: busy === "reconnect"
            }, connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
            h(
              "span",
              { className: "bxf-repairAction" },
              h(Button5, {
                className: "bxf-repairButton dim-cardAction",
                onClick: onRepairCallback,
                disabled: Boolean(busy) || repairDisabled,
                "aria-busy": busy === "callback-repair" ? "true" : void 0,
                "aria-label": `\u4E3A${bot.name}\u8865\u5168\u6743\u9650\u4E0E\u56DE\u8C03`,
                "aria-describedby": repairTooltipId,
                loading: busy === "callback-repair"
              }, "\u8865\u5168\u6743\u9650"),
              h(
                "span",
                {
                  id: repairTooltipId,
                  className: "bxf-repairTooltip",
                  role: "tooltip"
                },
                h("strong", null, "\u8865\u5168\u8303\u56F4"),
                h("span", null, "\u6700\u591A\u589E\u91CF\u6DFB\u52A0\u5361\u7247\u56DE\u8C03 card.action.trigger\u3001\u8BFB\u53D6\u6D88\u606F\u5185\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:message:readonly\uFF08\u98DE\u4E66\u663E\u793A\u4E3A\u201C\u83B7\u53D6\u5355\u804A\u3001\u7FA4\u7EC4\u6D88\u606F\u201D\uFF09\uFF0C\u4EE5\u53CA\u4E0A\u4F20\u673A\u5668\u4EBA\u56FE\u7247\u6216\u6587\u4EF6\u6240\u9700\u7684 im:resource\uFF1B\u786E\u8BA4\u9875\u53EA\u663E\u793A\u5F53\u524D\u7F3A\u5C11\u9879\uFF0C\u4E0D\u4F1A\u521B\u5EFA\u65B0\u5E94\u7528\u3002")
              )
            ),
            h(Button5, {
              className: "dim-cardAction",
              kind: "danger",
              onClick: onRequestRemove,
              disabled: Boolean(busy),
              ref: removeButtonRef,
              "aria-label": `\u4ECE DeepSeek Harness \u79FB\u9664${bot.name}`
            }, "\u79FB\u9664\u63A5\u5165")
          ),
          summary ? h(
            "div",
            { className: "bxf-healthSummary dim-cardSummary", "data-error": connection.error ? "true" : void 0 },
            summary
          ) : null,
          connection.lastMessageError ? h(LastMessageErrorSummary, {
            className: "bxf-healthSummary",
            error: connection.lastMessageError
          }) : null,
          null
        )
      )
    ),
    removing ? h(RemoveConfirmation2, {
      bot: connection,
      busy: busy === "delete",
      error: actionError,
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function BotList(props) {
  return h(
    "section",
    { className: "bxf-listSection dim-listSection", "aria-labelledby": "bxf-bot-list-title" },
    h(ChannelListHeading, {
      className: "bxf-listHeading",
      id: "bxf-bot-list-title",
      title: "\u5DF2\u63A5\u5165\u7684\u673A\u5668\u4EBA",
      connectionLabel: "\u957F\u8FDE\u63A5"
    }),
    h(
      "ul",
      { className: "bxf-botList dim-botList", role: "list" },
      props.bots.map((bot) => h(
        "li",
        { key: bot.botId },
        h(BotCard, {
          connection: bot,
          busy: props.busyByBot[bot.botId] ?? (isTargetedAppUpdate2(props.provisioning) && props.provisioning.botId === bot.botId ? props.provisioning.operation : void 0),
          repairDisabled: Boolean(props.provisioning),
          provisionContent: isTargetedAppUpdate2(props.provisioning) && props.provisioning.botId === bot.botId ? props.provisionContent : null,
          provisionRef: props.provisionRef,
          actionError: props.errorsByBot[bot.botId],
          testNotice: props.testNoticesByBot[bot.botId],
          removing: props.removeTargetId === bot.botId,
          onReconnect: () => props.onReconnect(bot),
          onRepairCallback: () => props.onRepairCallback(bot),
          onWorkspaceSave: (workspace) => props.onWorkspaceSave(bot, workspace),
          onAgentPresetSave: (agentPreset) => props.onAgentPresetSave(bot, agentPreset),
          onGroupResponseModeSave: (groupResponseMode) => props.onGroupResponseModeSave(bot, groupResponseMode),
          onGroupMessagePermissionAuthorize: () => props.onGroupMessagePermissionAuthorize(bot),
          onRequestRemove: () => props.onRequestRemove(bot),
          onConfirmRemove: () => props.onConfirmRemove(bot),
          onCancelRemove: props.onCancelRemove,
          cardRef: (node) => props.setCardRef(bot.botId, node),
          removeButtonRef: (node) => props.setRemoveButtonRef(bot.botId, node)
        })
      ))
    )
  );
}
function PageError({ error, onRetry, busy }) {
  return h(
    "div",
    { className: "bxf-card dim-surfaceCard" },
    h(
      "div",
      { className: "bxf-error dim-inlineError", role: "alert" },
      h(
        "div",
        null,
        h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6\u98DE\u4E66\u673A\u5668\u4EBA"),
        h("p", null, error.message),
        error.code ? h("span", { className: "bxf-errorCode" }, error.code) : null,
        h(
          "div",
          { className: "bxf-actions dim-viewActions" },
          h(
            Button5,
            { kind: "primary", onClick: onRetry, disabled: busy, loading: busy },
            "\u91CD\u65B0\u8BFB\u53D6"
          )
        )
      )
    )
  );
}
var EMPTY_TOTALS2 = Object.freeze({ configured: 0, connected: 0 });
function mergeFeishuSnapshotState(current, snapshot, { restoreProvisioning = false, now = Date.now() } = {}) {
  if (snapshot.revision > 0 && current.revision > snapshot.revision) return current;
  let provisioning = current.provisioning;
  if (!provisioning && restoreProvisioning && snapshot.provisioning) {
    const submitted = snapshot.provisioning.submitted === true;
    provisioning = {
      phase: submitted || snapshot.state === "connecting" ? "connecting" : "qr",
      ...snapshot.provisioning,
      durationMs: Math.max(1, snapshot.provisioning.expiresAt - now),
      expired: !submitted && snapshot.provisioning.expiresAt <= now
    };
  }
  return {
    ...current,
    phase: "ready",
    revision: snapshot.revision,
    bots: snapshot.bots,
    totals: snapshot.totals,
    provisioning,
    pageError: null,
    statusError: null,
    agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog
  };
}
function FeishuSettingsTab({ rpcCall }) {
  const [model, setModel] = React13.useState({
    phase: "loading",
    revision: 0,
    bots: [],
    totals: EMPTY_TOTALS2,
    provisioning: null,
    pageError: null,
    statusError: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [pageBusy, setPageBusy] = React13.useState(false);
  const [provisionBusy, setProvisionBusy] = React13.useState(false);
  const [credentialOpen, setCredentialOpen] = React13.useState(false);
  const [credentialBusy, setCredentialBusy] = React13.useState(false);
  const [credentialError, setCredentialError] = React13.useState(null);
  const [busyByBot, setBusyByBot] = React13.useState({});
  const [errorsByBot, setErrorsByBot] = React13.useState({});
  const [testNoticesByBot, setTestNoticesByBot] = React13.useState({});
  const [removeTargetId, setRemoveTargetId] = React13.useState(null);
  const [announcement, setAnnouncement] = React13.useState("");
  const [now, setNow] = React13.useState(() => Date.now());
  const [focusBotId, setFocusBotId] = React13.useState(null);
  const cardRefs = React13.useRef(/* @__PURE__ */ new Map());
  const removeButtonRefs = React13.useRef(/* @__PURE__ */ new Map());
  const targetedProvisionRef = React13.useRef(null);
  const addButtonRef = React13.useRef(null);
  const mountedRef = React13.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const scheduleAnimationFrame = useAnimationFrameScheduler();
  React13.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const announce = React13.useCallback((message) => {
    setAnnouncement("");
    scheduleAnimationFrame(() => {
      if (message) setAnnouncement(message);
    }, "announcement");
  }, [scheduleAnimationFrame]);
  const invoke = React13.useCallback(async (endpoint, payload = {}, signal) => {
    return unwrapRpcResult3(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const mergeSnapshot = React13.useCallback((snapshot, { restoreProvisioning = false } = {}) => {
    const now2 = Date.now();
    setModel((current) => mergeFeishuSnapshotState(
      current,
      snapshot,
      { restoreProvisioning, now: now2 }
    ));
  }, []);
  const loadStatus = React13.useCallback(async ({ signal, silent = false, restoreProvisioning = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null || !mountedRef.current) return void 0;
    if (!silent) setPageBusy(true);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(FEISHU_ENDPOINTS.status, {}, signal));
      if (signal?.aborted || !mountedRef.current || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      mergeSnapshot(snapshot, { restoreProvisioning });
      return snapshot;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || !mountedRef.current || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      const presented = presentError3(error);
      setModel((current) => current.phase === "loading" || !silent ? { ...current, phase: "error", pageError: presented } : { ...current, statusError: presented });
      return void 0;
    } finally {
      if (!silent && !signal?.aborted && mountedRef.current) setPageBusy(false);
    }
  }, [invoke, mergeSnapshot, workspaceFence]);
  React13.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadStatus]);
  React13.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      await loadStatus({
        signal: controller.signal,
        silent: true,
        restoreProvisioning: false
      });
      inFlight = false;
    }, 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React13.useEffect(() => {
    if (!focusBotId) return;
    const node = cardRefs.current.get(focusBotId);
    if (!node) return;
    node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    node.focus({ preventScroll: true });
    setFocusBotId(null);
  }, [focusBotId, model.bots]);
  const targetedProvisionFocusKey = isTargetedAppUpdate2(model.provisioning) ? `${model.provisioning.botId}:${model.provisioning.attemptId ?? "preparing"}:${model.provisioning.phase}` : null;
  React13.useEffect(() => {
    if (!targetedProvisionFocusKey) return;
    scheduleAnimationFrame(() => {
      const node = targetedProvisionRef.current;
      if (!node) return;
      node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      node.focus?.({ preventScroll: true });
    }, "targeted-provision-focus");
  }, [scheduleAnimationFrame, targetedProvisionFocusKey]);
  const startProvisioning = React13.useCallback(async ({
    replace = false,
    operation = FEISHU_REGISTRATION_OPERATIONS.PROVISION,
    bot
  } = {}) => {
    const repairing = operation === CALLBACK_REPAIR_OPERATION;
    const grantingGroupMessages = operation === GROUP_MESSAGE_PERMISSION_OPERATION;
    const targetedUpdate = repairing || grantingGroupMessages;
    const botId = targetedUpdate ? bot?.botId ?? model.provisioning?.botId : void 0;
    const botName = targetedUpdate ? bot?.bot?.name ?? model.provisioning?.botName : void 0;
    if (targetedUpdate && !botId) return;
    setCredentialOpen(false);
    setCredentialError(null);
    setProvisionBusy(true);
    announce("");
    const previousAttemptId = model.provisioning?.attemptId;
    setModel((current) => ({
      ...current,
      phase: current.phase === "loading" ? "ready" : current.phase,
      provisioning: {
        phase: "creating",
        operation,
        ...botId ? { botId } : {},
        ...botName ? { botName } : {}
      }
    }));
    try {
      if (replace && previousAttemptId) {
        try {
          await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId: previousAttemptId });
        } catch {
        }
      }
      const endpoint = repairing ? FEISHU_ENDPOINTS.beginCallbackRepair : grantingGroupMessages ? FEISHU_ENDPOINTS.beginGroupMessagePermission : FEISHU_ENDPOINTS.beginProvisioning;
      const provision2 = normalizeProvisioning2(await invoke(
        endpoint,
        targetedUpdate ? { botId } : { locale: "zh-CN" }
      ));
      if (targetedUpdate && (provision2.operation !== operation || provision2.botId !== botId)) {
        throw new Error(grantingGroupMessages ? "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801" : "\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801");
      }
      const timestamp7 = Date.now();
      setNow(timestamp7);
      setModel((current) => ({
        ...current,
        provisioning: {
          phase: "qr",
          ...provision2,
          ...botName ? { botName } : {},
          durationMs: Math.max(1, provision2.expiresAt - timestamp7),
          expired: false
        }
      }));
      announce(repairing ? `${botName ?? "\u673A\u5668\u4EBA"}\u7684\u6743\u9650\u8865\u5168\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u3002` : grantingGroupMessages ? `${botName ?? "\u673A\u5668\u4EBA"}\u7684\u7FA4\u6D88\u606F\u6743\u9650\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u786E\u8BA4\u3002` : "\u6388\u6743\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u98DE\u4E66\u626B\u7801\u3002");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: {
          phase: "error",
          operation,
          ...botId ? { botId } : {},
          ...botName ? { botName } : {},
          ...replace && previousAttemptId ? { attemptId: previousAttemptId } : {},
          error: presentError3(error)
        }
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [
    announce,
    invoke,
    model.provisioning?.attemptId,
    model.provisioning?.botId,
    model.provisioning?.botName
  ]);
  const bindCredentials = React13.useCallback(async ({ identity, secret }) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setCredentialBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.bindCredentials,
        { appId: identity, appSecret: secret }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      setCredentialOpen(false);
      announce("\u98DE\u4E66\u673A\u5668\u4EBA\u51ED\u636E\u5DF2\u7ED1\u5B9A\u3002");
    } catch (error) {
      setCredentialError(presentError3(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setCredentialBusy(false);
    }
  }, [announce, invoke, loadStatus, mergeSnapshot, workspaceFence]);
  const cancelProvisioning = React13.useCallback(async () => {
    const activeProvision = model.provisioning;
    const attemptId = activeProvision?.attemptId;
    const repairing = isCallbackRepair(activeProvision);
    const grantingGroupMessages = isGroupMessagePermission(activeProvision);
    const targetedUpdate = isTargetedAppUpdate2(activeProvision);
    const targetBot = targetedUpdate ? model.bots.find((bot) => bot.botId === activeProvision?.botId) : void 0;
    setProvisionBusy(true);
    try {
      const result = attemptId ? normalizePollResult(await invoke(FEISHU_ENDPOINTS.cancelProvisioning, { attemptId })) : null;
      if (targetedUpdate && result) {
        if (result.operation !== activeProvision.operation || result.botId !== activeProvision.botId) {
          throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u6CE8\u518C\u8FDB\u5EA6");
        }
        if (result.status === "connecting") {
          setModel((current) => current.provisioning?.attemptId === attemptId ? {
            ...current,
            provisioning: {
              ...current.provisioning,
              ...result.provisioning ?? {},
              phase: "connecting",
              submitted: true,
              expired: false
            }
          } : current);
          announce(grantingGroupMessages ? "\u6743\u9650\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u542F\u7528\u5168\u90E8\u6D88\u606F\u6A21\u5F0F\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002" : "\u914D\u7F6E\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u4FDD\u5B58\u6743\u9650\u3001\u9A8C\u8BC1\u5361\u7247\u56DE\u8C03\u5E76\u91CD\u8FDE\u6B64\u673A\u5668\u4EBA\uFF1B\u6B64\u9636\u6BB5\u65E0\u6CD5\u53D6\u6D88\uFF0C\u5176\u4ED6\u673A\u5668\u4EBA\u4E0D\u4F1A\u4E2D\u65AD\u3002");
          return;
        }
        if (result.status === "connected") {
          const targetBotName = targetBot?.bot.name ?? activeProvision.botName ?? "\u673A\u5668\u4EBA";
          setModel((current) => ({ ...current, provisioning: null }));
          announce(grantingGroupMessages ? `${targetBotName}\u5DF2\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\uFF0C\u5E76\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\u3002` : `${targetBotName}\u7684\u6743\u9650\u4E0E\u56DE\u8C03\u5DF2\u8865\u5168\u3002`);
          if (activeProvision.botId) setFocusBotId(activeProvision.botId);
          await loadStatus({ silent: true, restoreProvisioning: false });
          return;
        }
      }
      setModel((current) => ({ ...current, provisioning: null }));
      announce(repairing ? "\u5DF2\u53D6\u6D88\u8865\u5168\u6743\u9650\u4E0E\u56DE\u8C03\u3002" : grantingGroupMessages ? "\u5DF2\u53D6\u6D88\u7FA4\u6D88\u606F\u6743\u9650\u6388\u6743\u3002" : "\u5DF2\u53D6\u6D88\u6DFB\u52A0\u673A\u5668\u4EBA\u3002");
      await loadStatus({ silent: true, restoreProvisioning: false });
      scheduleAnimationFrame(() => {
        if (targetedUpdate && activeProvision.botId) {
          cardRefs.current.get(activeProvision.botId)?.focus();
        } else {
          addButtonRef.current?.focus();
        }
      }, "focus");
    } catch (error) {
      setModel((current) => ({
        ...current,
        provisioning: {
          ...activeProvision,
          phase: "error",
          attemptId,
          error: presentError3(error)
        }
      }));
    } finally {
      setProvisionBusy(false);
    }
  }, [announce, invoke, loadStatus, model.bots, model.provisioning, scheduleAnimationFrame]);
  const countdownAttemptId = model.provisioning?.attemptId;
  const countdownPhase = model.provisioning?.phase;
  const countdownExpiresAt = model.provisioning?.expiresAt;
  const countdownExpired = model.provisioning?.expired;
  React13.useEffect(() => {
    if (!countdownAttemptId || countdownPhase !== "qr" || countdownExpired) return void 0;
    const tick = () => {
      const timestamp7 = Date.now();
      setNow(timestamp7);
      if (timestamp7 >= countdownExpiresAt) {
        setModel((current) => current.provisioning?.attemptId === countdownAttemptId ? { ...current, provisioning: { ...current.provisioning, expired: true } } : current);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1e3);
    return () => window.clearInterval(timer);
  }, [countdownAttemptId, countdownPhase, countdownExpiresAt, countdownExpired]);
  React13.useEffect(() => {
    const provision2 = model.provisioning;
    if (!provision2 || !["qr", "connecting"].includes(provision2.phase) || !provision2.attemptId || provision2.expired) return void 0;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = normalizePollResult(await invoke(
          FEISHU_ENDPOINTS.pollProvisioning,
          { attemptId: provision2.attemptId },
          controller.signal
        ));
        if (result.operation !== provision2.operation || isTargetedAppUpdate2(provision2) && result.botId !== provision2.botId) {
          throw new Error("\u98DE\u4E66\u670D\u52A1\u8FD4\u56DE\u4E86\u4E0D\u5339\u914D\u7684\u6CE8\u518C\u8FDB\u5EA6");
        }
        if (result.status === "connected") {
          const snapshot = await loadStatus({ signal: controller.signal, silent: true, restoreProvisioning: false });
          const targetBot = snapshot?.bots.find((bot) => bot.botId === result.botId);
          if (!snapshot) {
            throw new Error(isCallbackRepair(provision2) ? "\u6743\u9650\u4E0E\u56DE\u8C03\u5DF2\u66F4\u65B0\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u673A\u5668\u4EBA\u8FDE\u63A5\u72B6\u6001" : isGroupMessagePermission(provision2) ? "\u7FA4\u6D88\u606F\u6743\u9650\u5DF2\u66F4\u65B0\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u673A\u5668\u4EBA\u8FDE\u63A5\u72B6\u6001" : "\u673A\u5668\u4EBA\u5DF2\u7ECF\u521B\u5EFA\uFF0C\u4F46\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u8FDE\u63A5\u72B6\u6001");
          }
          if (!targetBot?.connected) {
            setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, phase: "connecting" } } : current);
            return;
          }
          setModel((current) => ({ ...current, provisioning: null }));
          announce(isCallbackRepair(provision2) ? `${targetBot.bot.name}\u7684\u6743\u9650\u4E0E\u56DE\u8C03\u5DF2\u8865\u5168\u3002` : isGroupMessagePermission(provision2) ? `${targetBot.bot.name}\u5DF2\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\uFF0C\u5E76\u542F\u7528\u201C\u54CD\u5E94\u6240\u6709\u7FA4\u6D88\u606F\u201D\u3002` : targetBot ? `${targetBot.bot.name}\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5728\u98DE\u4E66\u4E2D\u5F00\u59CB\u804A\u5929\u3002` : "\u65B0\u98DE\u4E66\u673A\u5668\u4EBA\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u4EE5\u5F00\u59CB\u804A\u5929\u3002");
          if (result.botId) setFocusBotId(result.botId);
          return;
        }
        if (result.status === "failed") {
          const error = new Error(result.message ?? (isCallbackRepair(provision2) ? "\u98DE\u4E66\u6743\u9650\u4E0E\u56DE\u8C03\u8865\u5168\u5931\u8D25" : isGroupMessagePermission(provision2) ? "\u98DE\u4E66\u7FA4\u6D88\u606F\u6743\u9650\u5F00\u901A\u5931\u8D25" : "\u98DE\u4E66\u5E94\u7528\u521B\u5EFA\u5931\u8D25"));
          error.code = "FEISHU_PROVISION_FAILED";
          throw error;
        }
        if (result.status === "expired") {
          setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? { ...current, provisioning: { ...current.provisioning, phase: "qr", expired: true } } : current);
          return;
        }
        setModel((current) => {
          if (current.provisioning?.attemptId !== provision2.attemptId) return current;
          const next = result.provisioning ?? current.provisioning;
          return {
            ...current,
            provisioning: {
              ...current.provisioning,
              ...next,
              phase: ["scanned", "connecting"].includes(result.status) ? "connecting" : "qr"
            }
          };
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        setModel((current) => current.provisioning?.attemptId === provision2.attemptId ? {
          ...current,
          provisioning: {
            ...current.provisioning,
            phase: "error",
            attemptId: provision2.attemptId,
            error: presentError3(error)
          }
        } : current);
      }
    }, provision2.pollIntervalMs);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [announce, invoke, loadStatus, model.provisioning]);
  const setBotBusy = React13.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);
  const setBotError = React13.useCallback((botId, error) => {
    setErrorsByBot((current) => {
      const next = { ...current };
      if (error) next[botId] = presentError3(error);
      else delete next[botId];
      return next;
    });
  }, []);
  const repairCallback = React13.useCallback((connection) => {
    if (model.provisioning) return;
    setRemoveTargetId(null);
    setBotError(connection.botId, null);
    setTestNoticesByBot((current) => {
      const next = { ...current };
      delete next[connection.botId];
      return next;
    });
    void startProvisioning({
      operation: CALLBACK_REPAIR_OPERATION,
      bot: connection
    });
  }, [model.provisioning, setBotError, startProvisioning]);
  const reconnectOneBot = React13.useCallback(async (connection) => {
    const { botId, bot } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "reconnect");
    setBotError(botId, null);
    setTestNoticesByBot((current) => {
      const next = { ...current };
      delete next[botId];
      return next;
    });
    try {
      const value = await invoke(FEISHU_ENDPOINTS.reconnectBot, { botId, sendTest: true });
      const snapshot = normalizeBotsSnapshot(value);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      const refreshed = snapshot.bots.find((item) => item.botId === botId);
      if (!refreshed?.connected) {
        const error = new Error(
          refreshed?.error?.message ?? refreshed?.health.summary ?? "\u673A\u5668\u4EBA\u4ECD\u672A\u8FDE\u63A5"
        );
        error.code = refreshed?.error?.code ?? "FEISHU_BOT_OFFLINE";
        throw error;
      }
      const testNotice = connectionTestNotice2(value);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setTestNoticesByBot((current) => ({ ...current, [botId]: testNotice }));
      }
      announce(testNotice ?? (connection.connected ? `${bot.name}\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002` : `${bot.name}\u5DF2\u91CD\u65B0\u8FDE\u63A5\u3002`));
    } catch (error) {
      const failure = new Error("\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
      failure.code = error?.code;
      setBotError(botId, failure);
      announce(failure.message);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(botId, null);
    }
  }, [announce, invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);
  const saveWorkspace = React13.useCallback(async (connection, workspace) => {
    const { botId } = connection;
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "workspace");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.setWorkspace,
        { botId, workspace }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        mergeSnapshot(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(botId, null);
    }
  }, [invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);
  const saveAgentPreset = React13.useCallback(async (connection, agentPreset) => {
    const { botId } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "preset");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.setAgentPreset,
        { botId, agentPreset }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(botId, null);
    }
  }, [invoke, loadStatus, mergeSnapshot, setBotBusy, setBotError, workspaceFence]);
  const authorizeGroupMessages = React13.useCallback(async (connection) => {
    const { botId } = connection;
    if (model.provisioning) {
      throw new Error("\u8BF7\u5148\u5B8C\u6210\u5F53\u524D\u98DE\u4E66\u6388\u6743\u64CD\u4F5C\uFF0C\u518D\u5F00\u901A\u7FA4\u6D88\u606F\u6743\u9650\u3002");
    }
    setRemoveTargetId(null);
    setBotError(botId, null);
    setTestNoticesByBot((current) => {
      const next = { ...current };
      delete next[botId];
      return next;
    });
    await startProvisioning({
      operation: GROUP_MESSAGE_PERMISSION_OPERATION,
      bot: connection
    });
  }, [model.provisioning, setBotError, startProvisioning]);
  const saveGroupResponseMode = React13.useCallback(async (connection, groupResponseMode) => {
    const { botId } = connection;
    if (groupResponseMode === "all" && connection.groupMessagePermissionGranted !== true) {
      await authorizeGroupMessages(connection);
      return;
    }
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "group-response-mode");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.setGroupResponseMode,
        { botId, groupResponseMode }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(botId, null);
    }
  }, [
    invoke,
    authorizeGroupMessages,
    loadStatus,
    mergeSnapshot,
    setBotBusy,
    setBotError,
    workspaceFence
  ]);
  const requestRemove = React13.useCallback((connection) => {
    setRemoveTargetId(connection.botId);
  }, []);
  const cancelRemove = React13.useCallback(() => {
    const botId = removeTargetId;
    setRemoveTargetId(null);
    scheduleAnimationFrame(() => removeButtonRefs.current.get(botId)?.focus(), "focus");
  }, [removeTargetId, scheduleAnimationFrame]);
  const confirmRemove = React13.useCallback(async (connection) => {
    const { botId, bot } = connection;
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(botId, "delete");
    setBotError(botId, null);
    try {
      const snapshot = normalizeBotsSnapshot(await invoke(
        FEISHU_ENDPOINTS.deleteBot,
        { botId, confirm: true }
      ));
      setRemoveTargetId(null);
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        mergeSnapshot(snapshot);
      }
      announce(`${bot.name}\u5DF2\u4ECE\u6B64 DeepSeek Harness \u79FB\u9664\uFF1B\u98DE\u4E66\u5F00\u653E\u5E73\u53F0\u4E2D\u7684\u5E94\u7528\u672A\u88AB\u5220\u9664\u3002`);
      scheduleAnimationFrame(() => addButtonRef.current?.focus(), "focus");
    } catch (error) {
      setBotError(botId, error);
      announce(error?.message ?? `${bot.name}\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002`);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(botId, null);
    }
  }, [announce, invoke, loadStatus, mergeSnapshot, scheduleAnimationFrame, setBotBusy, setBotError, workspaceFence]);
  const provision = model.provisioning;
  const targetedProvisioning = isTargetedAppUpdate2(provision);
  const provisionBot = provision?.botId ? model.bots.find((bot) => bot.botId === provision.botId) ?? { botId: provision.botId, bot: { name: provision.botName ?? "\u6B64\u673A\u5668\u4EBA" } } : void 0;
  const restartProvisioning = ({ replace = false } = {}) => startProvisioning({
    replace,
    operation: provision?.operation ?? FEISHU_REGISTRATION_OPERATIONS.PROVISION,
    bot: provisionBot
  });
  let provisionContent = null;
  if (provision?.phase === "creating") {
    provisionContent = h(ProvisionProgress, {
      phase: "creating",
      provision,
      busy: provisionBusy
    });
  } else if (provision?.phase === "qr") {
    provisionContent = h(QrPane, {
      provision,
      now,
      onRefresh: () => void restartProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning(),
      busy: provisionBusy || model.phase !== "ready"
    });
  } else if (provision?.phase === "connecting") {
    provisionContent = h(ProvisionProgress, {
      phase: "connecting",
      provision,
      onCancel: isTargetedAppUpdate2(provision) ? void 0 : () => void cancelProvisioning(),
      busy: provisionBusy
    });
  } else if (provision?.phase === "error") {
    provisionContent = h(ProvisionError2, {
      error: provision.error,
      provision,
      onRetry: () => void restartProvisioning({ replace: Boolean(provision.attemptId) }),
      onCancel: () => {
        const targetBotId = provision.botId;
        setModel((current) => ({ ...current, provisioning: null }));
        void loadStatus({ silent: true, restoreProvisioning: false });
        scheduleAnimationFrame(() => {
          if (targetBotId) cardRefs.current.get(targetBotId)?.focus();
          else addButtonRef.current?.focus();
        }, "focus");
      },
      busy: provisionBusy
    });
  }
  const credentialContent = credentialOpen ? h(CredentialBindingPanel, {
    channel: "\u98DE\u4E66",
    identityLabel: "App ID",
    identityPlaceholder: "\u586B\u5199\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 App ID",
    secretLabel: "App Secret",
    secretPlaceholder: "\u586B\u5199\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 App Secret",
    busy: credentialBusy,
    error: credentialError,
    onSubmit: bindCredentials,
    onCancel: () => {
      setCredentialOpen(false);
      setCredentialError(null);
    }
  }) : null;
  const setCardRef = React13.useCallback((botId, node) => {
    if (node) cardRefs.current.set(botId, node);
    else cardRefs.current.delete(botId);
  }, []);
  const setRemoveButtonRef = React13.useCallback((botId, node) => {
    if (node) removeButtonRefs.current.set(botId, node);
    else removeButtonRefs.current.delete(botId);
  }, []);
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    { className: "bxf-page dim-channelPage", "aria-label": "\u98DE\u4E66\u673A\u5668\u4EBA\u8BBE\u7F6E" },
    h(Heading2, {
      totals: model.totals,
      onAdd: () => void startProvisioning(),
      onCredential: () => {
        setCredentialOpen((value) => !value);
        setCredentialError(null);
      },
      credentialOpen,
      adding: Boolean(provision),
      busy: provisionBusy || credentialBusy,
      addButtonRef
    }),
    announcement && !removeTargetId ? h(FeedbackToast, { text: announcement }) : null,
    model.statusError ? h(FeedbackToast, { text: `\u72B6\u6001\u81EA\u52A8\u5237\u65B0\u5931\u8D25\uFF1A${model.statusError.message}`, tone: "error", actions: [{ label: "\u7ACB\u5373\u91CD\u8BD5", onClick: () => {
      if (!pageBusy) void loadStatus({ silent: true });
    } }] }) : null,
    model.phase === "loading" ? h(LoadingView2) : model.phase === "error" ? h(PageError, {
      error: model.pageError ?? { message: "\u65E0\u6CD5\u8BFB\u53D6\u8FDE\u63A5\u72B6\u6001" },
      onRetry: () => void loadStatus(),
      busy: pageBusy
    }) : h(
      React13.Fragment,
      null,
      credentialContent,
      targetedProvisioning ? null : provisionContent,
      model.bots.length === 0 && !provision && !credentialOpen ? h(EmptyView2, { onStart: () => void startProvisioning(), busy: provisionBusy }) : null,
      model.bots.length > 0 ? h(BotList, {
        bots: model.bots,
        busyByBot,
        errorsByBot,
        testNoticesByBot,
        removeTargetId,
        provisioning: provision,
        provisionContent,
        provisionRef: targetedProvisionRef,
        onReconnect: (bot) => void reconnectOneBot(bot),
        onRepairCallback: repairCallback,
        onWorkspaceSave: saveWorkspace,
        onAgentPresetSave: saveAgentPreset,
        onGroupResponseModeSave: saveGroupResponseMode,
        onGroupMessagePermissionAuthorize: authorizeGroupMessages,
        onRequestRemove: requestRemove,
        onConfirmRemove: (bot) => void confirmRemove(bot),
        onCancelRemove: cancelRemove,
        setCardRef,
        setRemoveButtonRef
      }) : null
    )
  ));
}

// plugin-src/client/channels/feishu/styles.js
var FEISHU_STYLE_ID = "xmanrui-dsh-im-feishu-settings";
var CSS3 = String.raw`
.bxf-page {
  --bxf-accent: var(--dsw-alias-state-business-primary, #3370ff);
  --bxf-success: var(--dsw-alias-state-success-primary, #20a162);
  --bxf-warning: var(--dsw-alias-state-warn-primary, #d97706);
  --bxf-error: var(--dsw-alias-state-error-primary, #d54941);
  box-sizing: border-box;
  width: 100%;
  max-width: 860px;
  color: var(--dsw-alias-label-primary, #1f2329);
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  gap: 18px;
  padding: 2px 0 24px;
}

.bxf-page *, .bxf-page *::before, .bxf-page *::after { box-sizing: border-box; }

.bxf-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.bxf-headingCopy { min-width: 0; }
.bxf-heading h2, .bxf-heading p, .bxf-card h3, .bxf-card p { margin: 0; }

.bxf-eyebrow {
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: .08em;
  text-transform: uppercase;
  margin-bottom: 3px;
}

.bxf-heading h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
  letter-spacing: -.015em;
}

.bxf-heading p {
  max-width: 540px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 13px;
  line-height: 20px;
  margin-top: 5px;
  white-space: nowrap;
}

.bxf-headingTools {
  width: 100%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 8px;
}

.bxf-totalBadge {
  min-height: 28px;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  border-radius: 999px;
  padding: 4px 10px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-module-platform, #f2f3f5);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.bxf-totalBadge strong { color: var(--bxf-success); font-size: 13px; }

.bxf-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: none;
}

.bxf-card::before {
  content: "";
  pointer-events: none;
  position: absolute;
  inset: 0 0 auto;
  height: 88px;
  background:
    radial-gradient(circle at 86% -35%, color-mix(in srgb, var(--bxf-accent) 18%, transparent), transparent 68%);
  opacity: .85;
}

.bxf-cardBody { position: relative; padding: 24px; }

.bxf-intro {
  min-height: 250px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 172px;
  gap: 32px;
  align-items: center;
}

.bxf-introCopy { max-width: 500px; }

.bxf-stateLabel {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  margin-bottom: 13px;
}

.bxf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #8f959e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--dsw-alias-label-tertiary, #8f959e) 12%, transparent);
}

.bxf-dot[data-tone="success"] {
  background: var(--bxf-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-success) 13%, transparent);
}

.bxf-dot[data-tone="warning"] {
  background: var(--bxf-warning);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-warning) 13%, transparent);
}

.bxf-dot[data-tone="error"] {
  background: var(--bxf-error);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bxf-error) 13%, transparent);
}

.bxf-intro h3 {
  font-size: 24px;
  line-height: 34px;
  font-weight: 700;
  letter-spacing: -.02em;
}

.bxf-introCopy > p {
  max-width: 490px;
  color: var(--dsw-alias-label-secondary, #646a73);
  font-size: 14px;
  line-height: 23px;
  margin-top: 8px;
}

.bxf-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-size: 12px;
  line-height: 18px;
  margin-top: 16px;
}

.bxf-note svg { flex: none; margin-top: 1px; }

.bxf-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.bxf-button {
  appearance: none;
  height: 36px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  padding: 0 14px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  text-decoration: none;
  cursor: pointer;
  box-shadow: none;
  transition: background .15s var(--ds-ease-in-out, ease), border-color .15s var(--ds-ease-in-out, ease), transform .15s var(--ds-ease-in-out, ease);
}

.bxf-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
}

.bxf-button:active:not(:disabled) { transform: translateY(1px); }

.bxf-button:focus-visible, .bxf-link:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.bxf-button:disabled { cursor: not-allowed; opacity: .55; }

.bxf-button[data-kind="primary"] {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
  box-shadow: none;
}

.bxf-button[data-kind="primary"]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}

.bxf-button[data-kind="danger"] { color: var(--bxf-error); }
.bxf-button[data-size="small"] { height: 28px; min-height: 28px; padding: 0 10px; border-radius: 14px; font-size: 12px; }
.bxf-bindButton { flex: none; white-space: nowrap; }

.bxf-provisionCard {
  border-color: color-mix(in srgb, var(--bxf-accent) 32%, var(--dsw-alias-border-l2, #dee0e3));
}

.bxf-markStage {
  position: relative;
  width: 156px;
  height: 156px;
  display: grid;
  place-items: center;
  justify-self: end;
}

.bxf-markStage::before, .bxf-markStage::after {
  content: "";
  position: absolute;
  border-radius: 50%;
}

.bxf-markStage::before {
  inset: 12px;
  border: 1px solid color-mix(in srgb, var(--bxf-accent) 18%, var(--dsw-alias-border-l2, #dee0e3));
  background: color-mix(in srgb, var(--bxf-accent) 4%, var(--dsw-alias-bg-layer-1, #fff));
}

.bxf-markStage::after {
  inset: 0;
  border: 1px dashed color-mix(in srgb, var(--bxf-accent) 16%, transparent);
  animation: bxf-rotate 18s linear infinite;
}

.bxf-brandMark {
  position: relative;
  z-index: 1;
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  color: #fff;
  background: var(--bxf-accent);
  box-shadow: none;
}

.bxf-qrLayout {
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  align-items: center;
  gap: 32px;
}

.bxf-qrColumn { min-width: 0; }

.bxf-qrFrame {
  position: relative;
  width: 222px;
  height: 222px;
  display: grid;
  place-items: center;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  padding: 13px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: none;
}

.bxf-qrFrame::before, .bxf-qrFrame::after {
  content: "";
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: var(--bxf-accent);
  border-style: solid;
}

.bxf-qrFrame::before { inset: -3px auto auto -3px; border-width: 2px 0 0 2px; border-radius: 5px 0 0; }
.bxf-qrFrame::after { inset: auto -3px -3px auto; border-width: 0 2px 2px 0; border-radius: 0 0 5px; }
.bxf-qrFrame img { width: 100%; height: 100%; display: block; object-fit: contain; }

.bxf-qrFallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--bxf-accent);
  background: #f7f9ff;
  text-align: center;
  padding: 20px;
}

.bxf-qrFallback span { display: block; color: #646a73; font-size: 12px; line-height: 18px; margin-top: 8px; }

.bxf-expiredOverlay {
  position: absolute;
  inset: 10px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: #1f2329;
  background: rgba(255, 255, 255, .94);
  backdrop-filter: blur(3px);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.bxf-countdown {
  width: 222px;
  color: var(--dsw-alias-label-tertiary, #8f959e);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 17px;
  margin-top: 11px;
}

.bxf-countdownTop { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bxf-progress { height: 3px; overflow: hidden; border-radius: 99px; background: var(--dsw-alias-bg-module-platform, #f2f3f5); margin-top: 6px; }
.bxf-progress > span { display: block; width: var(--bxf-progress, 100%); height: 100%; border-radius: inherit; background: var(--dsw-alias-state-business-primary); transition: width 1s linear; }

.bxf-qrCopy h3 { font-size: 20px; line-height: 29px; font-weight: 700; }
.bxf-qrCopy > p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 7px; }

.bxf-steps { counter-reset: bxf-step; display: flex; flex-direction: column; gap: 11px; margin: 20px 0 0; padding: 0; list-style: none; }
.bxf-steps li { counter-increment: bxf-step; display: grid; grid-template-columns: 23px minmax(0, 1fr); align-items: start; gap: 9px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 19px; }
.bxf-steps li::before { content: counter(bxf-step); width: 21px; height: 21px; display: grid; place-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font-size: 10px; font-weight: 600; }

.bxf-connecting { min-height: 292px; display: grid; place-items: center; text-align: center; padding: 36px 24px; }
.bxf-connectingCopy { max-width: 430px; }
.bxf-orbit { position: relative; width: 86px; height: 86px; display: grid; place-items: center; margin: 0 auto 22px; }
.bxf-orbit::before, .bxf-orbit::after { content: ""; position: absolute; border-radius: 50%; }
.bxf-orbit::before { inset: 3px; border: 1px solid color-mix(in srgb, var(--bxf-accent) 24%, transparent); animation: bxf-pulse 1.8s var(--ds-ease-in-out, ease) infinite; }
.bxf-orbit::after { inset: 0; border: 2px solid transparent; border-top-color: var(--bxf-accent); animation: bxf-rotate 1.2s linear infinite; }
.bxf-orbitCore { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 16px; color: var(--bxf-accent); background: color-mix(in srgb, var(--bxf-accent) 9%, var(--dsw-alias-bg-layer-1, #fff)); }
.bxf-connecting h3 { font-size: 20px; line-height: 29px; }
.bxf-connecting p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 7px; }
.bxf-connectingCompact { min-height: 248px; }

.bxf-inlineError {
  min-height: 190px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-content: center;
  gap: 15px;
  padding: 28px;
}

.bxf-inlineError h3 { font-size: 17px; line-height: 25px; margin: 0; }
.bxf-inlineError p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 5px; overflow-wrap: anywhere; }

.bxf-listSection { display: flex; flex-direction: column; gap: 10px; }
.bxf-listHeading { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 2px; }
.bxf-listHeading h3 { font-size: 14px; line-height: 22px; font-weight: 600; margin: 0; }
.bxf-botList { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.bxf-botList > li { min-width: 0; }
.bxf-botCard:focus { outline: none; }
.bxf-botCard:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }

.bxf-connectedTop { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.bxf-botIdentity { min-width: 0; display: flex; align-items: center; gap: 13px; }
.bxf-avatar { flex: none; width: 48px; height: 48px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: none; }
.bxf-botName { min-width: 0; }
.bxf-botName h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; line-height: 24px; font-weight: 600; }
.bxf-botName p { overflow: hidden; color: var(--dsw-alias-label-tertiary, #8f959e); font-family: var(--ds-font-family-code, monospace); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }

.bxf-healthPill { flex: none; display: inline-flex; align-items: center; gap: 7px; min-height: 28px; border-radius: 999px; padding: 4px 10px; color: var(--bxf-success); background: color-mix(in srgb, var(--bxf-success) 10%, transparent); font-size: 12px; font-weight: 600; line-height: 18px; }
.bxf-healthPill[data-health="degraded"], .bxf-healthPill[data-health="checking"], .bxf-healthPill[data-health="connecting"] { color: var(--bxf-warning); background: color-mix(in srgb, var(--bxf-warning) 10%, transparent); }
.bxf-healthPill[data-health="offline"], .bxf-healthPill[data-health="error"] { color: var(--bxf-error); background: color-mix(in srgb, var(--bxf-error) 10%, transparent); }


.bxf-responseMode { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) max-content; align-items: center; column-gap: 10px; row-gap: 5px; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, #eef0f3); border-radius: 9px; background: var(--dsw-alias-bg-module-platform, #f7f8fa); }
.bxf-responseModeHeader { display: contents; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: normal; }
.bxf-responseModeHeader > span:first-child { grid-column: 1; grid-row: 1; white-space: nowrap; }
.bxf-responseModeStatus { grid-column: 2; grid-row: 1; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; white-space: nowrap; }
.bxf-responseModeSelect { min-width: 0; width: 100%; grid-column: 1 / -1; grid-row: 2; height: 32px; padding: 0 30px 0 9px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 7px; color: var(--dsw-alias-label-primary, #1f2329); background-color: var(--dsw-alias-bg-layer-1, #fff); font: inherit; font-size: 12px; cursor: pointer; transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease; }
.bxf-responseModeSelect:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.bxf-responseModeSelect:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); }
.bxf-responseModeSelect:disabled { cursor: not-allowed; opacity: .55; }
.bxf-responseModeHelp { grid-column: 1 / -1; grid-row: 3; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.45; }
.bxf-responseModePermissionAction { grid-column: 1 / -1; grid-row: 4; display: flex; justify-content: flex-start; margin-top: 2px; }
.bxf-responseModePermissionButton { height: 28px; min-height: 28px; padding: 0 9px; border-radius: 14px; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); background: transparent; }
.bxf-responseModePermissionButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.bxf-responseModeError { grid-column: 1 / -1; grid-row: 5; color: var(--bxf-error); font-size: 12px; line-height: 1.4; margin: 0; }

.bxf-botProvision {
  position: relative;
  margin-top: 14px;
  scroll-margin-block: 20px;
  animation: bxf-revealProvision .2s var(--ds-ease-out, ease-out) both;
}
.bxf-botProvision:focus { outline: none; }
.bxf-botProvision:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 3px;
  border-radius: 12px;
}
.bxf-botProvision > .bxf-provisionCard {
  border-radius: 11px;
  box-shadow: none;
  background: color-mix(in srgb, var(--bxf-accent) 2.5%, var(--dsw-alias-bg-layer-3, #fff));
}
.bxf-botProvision .bxf-cardBody { padding: 18px; }
.bxf-botProvision .bxf-qrLayout {
  grid-template-columns: 184px minmax(0, 1fr);
  align-items: start;
  gap: 24px;
}
.bxf-botProvision .bxf-qrFrame { width: 176px; height: 176px; padding: 10px; border-radius: 11px; }
.bxf-botProvision .bxf-countdown { width: 176px; }
.bxf-botProvision .bxf-qrCopy h3 { font-size: 18px; line-height: 26px; }
.bxf-botProvision .bxf-steps { gap: 8px; margin-top: 14px; }
.bxf-botProvision .bxf-actions { margin-top: 16px; }
.bxf-botProvision .bxf-inlineError { min-height: 160px; padding: 22px; }

.bxf-connectedFooter { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1, #eef0f3); }
.bxf-healthSummary { min-width: 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 18px; }
.bxf-healthSummary[data-error="true"] { color: var(--bxf-error); }
.bxf-botActions { position: relative; flex: none; width: 100%; flex-wrap: wrap; gap: 8px; margin-top: 0; justify-content: flex-end; }
.bxf-botActions .bxf-button { flex: none; white-space: nowrap; }
.bxf-botActions .bxf-repairButton { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: transparent; }
.bxf-botActions .bxf-repairButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.bxf-repairAction { display: inline-flex; }
.bxf-repairTooltip {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  width: min(330px, 100%);
  display: grid;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #dfe1e5);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary, #1f2329);
  background: var(--dsw-alias-bg-layer-3, #fff);
  box-shadow: 0 10px 28px rgb(31 35 41 / 16%);
  opacity: 0;
  visibility: hidden;
  transform: translateY(3px);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease, visibility .15s ease;
}
.bxf-repairTooltip strong { font-size: 12px; line-height: 17px; font-weight: 600; }
.bxf-repairTooltip > span { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; line-height: 17px; font-weight: 400; overflow-wrap: anywhere; }
.bxf-repairAction:hover .bxf-repairTooltip,
.bxf-repairAction:focus-within .bxf-repairTooltip { opacity: 1; visibility: visible; transform: translateY(0); }

.bxf-confirm {
  border-top: 1px solid var(--dsw-alias-border-l2, #dee0e3);
  background: color-mix(in srgb, var(--bxf-error) 4%, var(--dsw-alias-bg-module-platform, #f7f8fa));
  padding: 17px 24px 20px;
}
.bxf-confirm:focus { outline: none; }
.bxf-confirm h4 { font-size: 13px; line-height: 20px; margin: 0; }
.bxf-confirm p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 19px; margin: 4px 0 0; }
.bxf-confirm .bxf-actions { margin-top: 12px; }

.bxf-error { min-height: 252px; display: grid; grid-template-columns: 44px minmax(0, 1fr); align-content: center; gap: 15px; padding: 30px; }
.bxf-errorIcon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 13px; color: var(--bxf-error); background: color-mix(in srgb, var(--bxf-error) 9%, transparent); }
.bxf-error h3 { font-size: 17px; line-height: 25px; }
.bxf-error p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 21px; margin-top: 5px; overflow-wrap: anywhere; }
.bxf-errorCode { display: inline-block; color: var(--dsw-alias-label-tertiary, #8f959e); font-family: var(--ds-font-family-code, monospace); font-size: 11px; margin-top: 7px; }

.bxf-statusNotice {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid color-mix(in srgb, var(--bxf-warning) 28%, var(--dsw-alias-border-l2, #dee0e3));
  border-radius: 10px;
  padding: 9px 11px;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: color-mix(in srgb, var(--bxf-warning) 5%, var(--dsw-alias-bg-layer-1, #fff));
  font-size: 12px;
  line-height: 18px;
}
.bxf-statusNotice > svg { flex: none; color: var(--bxf-warning); }
.bxf-statusNotice > span { min-width: 0; flex: 1; overflow-wrap: anywhere; }

.bxf-skeleton { min-height: 260px; padding: 28px; }
.bxf-skeletonLine { height: 12px; border-radius: 999px; background: linear-gradient(90deg, var(--dsw-alias-bg-module-platform, #f2f3f5), color-mix(in srgb, var(--dsw-alias-label-tertiary, #8f959e) 10%, transparent), var(--dsw-alias-bg-module-platform, #f2f3f5)); background-size: 220% 100%; animation: bxf-shimmer 1.5s linear infinite; }
.bxf-skeletonLine:nth-child(1) { width: 92px; }
.bxf-skeletonLine:nth-child(2) { width: 44%; height: 22px; margin-top: 23px; }
.bxf-skeletonLine:nth-child(3) { width: 72%; margin-top: 14px; }
.bxf-skeletonLine:nth-child(4) { width: 58%; margin-top: 9px; }
.bxf-skeletonBox { width: 138px; height: 38px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, #f2f3f5); margin-top: 28px; }

.bxf-visuallyHidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@keyframes bxf-rotate { to { transform: rotate(360deg); } }
@keyframes bxf-pulse { 0%, 100% { transform: scale(.9); opacity: .45; } 50% { transform: scale(1.08); opacity: 1; } }
@keyframes bxf-shimmer { to { background-position: -220% 0; } }
@keyframes bxf-revealProvision { from { opacity: 0; transform: translateY(-5px); } }

@container (max-width: 620px) {
  .bxf-headingTools { gap: 6px; }
  .bxf-headingTools .bxf-totalBadge { padding-inline: 8px; }
  .bxf-headingTools .bxf-bindButton { padding-inline: 10px; }
}

@media (max-width: 680px) {
  .bxf-intro { grid-template-columns: minmax(0, 1fr); }
  .bxf-markStage { display: none; }
  .bxf-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .bxf-botProvision .bxf-qrLayout { grid-template-columns: minmax(0, 1fr); }
  .bxf-qrCopy { width: 100%; }
  .bxf-connectedTop { align-items: flex-start; flex-direction: column; }
  .bxf-inlineError { grid-template-columns: minmax(0, 1fr); padding: 20px; }
  .bxf-statusNotice { align-items: flex-start; flex-wrap: wrap; }
  .bxf-cardBody { padding: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  .bxf-page *, .bxf-page *::before, .bxf-page *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
`;
function installFeishuStyles() {
  if (typeof document === "undefined") {
    return () => {
    };
  }
  const existing = document.querySelector(
    `style[data-plugin-css="${FEISHU_STYLE_ID}"]`
  );
  if (existing) {
    return () => {
    };
  }
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = FEISHU_STYLE_ID;
  style.textContent = CSS3;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

// plugin-src/client/channels/qq/api.js
var QQ_RPC_CHANNEL = "/qq";
var QQ_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  bindCredentials: "bot.bind-credentials",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
var PROVISION_STATES2 = /* @__PURE__ */ new Set(["starting", "pending", "refreshing", "connecting", "connected", "failed", "cancelled"]);
var ACCOUNT_STATES3 = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
var TEST_MESSAGE_CODES = /* @__PURE__ */ new Set(["test-target-unavailable", "test-message-failed"]);
var QR_DATA_URL2 = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;
function isRecord4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text3(value, fallback, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}
function id2(value) {
  const result = text3(value, "", 128);
  return /^[a-z\d_-]+$/i.test(result) ? result : void 0;
}
function timestamp3(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function unwrapRpcResult4(result) {
  if (!isRecord4(result) || typeof result.ok !== "boolean") throw new Error("QQ \u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  if (!result.ok) {
    const error = new Error(text3(result.error?.message, "QQ \u64CD\u4F5C\u5931\u8D25"));
    error.code = text3(result.error?.code, "QQ_RPC_ERROR", 80);
    throw error;
  }
  return result.value;
}
function safeQrSource3(value) {
  return typeof value === "string" && value.length <= 2 * 1024 * 1024 && QR_DATA_URL2.test(value) ? value : void 0;
}
function normalizeProvisioning3(value, now = Date.now()) {
  const source = isRecord4(value?.provisioning) ? value.provisioning : value;
  if (!isRecord4(source)) throw new Error("QQ \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6");
  const attemptId = id2(source.attemptId);
  if (!attemptId) throw new Error("QQ \u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1");
  const reported = text3(source.status, "failed", 32);
  const result = {
    attemptId,
    status: PROVISION_STATES2.has(reported) ? reported : "failed",
    expiresAt: timestamp3(source.expiresAt) ?? now + 5 * 6e4,
    pollIntervalMs: Math.min(1e4, Math.max(500, Number(source.pollIntervalMs) || 1e3)),
    qrRevision: Number.isSafeInteger(source.qrRevision) ? source.qrRevision : 0
  };
  const qrCodeDataUrl = safeQrSource3(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (id2(source.botId)) result.botId = id2(source.botId);
  if (isRecord4(source.error)) result.error = {
    code: text3(source.error.code, "QQ_PROVISION_FAILED", 80),
    message: text3(source.error.message, "QQ \u673A\u5668\u4EBA\u6CA1\u6709\u63A5\u5165\u5B8C\u6210")
  };
  return result;
}
function normalizeBot3(value) {
  if (!isRecord4(value) || !id2(value.botId)) return void 0;
  const connected = value.connected === true;
  const state = ACCOUNT_STATES3.has(value.state) ? value.state : "offline";
  return {
    botId: id2(value.botId),
    connected,
    state: connected ? "connected" : state,
    workspace: text3(value.workspace, "", 4096),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    bot: {
      name: text3(value.bot?.name, "QQ\u673A\u5668\u4EBA", 100),
      appIdMasked: text3(value.bot?.appIdMasked, "\u5E94\u7528\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58", 140)
    },
    health: {
      summary: text3(value.health?.summary, connected ? "QQ WebSocket \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38" : "QQ \u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA"),
      lastCheckedAt: timestamp3(value.health?.lastCheckedAt)
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord4(value.error) ? {
      code: text3(value.error.code, "QQ_ACCOUNT_ERROR", 80),
      message: text3(value.error.message, "QQ \u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA")
    } : null
  };
}
function normalizeTestMessage2(value) {
  if (!isRecord4(value) || typeof value.sent !== "boolean") return void 0;
  if (value.sent) return { sent: true };
  const code = text3(value.code, "test-message-failed", 80);
  return {
    sent: false,
    code: TEST_MESSAGE_CODES.has(code) ? code : "test-message-failed"
  };
}
function normalizeSnapshot3(value) {
  const source = isRecord4(value?.snapshot) ? value.snapshot : value;
  if (!isRecord4(source) || !Array.isArray(source.bots)) throw new Error("QQ \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868");
  const bots = source.bots.map(normalizeBot3).filter(Boolean);
  const testMessage = normalizeTestMessage2(source.testMessage);
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    bots,
    totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
    provisioning: source.provisioning ? normalizeProvisioning3(source.provisioning) : null,
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog),
    ...testMessage ? { testMessage } : {}
  };
}
function connectionTestFeedback2(result) {
  if (result?.sent === true) return "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230\u5BF9\u5E94\u673A\u5668\u4EBA\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002";
  if (result?.code === "test-target-unavailable") {
    return "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
  }
  return result ? "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002" : null;
}
function presentError4(error) {
  return {
    code: text3(error?.code, "QQ_ERROR", 80),
    message: text3(error?.message, "QQ \u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")
  };
}
function formatRemaining3(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1e3) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// plugin-src/client/channels/qq/index.js
var React14 = __toESM(require("react"), 1);

// plugin-src/client/channels/qq/styles.js
var QQ_STYLE_ID = "xmanrui-dsh-im-qq-settings";
var CSS4 = String.raw`
.dqq-page { --ddt-accent: #1677ff; --ddt-accent-deep: #0958d9; --ddt-accent-wash: #eaf3ff; }
.dqq-avatar, .dqq-brand { color: #fff; background: #1677ff; }
.dqq-avatar svg, .dqq-brand svg { display: block; }
`;
function installQqStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${QQ_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = QQ_STYLE_ID;
  style.textContent = CSS4;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/qq/index.js
var ACTIVE_STATES = /* @__PURE__ */ new Set(["pending", "refreshing", "connecting"]);
var Button7 = React14.forwardRef(function Button8({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `ddt-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function checkedTime3(value) {
  if (!value) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "\u521A\u521A";
  }
}
function Heading3({ totals, adding, busy, onAdd, onCredential, credentialOpen, addButtonRef }) {
  return h(
    "div",
    { className: "ddt-heading" },
    h(
      "div",
      { className: "ddt-tools" },
      h(
        "div",
        { className: "dim-bindActions" },
        h(Button7, {
          kind: "primary",
          className: "dim-scanButton",
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          "aria-label": "\u626B\u7801\u63A5\u5165 QQ \u673A\u5668\u4EBA",
          loading: adding
        }, h(QrActionIcon), "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA"),
        h(Button7, {
          kind: "credential",
          className: "dim-credentialButton",
          onClick: onCredential,
          disabled: adding || busy,
          "aria-pressed": credentialOpen,
          "aria-label": "\u4F7F\u7528 AppID \u548C AppSecret \u7ED1\u5B9A QQ \u673A\u5668\u4EBA"
        }, h(CredentialActionIcon), credentialOpen ? "\u6536\u8D77\u51ED\u636E" : "\u624B\u52A8\u63A5\u5165")
      ),
      totals.configured > 0 ? h(
        "div",
        { className: "ddt-badge dim-onlineBadge" },
        h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)
      ) : null
    )
  );
}
function LoadingView3() {
  return h(
    "div",
    { className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "ddt-spinner dim-spinner" }),
    h("span", null, "\u6B63\u5728\u8BFB\u53D6 QQ \u673A\u5668\u4EBA\u72B6\u6001\u2026")
  );
}
function EmptyView3({ busy, onStart }) {
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "dim-emptyCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u7ED1\u5B9A QQ \u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u4F7F\u7528\u624B\u673A QQ \u626B\u7801\u521B\u5EFA\u5E76\u7ED1\u5B9A\u673A\u5668\u4EBA"),
        h("p", null, "\u626B\u7801\u7531\u817E\u8BAF\u5B98\u65B9\u9875\u9762\u5B8C\u6210\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u586B\u5199 AppID \u6216 AppSecret\u3002\u626B\u7801\u6210\u529F\u540E\uFF0C\u673A\u5668\u4EBA\u4F1A\u81EA\u52A8\u8FDE\u63A5 DeepSeek Harness\u3002"),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(
            Button7,
            { kind: "primary", onClick: onStart, disabled: busy, loading: busy },
            "\u751F\u6210 QQ \u4E8C\u7EF4\u7801"
          )
        )
      ),
      h(
        "div",
        { className: "ddt-brandMark dim-emptyBrand dqq-brand", "aria-hidden": "true" },
        h(QqLogoGlyph, { size: 64 })
      )
    )
  );
}
function QrPanel2({ provision, now, busy, onRefresh, onCancel }) {
  const source = safeQrSource3(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const duration = Math.max(1, provision.durationMs ?? 5 * 6e4);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  const refreshing = provision.status === "refreshing";
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "ddt-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "ddt-qrFrame dim-qrFrame" },
          source ? h("img", { src: source, alt: "\u7528\u4E8E\u7ED1\u5B9A QQ \u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801" }) : h(
            "div",
            { className: "ddt-qrFallback dim-qrFallback" },
            refreshing ? "\u4E8C\u7EF4\u7801\u6B63\u5728\u81EA\u52A8\u5237\u65B0\u2026" : "\u4E8C\u7EF4\u7801\u56FE\u7247\u6B63\u5728\u751F\u6210\u2026"
          )
        ),
        h(
          "div",
          { className: "ddt-countdown dim-countdown" },
          h(
            "div",
            { className: "ddt-countdownTop dim-countdownTop" },
            h("span", null, "\u5F53\u524D\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, refreshing ? "--:--" : formatRemaining3(remaining))
          ),
          h("div", { className: "ddt-progress dim-progress", style: { "--ddt-progress": `${progress}%` } }, h("span"))
        )
      ),
      h(
        "div",
        { className: "ddt-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot", "data-tone": "warning" }),
          h("span", null, refreshing ? "\u6B63\u5728\u5237\u65B0\u4E8C\u7EF4\u7801" : "\u7B49\u5F85\u624B\u673A QQ \u626B\u7801")
        ),
        h("h3", null, "\u4F7F\u7528\u624B\u673A QQ \u5B8C\u6210\u673A\u5668\u4EBA\u7ED1\u5B9A"),
        h("p", null, "\u817E\u8BAF\u9875\u9762\u4F1A\u521B\u5EFA\u6216\u7ED1\u5B9A\u4E00\u4E2A QQ \u673A\u5668\u4EBA\uFF0C\u5E76\u628A\u8FDE\u63A5\u51ED\u636E\u5B89\u5168\u4EA4\u7ED9\u672C\u673A Harness Host\u3002"),
        h(
          "ol",
          { className: "ddt-steps dim-steps" },
          h("li", null, "\u6253\u5F00\u624B\u673A QQ\uFF0C\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801"),
          h("li", null, "\u5728\u817E\u8BAF\u6388\u6743\u9875\u9762\u786E\u8BA4\u521B\u5EFA\u6216\u7ED1\u5B9A\u673A\u5668\u4EBA"),
          h("li", null, "\u8FD4\u56DE\u8FD9\u91CC\u7B49\u5F85\u8FDE\u63A5\u5B8C\u6210")
        ),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(Button7, { onClick: onRefresh, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
          h(Button7, { kind: "quiet", onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
        )
      )
    )
  );
}
function ProvisionView({ provision, busy, onRetry, onClose }) {
  if (provision.status === "connecting") {
    return h(
      "div",
      { className: "ddt-card ddt-loading dim-surfaceCard dim-specialView", "aria-busy": "true" },
      h("div", { className: "ddt-spinner dim-spinner" }),
      h("h3", null, "QQ \u5DF2\u6388\u6743\uFF0C\u6B63\u5728\u8FDE\u63A5\u673A\u5668\u4EBA"),
      h("p", null, "\u51ED\u636E\u6B63\u5728\u5199\u5165\u672C\u673A\uFF0C\u5E76\u542F\u52A8 QQ WebSocket \u6D88\u606F\u8FDE\u63A5\u3002")
    );
  }
  const error = provision.error ?? { code: "QQ_PROVISION_FAILED", message: "QQ \u673A\u5668\u4EBA\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210" };
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-inlineError dim-inlineError", role: "alert" },
      h("h3", null, "QQ \u673A\u5668\u4EBA\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210"),
      h("p", null, error.message),
      h("span", { className: "ddt-errorCode" }, error.code),
      h(
        "div",
        { className: "ddt-actions dim-viewActions" },
        h(Button7, { kind: "primary", onClick: onRetry, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
        h(Button7, { onClick: onClose, disabled: busy }, "\u5173\u95ED")
      )
    )
  );
}
function RemoveConfirmation3({ account, busy, error, feedbackSequence, onConfirm, onCancel }) {
  return h(
    ConfirmDialog,
    { className: "ddt-confirm dim-confirm", role: "alertdialog", onClose: onCancel, busy: Boolean(busy), error, feedbackSequence },
    h("strong", null, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${account.bot.name}\u201D\uFF1F`),
    h("p", null, "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u817E\u8BAF\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002"),
    h(
      "div",
      { className: "ddt-actions dim-viewActions" },
      h(Button7, { onClick: onCancel, disabled: busy }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(Button7, { kind: "danger", onClick: onConfirm, disabled: busy, loading: busy }, "\u786E\u8BA4\u79FB\u9664\u63A5\u5165")
    )
  );
}
function AccountCard2({
  account,
  busy,
  feedback,
  removing,
  removeError,
  removeFeedbackSequence,
  onReconnect,
  onWorkspaceSave,
  onAgentPresetSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove
}) {
  const tone = account.connected ? "success" : account.state === "error" ? "error" : "warning";
  const stateLabel2 = account.connected ? "\u8FD0\u884C\u6B63\u5E38" : account.state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA";
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h(
    "article",
    { className: "ddt-card dim-botCard", "data-bot-id": account.botId },
    h(
      "div",
      { className: "ddt-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "ddt-accountTop dim-botCardTop" },
        h(
          "div",
          { className: "ddt-accountIdentity dim-botIdentity" },
          h("div", { className: "ddt-avatar dim-botAvatar dqq-avatar", "aria-hidden": "true" }, h(QqLogoGlyph, { size: 29 })),
          h(
            "div",
            { className: "dim-botName" },
            h("h3", null, account.bot.name),
            h("p", null, account.bot.appIdMasked)
          )
        ),
        h(BotStatusMeta, {
          className: "ddt-health",
          dotClassName: "ddt-dot",
          tone,
          stateLabel: stateLabel2,
          lastCheckedAt: account.health.lastCheckedAt,
          formatCheckedTime: checkedTime3
        })
      ),
      h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(
        "div",
        { className: "ddt-accountFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "ddt-actions dim-cardActions" },
            h(Button7, { className: "dim-cardAction", onClick: onReconnect, disabled: Boolean(busy), loading: busy === "reconnect" }, account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
            h(Button7, { className: "dim-cardAction", kind: "danger", onClick: onRequestRemove, disabled: Boolean(busy) }, "\u79FB\u9664\u63A5\u5165")
          ),
          summary ? h("div", { className: "ddt-summary dim-cardSummary" }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: "ddt-summary",
            error: account.lastMessageError
          }) : null,
          feedback ? h(FeedbackToast, { text: feedback }) : null
        )
      )
    ),
    removing ? h(RemoveConfirmation3, {
      account,
      busy: busy === "delete",
      error: removeError,
      feedbackSequence: removeFeedbackSequence,
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function QqSettingsTab({ rpcCall }) {
  const [model, setModel] = React14.useState({
    phase: "loading",
    bots: [],
    totals: { configured: 0, connected: 0 },
    error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [provision, setProvision] = React14.useState(null);
  const [busy, setBusy] = React14.useState(false);
  const [busyByBot, setBusyByBot] = React14.useState({});
  const [feedbackByBot, setFeedbackByBot] = React14.useState({});
  const [removeTarget, setRemoveTarget] = React14.useState(null);
  const [actionError, setActionError] = React14.useState(null);
  const [removeErrorsByBot, setRemoveErrorsByBot] = React14.useState({});
  const [credentialOpen, setCredentialOpen] = React14.useState(false);
  const [credentialError, setCredentialError] = React14.useState(null);
  const [now, setNow] = React14.useState(Date.now());
  const mounted = React14.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const addButtonRef = React14.useRef(null);
  React14.useEffect(() => {
    const disposeDingtalk = installDingtalkStyles();
    const disposeQq = installQqStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      disposeQq();
      disposeDingtalk();
    };
  }, []);
  const invoke = React14.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== "function") throw new TypeError("QQ \u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5");
    return unwrapRpcResult4(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const loadStatus = React14.useCallback(async ({ signal, silent = false, restore = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return void 0;
    if (!silent && mounted.current) setModel((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const snapshot = normalizeSnapshot3(await invoke(QQ_ENDPOINTS.status, {}, signal));
      if (!mounted.current || signal?.aborted || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      setModel({
        phase: "ready",
        bots: snapshot.bots,
        totals: snapshot.totals,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
      });
      if (restore && snapshot.provisioning) setProvision({
        ...snapshot.provisioning,
        durationMs: Math.max(1, snapshot.provisioning.expiresAt - Date.now())
      });
      return snapshot;
    } catch (error) {
      if (error?.name !== "AbortError" && mounted.current && !signal?.aborted && workspaceFence.canCommitStatus(workspaceVersion)) {
        setModel((current) => ({ ...current, phase: silent ? current.phase : "error", error: presentError4(error) }));
      }
      return void 0;
    }
  }, [invoke, workspaceFence]);
  React14.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restore: true });
    return () => controller.abort();
  }, [loadStatus]);
  React14.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => void loadStatus({ signal: controller.signal, silent: true }), 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React14.useEffect(() => {
    if (!provision || !ACTIVE_STATES.has(provision.status)) return void 0;
    const timer = window.setInterval(() => mounted.current && setNow(Date.now()), 1e3);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);
  const startProvisioning = React14.useCallback(async (replace = false) => {
    setCredentialOpen(false);
    setCredentialError(null);
    setBusy(true);
    try {
      if (replace && provision?.attemptId) await invoke(QQ_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      if (!mounted.current) return;
      setProvision({ status: "starting" });
      const started = normalizeProvisioning3(await invoke(QQ_ENDPOINTS.beginProvisioning, { locale: "zh-CN" }));
      if (!mounted.current) return;
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
    } catch (error) {
      if (mounted.current) setProvision({ status: "failed", error: presentError4(error) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId]);
  const bindCredentials = React14.useCallback(async ({ identity, secret }) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeSnapshot3(await invoke(
        QQ_ENDPOINTS.bindCredentials,
        { appId: identity, appSecret: secret }
      ));
      if (!mounted.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
      setCredentialOpen(false);
    } catch (error) {
      if (mounted.current) setCredentialError(presentError4(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusy(false);
    }
  }, [invoke, loadStatus, workspaceFence]);
  const closeProvision = React14.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && ACTIVE_STATES.has(provision.status)) {
        await invoke(QQ_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      if (mounted.current) {
        setProvision(null);
        setActionError(null);
      }
    } catch (cause) {
      if (mounted.current) setActionError((current) => ({
        message: cause?.message ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
        sequence: (current?.sequence ?? 0) + 1
      }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId, provision?.status]);
  React14.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_STATES.has(provision.status)) return void 0;
    const controller = new AbortController();
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const current = normalizeProvisioning3(await invoke(QQ_ENDPOINTS.pollProvisioning, { attemptId }, controller.signal));
        if (disposed || controller.signal.aborted || !mounted.current) return;
        if (current.status === "connected") {
          setProvision(null);
          await loadStatus({ signal: controller.signal, silent: true });
          return;
        }
        setProvision((previous) => previous?.attemptId === attemptId ? { ...previous, ...current, durationMs: current.qrRevision !== previous.qrRevision ? Math.max(1, current.expiresAt - Date.now()) : previous.durationMs } : previous);
        if (ACTIVE_STATES.has(current.status)) timer = window.setTimeout(poll, current.pollIntervalMs);
      } catch (error) {
        if (!disposed && !controller.signal.aborted && mounted.current) {
          setProvision((current) => ({ ...current, status: "failed", error: presentError4(error) }));
        }
      }
    };
    timer = window.setTimeout(poll, provision.pollIntervalMs ?? 1e3);
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [invoke, loadStatus, provision?.attemptId, provision?.pollIntervalMs, provision?.status]);
  const botAction = React14.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusyByBot((current) => ({ ...current, [account.botId]: operation }));
    try {
      const snapshot = normalizeSnapshot3(await invoke(endpoint, payload));
      if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
      return snapshot;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusyByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
  }, [invoke, loadStatus, workspaceFence]);
  const reconnect = React14.useCallback(async (account) => {
    setFeedbackByBot((current) => {
      const next = { ...current };
      delete next[account.botId];
      return next;
    });
    try {
      const snapshot = await botAction(
        account,
        "reconnect",
        QQ_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true }
      );
      if (mounted.current) {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: connectionTestFeedback2(snapshot?.testMessage)
        }));
      }
    } catch {
      if (mounted.current) {
        setFeedbackByBot((current) => ({
          ...current,
          [account.botId]: "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
        }));
      }
    }
  }, [botAction]);
  let provisionView = null;
  if (provision?.status === "starting") provisionView = h("div", { className: "ddt-card ddt-loading dim-surfaceCard" }, h("div", { className: "ddt-spinner" }), "\u6B63\u5728\u7533\u8BF7 QQ \u4E8C\u7EF4\u7801\u2026");
  else if (["pending", "refreshing"].includes(provision?.status)) provisionView = h(QrPanel2, {
    provision,
    now,
    busy,
    onRefresh: () => void startProvisioning(true),
    onCancel: () => void closeProvision()
  });
  else if (provision) provisionView = h(ProvisionView, {
    provision,
    busy,
    onRetry: () => void startProvisioning(true),
    onClose: () => void closeProvision()
  });
  const botList = model.bots.length > 0 ? h(
    "section",
    { className: "dim-listSection" },
    h(ChannelListHeading, {
      className: "ddt-listHeading",
      title: "\u5DF2\u7ED1\u5B9A\u7684 QQ \u673A\u5668\u4EBA",
      connectionLabel: "WebSocket \u957F\u8FDE\u63A5"
    }),
    h("ul", { className: "ddt-list dim-botList" }, model.bots.map((account) => h("li", { key: account.botId }, h(AccountCard2, {
      account,
      busy: busyByBot[account.botId],
      feedback: feedbackByBot[account.botId],
      removing: removeTarget === account.botId,
      removeError: removeErrorsByBot[account.botId]?.message,
      removeFeedbackSequence: removeErrorsByBot[account.botId]?.sequence,
      onReconnect: () => void reconnect(account),
      onWorkspaceSave: (workspace) => botAction(
        account,
        "workspace",
        QQ_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace }
      ),
      onAgentPresetSave: (agentPreset) => botAction(
        account,
        "preset",
        QQ_ENDPOINTS.setAgentPreset,
        { botId: account.botId, agentPreset }
      ),
      onRequestRemove: () => setRemoveTarget(account.botId),
      onCancelRemove: () => setRemoveTarget(null),
      onConfirmRemove: async () => {
        try {
          await botAction(account, "delete", QQ_ENDPOINTS.deleteBot, { botId: account.botId, confirm: true });
          if (mounted.current) {
            setRemoveTarget(null);
            setRemoveErrorsByBot((current) => {
              const next = { ...current };
              delete next[account.botId];
              return next;
            });
          }
        } catch (cause) {
          if (mounted.current) setRemoveErrorsByBot((current) => ({
            ...current,
            [account.botId]: {
              message: cause?.message ?? "\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
              sequence: (current[account.botId]?.sequence ?? 0) + 1
            }
          }));
        }
      }
    }))))
  ) : null;
  const credentialView = credentialOpen ? h(CredentialBindingPanel, {
    channel: "QQ",
    identityLabel: "AppID",
    identityPlaceholder: "\u586B\u5199 QQ \u5F00\u653E\u5E73\u53F0 AppID",
    secretLabel: "AppSecret",
    secretPlaceholder: "\u586B\u5199 QQ \u5F00\u653E\u5E73\u53F0 AppSecret",
    busy,
    error: credentialError,
    onSubmit: bindCredentials,
    onCancel: () => {
      setCredentialOpen(false);
      setCredentialError(null);
    }
  }) : null;
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    { className: "ddt-page dqq-page dim-channelPage", "aria-label": "QQ \u8BBE\u7F6E" },
    actionError ? h(FeedbackToast, { text: actionError.message, tone: "error", sequence: actionError.sequence }) : null,
    Object.entries(removeErrorsByBot).map(([botId, failure]) => botId !== removeTarget ? h(FeedbackToast, { key: botId, text: failure.message, tone: "error", sequence: failure.sequence }) : null),
    h(Heading3, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      onCredential: () => {
        setCredentialOpen((value) => !value);
        setCredentialError(null);
      },
      credentialOpen,
      addButtonRef
    }),
    model.phase === "loading" ? h(LoadingView3) : model.phase === "error" ? h("div", { className: "ddt-card dim-surfaceCard" }, h("div", { className: "ddt-inlineError dim-inlineError" }, h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6 QQ \u673A\u5668\u4EBA\u72B6\u6001"), h("p", null, model.error?.message), h(Button7, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6"))) : h(
      React14.Fragment,
      null,
      credentialView,
      provisionView,
      model.bots.length === 0 && !provision && !credentialOpen ? h(EmptyView3, { busy, onStart: () => void startProvisioning() }) : null,
      botList
    )
  ));
}

// src/channels/office/protocol.mjs
var OFFICE_PROTOCOL_VERSION = "office-harness.v1";
var OFFICE_RPC_CHANNEL = "/office";
var OFFICE_RPC_ENDPOINTS = Object.freeze({
  status: "connection.status",
  configure: "connector.configure",
  reconnect: "connector.reconnect",
  test: "connector.test",
  remove: "connector.remove"
});
var OFFICE_HOOK_PATHS = Object.freeze({
  stream: "/api/harness/connector/stream",
  heartbeat: "/api/harness/connector/heartbeat",
  job: "/api/harness/connector/jobs/:id",
  accept: "/api/harness/connector/jobs/:id/accept",
  renew: "/api/harness/connector/jobs/:id/renew",
  progress: "/api/harness/connector/jobs/:id/progress",
  approval: "/api/harness/connector/jobs/:id/approval",
  result: "/api/harness/connector/jobs/:id/result",
  fail: "/api/harness/connector/jobs/:id/fail"
});
function normalizeOfficeBaseUrl(value) {
  const url = new URL(typeof value === "string" ? value.trim() : "");
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("AI Office URL must use HTTPS (HTTP is allowed only for loopback testing)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("AI Office URL must be a bare origin");
  }
  url.pathname = "/";
  return url;
}
function officeHookUrls(baseUrl) {
  const origin = normalizeOfficeBaseUrl(baseUrl);
  return Object.fromEntries(Object.entries(OFFICE_HOOK_PATHS).map(([name2, path]) => [
    name2,
    new URL(path, origin).toString()
  ]));
}

// plugin-src/client/channels/office/api.js
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unwrapOfficeRpc(result) {
  if (!record(result) || typeof result.ok !== "boolean") throw new Error("AI Office \u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  if (!result.ok) {
    const error = new Error(typeof result.error?.message === "string" ? result.error.message : "AI Office \u64CD\u4F5C\u5931\u8D25");
    error.code = typeof result.error?.code === "string" ? result.error.code : "office-rpc-error";
    throw error;
  }
  return result.value;
}
function normalizeOfficeStatus(value) {
  if (!record(value) || value.configured !== true) {
    return { configured: false, connected: false, state: "unconfigured", config: null, health: null };
  }
  const config = record(value.config) ? value.config : {};
  return {
    configured: true,
    connected: value.connected === true,
    state: typeof value.state === "string" ? value.state : "idle",
    tokenConfigured: value.tokenConfigured === true,
    config: {
      protocolVersion: config.protocolVersion ?? OFFICE_PROTOCOL_VERSION,
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
      deviceId: typeof config.deviceId === "string" ? config.deviceId : "",
      maxConcurrency: Number(config.maxConcurrency ?? 1),
      heartbeatSeconds: Number(config.heartbeatSeconds ?? 30),
      workspaces: record(config.workspaces) ? config.workspaces : {},
      instructionPresets: record(config.instructionPresets) ? config.instructionPresets : {},
      hooks: record(config.hooks) ? config.hooks : {}
    },
    health: record(value.health) ? value.health : null
  };
}

// plugin-src/client/channels/office/index.js
var React15 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
function Button9({ children, kind = "secondary", ...props }) {
  return h(import_dsh_client_ui_primitives3.Button, { ...props, variant: kind === "primary" ? "primary" : "outline", type: "button", className: "ddt-button", "data-kind": kind }, children);
}
function mapText(value) {
  return Object.entries(value ?? {}).map(([key, item]) => `${key}=${item}`).join("\n");
}
function parseMap(value, label) {
  const output = {};
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf("=");
    if (index < 1 || !line.slice(index + 1).trim()) {
      throw new Error(label === "Workspace \u6620\u5C04" ? "Workspace \u6620\u5C04\u6BCF\u884C\u5FC5\u987B\u4F7F\u7528 alias=value" : "Instruction Preset \u6620\u5C04\u6BCF\u884C\u5FC5\u987B\u4F7F\u7528 alias=value");
    }
    output[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return output;
}
function stateLabel(model) {
  if (model.connected) return "\u5DF2\u8FDE\u63A5 Office";
  if (!model.configured) return "\u5C1A\u672A\u914D\u7F6E";
  if (model.state === "connecting") return "\u6B63\u5728\u8FDE\u63A5";
  if (model.state === "reconnecting") return "\u7B49\u5F85\u91CD\u8FDE";
  if (model.state === "missing-token") return "\u51ED\u636E\u7F3A\u5931";
  return "\u5DF2\u914D\u7F6E";
}
function OfficeSettingsTab({ rpcCall, initialStatus }) {
  const [model, setModel] = React15.useState(normalizeOfficeStatus(initialStatus));
  const [phase, setPhase] = React15.useState(initialStatus === void 0 ? "loading" : "ready");
  const [busy, setBusy] = React15.useState("");
  const [feedbackSequence, setFeedbackSequence] = React15.useState(0);
  const [error, setError] = React15.useState("");
  const [notice, setNotice] = React15.useState("");
  const [form, setForm] = React15.useState({
    baseUrl: "",
    deviceId: "local-harness",
    deviceToken: "",
    maxConcurrency: "1",
    heartbeatSeconds: "30",
    workspaces: "",
    instructionPresets: ""
  });
  const invoke = React15.useCallback(async (endpoint, payload = {}) => {
    if (typeof rpcCall !== "function") throw new Error("AI Office \u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5");
    return unwrapOfficeRpc(await rpcCall(endpoint, payload));
  }, [rpcCall]);
  const adopt = React15.useCallback((value) => {
    const next = normalizeOfficeStatus(value?.snapshot ?? value);
    setModel(next);
    if (next.config) setForm((current) => ({
      ...current,
      baseUrl: next.config.baseUrl,
      deviceId: next.config.deviceId,
      maxConcurrency: String(next.config.maxConcurrency),
      heartbeatSeconds: String(next.config.heartbeatSeconds),
      workspaces: mapText(next.config.workspaces),
      instructionPresets: mapText(next.config.instructionPresets),
      deviceToken: ""
    }));
    return next;
  }, []);
  const load = React15.useCallback(async () => {
    try {
      adopt(await invoke(OFFICE_RPC_ENDPOINTS.status));
      setPhase("ready");
      setError("");
    } catch (caught) {
      setPhase("error");
      setError(caught.message);
    }
  }, [adopt, invoke]);
  React15.useEffect(() => {
    void load();
  }, [load]);
  const run = async (name2, operation) => {
    if (busy) return;
    setFeedbackSequence((current) => current + 1);
    setBusy(name2);
    setError("");
    setNotice("");
    try {
      const value = await operation();
      const next = adopt(value);
      if (name2 === "test") {
        if (value?.tested !== true) throw new Error("\u8FDE\u63A5\u6D4B\u8BD5\u672A\u786E\u8BA4\u5B8C\u6210\u3002");
        setNotice("\u8FDE\u63A5\u6D4B\u8BD5\u901A\u8FC7\u3002");
      } else if (name2 === "remove") {
        if (next.configured) throw new Error("\u8FDE\u63A5\u914D\u7F6E\u5C1A\u672A\u79FB\u9664\u3002");
        setNotice("\u8FDE\u63A5\u5DF2\u79FB\u9664\u3002");
      } else if (name2 === "reconnect") {
        setNotice(next.connected ? "\u5DF2\u91CD\u65B0\u8FDE\u63A5 Office\u3002" : "\u5DF2\u53D1\u8D77\u91CD\u65B0\u8FDE\u63A5\uFF0COffice \u5C1A\u672A\u8FDE\u63A5\u3002");
      } else {
        setNotice(next.connected ? "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0COffice \u5DF2\u8FDE\u63A5\u3002" : "\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0COffice \u5C1A\u672A\u8FDE\u63A5\u3002");
      }
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy("");
    }
  };
  const hooks = React15.useMemo(() => {
    try {
      return officeHookUrls(form.baseUrl);
    } catch {
      return {};
    }
  }, [form.baseUrl]);
  const health = model.health ?? {};
  const feedbackError = error || health.error?.message;
  if (phase === "loading") return h("div", { className: "ddt-card ddt-loading", "aria-busy": "true" }, "\u6B63\u5728\u8BFB\u53D6 AI Office Connector\u2026");
  return h(
    "section",
    { className: "dof-page", "aria-label": "AI Office \u8BBE\u7F6E" },
    h(
      "div",
      { className: "dof-hero" },
      h(
        "div",
        { className: "dof-heroCopy" },
        h("h3", null, "AI Office Connector"),
        h("p", null, "\u672C\u673A\u4E3B\u52A8\u8FDE\u63A5\u516C\u7F51 Office\uFF1BHarness \u4E0D\u5F00\u653E\u7AEF\u53E3\u3002\u534F\u8BAE Hook \u56FA\u5B9A\u4E3A ", OFFICE_PROTOCOL_VERSION, "\u3002")
      ),
      h(
        "span",
        { className: "dof-status", "data-connected": String(model.connected) },
        h("span", { className: "dof-dot" }),
        stateLabel(model)
      )
    ),
    model.configured ? h(
      "div",
      { className: "dof-metrics" },
      h("div", { className: "dof-metric" }, h("span", null, "\u6700\u8FD1\u5FC3\u8DF3"), h("strong", null, health.lastHeartbeatAt ?? "\u5C1A\u65E0")),
      h("div", { className: "dof-metric" }, h("span", null, "\u6700\u8FD1\u4E8B\u4EF6"), h("strong", null, health.lastEventType ?? "\u5C1A\u65E0")),
      h("div", { className: "dof-metric" }, h("span", null, "\u91CD\u8FDE\u6B21\u6570"), h("strong", null, String(health.reconnects ?? 0))),
      h("div", { className: "dof-metric" }, h("span", null, "Job Offer"), h("strong", null, String(health.jobsOffered ?? 0))),
      h("div", { className: "dof-metric" }, h("span", null, "\u8FD0\u884C Job"), h("strong", null, String(health.jobs?.running ?? 0))),
      h("div", { className: "dof-metric" }, h("span", null, "\u5B8C\u6210 Job"), h("strong", null, String(health.jobs?.completed ?? 0)))
    ) : null,
    h(
      "div",
      { className: "dof-card" },
      h("div", { className: "dof-cardTitle" }, h("h4", null, "\u8BBE\u5907\u8FDE\u63A5"), h("span", null, "Token \u53EA\u5199\u5165\u672C\u673A\u51ED\u636E\u5B58\u50A8")),
      h(
        "div",
        { className: "dof-grid" },
        h(
          "label",
          { className: "dof-field", "data-wide": "true" },
          "Office Base URL",
          h("input", { value: form.baseUrl, placeholder: "https://office.example.com", onChange: (event) => setForm({ ...form, baseUrl: event.target.value }) })
        ),
        h(
          "label",
          { className: "dof-field" },
          "Device ID",
          h("input", { value: form.deviceId, placeholder: "local-harness", onChange: (event) => setForm({ ...form, deviceId: event.target.value }) })
        ),
        h(
          "label",
          { className: "dof-field" },
          "Device Token",
          h("input", { type: "password", value: form.deviceToken, placeholder: model.tokenConfigured ? "\u5DF2\u5B89\u5168\u4FDD\u5B58\uFF1B\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8" : "\u7C98\u8D34 Office \u4E00\u6B21\u6027\u51ED\u636E", autoComplete: "new-password", onChange: (event) => setForm({ ...form, deviceToken: event.target.value }) })
        ),
        h(
          "label",
          { className: "dof-field" },
          "\u6700\u5927\u5E76\u53D1",
          h("input", { type: "number", min: 1, max: 4, value: form.maxConcurrency, onChange: (event) => setForm({ ...form, maxConcurrency: event.target.value }) })
        ),
        h(
          "label",
          { className: "dof-field" },
          "Heartbeat \u79D2\u6570",
          h("input", { type: "number", min: 10, max: 300, value: form.heartbeatSeconds, onChange: (event) => setForm({ ...form, heartbeatSeconds: event.target.value }) })
        ),
        h(
          "label",
          { className: "dof-field", "data-wide": "true" },
          "Workspace \u6620\u5C04",
          h("textarea", { value: form.workspaces, placeholder: "office-project=/Users/you/projects/ai-office", onChange: (event) => setForm({ ...form, workspaces: event.target.value }) }),
          h("small", null, "\u6BCF\u884C alias=/\u672C\u673A/\u7EDD\u5BF9\u8DEF\u5F84\uFF1BOffice \u53EA\u80FD\u770B\u5230 alias\u3002")
        ),
        h(
          "label",
          { className: "dof-field", "data-wide": "true" },
          "Instruction Preset \u6620\u5C04",
          h("textarea", { value: form.instructionPresets, placeholder: "action-items=\u8F6C\u6362\u4E3A\u8D1F\u8D23\u4EBA\u3001\u622A\u6B62\u548C\u9A8C\u6536\u660E\u786E\u7684\u5DE5\u5355", onChange: (event) => setForm({ ...form, instructionPresets: event.target.value }) }),
          h("small", null, "\u6BCF\u884C alias=\u6307\u4EE4\uFF1B\u65B0\u589E preset \u4E0D\u9700\u8981\u6539 Office \u4EE3\u7801\u3002")
        )
      ),
      feedbackError ? h(FeedbackToast, { text: feedbackError, tone: "error", sequence: feedbackSequence }) : notice ? h(FeedbackToast, { text: notice, holdMs: 6e3 }) : null,
      h(
        "div",
        { className: "dof-actions" },
        h(Button9, { kind: "primary", disabled: Boolean(busy), onClick: () => void run("save", () => invoke(OFFICE_RPC_ENDPOINTS.configure, {
          baseUrl: form.baseUrl,
          deviceId: form.deviceId,
          ...form.deviceToken ? { deviceToken: form.deviceToken } : {},
          maxConcurrency: Number(form.maxConcurrency),
          heartbeatSeconds: Number(form.heartbeatSeconds),
          workspaces: parseMap(form.workspaces, "Workspace \u6620\u5C04"),
          instructionPresets: parseMap(form.instructionPresets, "Instruction Preset \u6620\u5C04")
        })), loading: busy === "save" }, "\u4FDD\u5B58\u5E76\u8FDE\u63A5"),
        h(Button9, { disabled: !model.configured || Boolean(busy), onClick: () => void run("test", () => invoke(OFFICE_RPC_ENDPOINTS.test)), loading: busy === "test" }, "\u6D4B\u8BD5\u8FDE\u63A5"),
        h(Button9, { disabled: !model.configured || Boolean(busy), loading: busy === "reconnect", onClick: () => void run("reconnect", () => invoke(OFFICE_RPC_ENDPOINTS.reconnect)) }, "\u91CD\u65B0\u8FDE\u63A5"),
        h(Button9, { kind: "danger", disabled: !model.configured || Boolean(busy), loading: busy === "remove", onClick: () => void run("remove", () => invoke(OFFICE_RPC_ENDPOINTS.remove, { confirm: true })) }, "\u79FB\u9664\u8FDE\u63A5")
      )
    ),
    h(
      "div",
      { className: "dof-card" },
      h("div", { className: "dof-cardTitle" }, h("h4", null, "\u534F\u8BAE Hook \u9884\u89C8"), h("span", null, "\u7531 Base URL \u81EA\u52A8\u6D3E\u751F\uFF0C\u4E0D\u5355\u72EC\u586B\u5199")),
      h(
        "div",
        { className: "dof-hooks" },
        [["SSE", hooks.stream], ["Heartbeat", hooks.heartbeat], ["Job", hooks.job], ["Result", hooks.result]].map(([label, url]) => h("div", { className: "dof-hook", key: label }, h("strong", null, label), h("code", null, url ?? "Base URL \u65E0\u6548")))
      )
    ),
    h("p", { className: "dof-notice" }, "Office Hook \u5C1A\u672A\u90E8\u7F72\u65F6\uFF0C\u914D\u7F6E\u4F1A\u5B89\u5168\u4FDD\u5B58\u5E76\u81EA\u52A8\u91CD\u8BD5\uFF1B\u51FA\u73B0 HTTP 404 \u4EE3\u8868\u534F\u8BAE\u7AEF\u70B9\u5F85\u4E0A\u7EBF\uFF0C\u4E0D\u4EE3\u8868 Harness \u6545\u969C\u3002")
  );
}

// plugin-src/client/channels/office/styles.js
var OFFICE_STYLE_ID = "xmanrui-dsh-im-office-settings";
var CSS5 = `
.dof-page { --dof-accent: var(--dsw-alias-brand-primary, #3964fe); }
.dof-hero { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin-bottom: 12px; padding: 18px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 16px; background: linear-gradient(135deg, color-mix(in srgb, var(--dof-accent) 9%, var(--dsw-alias-bg-layer-1, #fff)), var(--dsw-alias-bg-layer-1, #fff) 62%); }
.dof-hero::after { content: ""; position: absolute; width: 150px; height: 150px; right: -75px; top: -90px; border: 24px solid color-mix(in srgb, var(--dof-accent) 12%, transparent); border-radius: 50%; pointer-events: none; }
.dof-heroCopy { min-width: 0; }
.dof-heroCopy h3 { margin: 0; color: var(--dsw-alias-label-primary, #1f2329); font-size: 17px; line-height: 1.35; }
.dof-heroCopy p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.6; }
.dof-status { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 999px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; white-space: nowrap; }
.dof-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary, #d97706); }
.dof-status[data-connected="true"] .dof-dot { background: var(--dsw-alias-state-success-primary, #20a162); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #20a162) 14%, transparent); }
.dof-card { margin-top: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 14px; background: var(--dsw-alias-bg-layer-1, #fff); }
.dof-cardTitle { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 12px; }
.dof-cardTitle h4 { margin: 0; color: var(--dsw-alias-label-primary, #1f2329); font-size: 14px; }
.dof-cardTitle span { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; }
.dof-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dof-field { min-width: 0; display: flex; flex-direction: column; gap: 6px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.dof-field[data-wide="true"] { grid-column: 1 / -1; }
.dof-field input, .dof-field textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1f2329); font: inherit; font-size: 13px; line-height: 1.5; outline: none; }
.dof-field input { height: 38px; padding: 0 11px; }
.dof-field textarea { min-height: 86px; resize: vertical; padding: 9px 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dof-field input:focus, .dof-field textarea:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); }
.dof-field small { color: var(--dsw-alias-label-tertiary, #8f959e); line-height: 1.45; }
.dof-hooks { display: grid; gap: 7px; }
.dof-hook { min-width: 0; display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px 10px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-hook strong { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; }
.dof-hook code { overflow: hidden; color: var(--dsw-alias-label-primary, #1f2329); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dof-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.dof-actions .ddt-button[data-kind="primary"] { height: 36px; padding: 0 14px; border: none; border-radius: 18px; color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); box-shadow: none; }
.dof-actions .ddt-button[data-kind="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dof-error, .dof-notice { margin: 10px 0 0; padding: 9px 11px; border-radius: 9px; font-size: 12px; line-height: 1.5; }
.dof-error { color: var(--dsw-alias-state-error-primary, #d54941); background: var(--dsw-alias-state-error-secondary, #fff0ef); }
.dof-notice { color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.dof-metric { min-width: 0; padding: 9px; border-radius: 10px; background: var(--dsw-alias-interactive-bg-hover, #f7f8fa); }
.dof-metric span { display: block; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 10px; }
.dof-metric strong { display: block; overflow: hidden; margin-top: 4px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
@container (max-width: 680px) { .dof-grid { grid-template-columns: minmax(0, 1fr); } .dof-field[data-wide="true"] { grid-column: auto; } .dof-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .dof-page * { transition: none !important; } }
`;
function installOfficeStyles() {
  if (typeof document === "undefined") return () => {
  };
  if (document.querySelector(`style[data-plugin-css="${OFFICE_STYLE_ID}"]`)) return () => {
  };
  const style = document.createElement("style");
  style.dataset.pluginCss = OFFICE_STYLE_ID;
  style.textContent = CSS5;
  document.head.append(style);
  return () => style.remove();
}

// plugin-src/client/channels/slack/api.js
var SLACK_RPC_CHANNEL = "/slack";
var SLACK_ENDPOINTS = TOKEN_BOT_ENDPOINTS;
var api2 = createTokenChannelApi("Slack", " Socket Mode \u957F\u8FDE\u63A5");
var unwrapRpcResult5 = api2.unwrapRpcResult;
var normalizeSnapshot4 = api2.normalizeSnapshot;
var presentError5 = api2.presentError;

// plugin-src/client/channels/slack/index.js
var React16 = __toESM(require("react"), 1);

// src/channels/slack/manifest.mjs
var SLACK_APP_MANIFEST_YAML = `_metadata:
  major_version: 1
display_information:
  name: DeepSeek Harness
  description: Connect Slack conversations to a local DeepSeek Harness agent.
  background_color: "#4A154B"
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: DeepSeek Harness
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - files:read
      - files:write
      - im:history
      - reactions:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
`;
var SLACK_CREATE_APP_URL = "https://api.slack.com/apps?new_app=1";

// plugin-src/client/channels/slack/styles.js
var SLACK_STYLE_ID = "xmanrui-dsh-im-slack-settings";
var CSS6 = String.raw`
.dsl-page { --ddt-accent: #4a154b; --ddt-accent-deep: #321033; --ddt-accent-wash: #f7eef7; }
.dsl-avatar { color: #fff; background: #4a154b; }
.dsl-avatar svg { display: block; }
.dsl-setup { display: grid; gap: 18px; }
.dsl-guide { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 18px; padding: 16px; border: 1px solid color-mix(in srgb, #4a154b 18%, var(--dsw-alias-border-l2, #e5e6eb)); border-radius: 11px; background: color-mix(in srgb, #4a154b 4%, var(--dsw-alias-bg-layer-1, #fff)); }
.dsl-guideCopy { min-width: 0; }
.dsl-guideCopy strong { display: block; margin-bottom: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 13px; }
.dsl-guideCopy p { margin: 0; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.6; }
.dsl-guideActions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.dsl-guideActions .ddt-button { white-space: nowrap; }
.dsl-copyState { color: var(--dsw-alias-state-success-primary, #20a162); }
.dsl-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dsl-tokenHint { grid-column: 1 / -1; margin: -4px 0 0; color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 11px; line-height: 1.55; }
@container (max-width: 680px) {
  .dsl-guide { grid-template-columns: minmax(0, 1fr); }
  .dsl-guideActions { justify-content: flex-start; }
  .dsl-fields { grid-template-columns: minmax(0, 1fr); }
}
`;
function installSlackStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${SLACK_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = SLACK_STYLE_ID;
  style.textContent = CSS6;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/slack/index.js
function SlackCredentialPanel({ busy, error, onSubmit, onCancel }) {
  const [botToken, setBotToken] = React16.useState("");
  const [appToken, setAppToken] = React16.useState("");
  const [copied, setCopied] = React16.useState(false);
  const [copying, setCopying] = React16.useState(false);
  const [copyError, setCopyError] = React16.useState(null);
  const headingId = React16.useId();
  const copyManifest = async () => {
    if (copying) return;
    setCopying(true);
    setCopyError(null);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(SLACK_APP_MANIFEST_YAML);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2e3);
    } catch (cause) {
      setCopied(false);
      setCopyError(cause?.message ?? "\u65E0\u6CD5\u5199\u5165\u526A\u8D34\u677F");
    } finally {
      setCopying(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    const normalizedBotToken = botToken.trim();
    const normalizedAppToken = appToken.trim();
    if (!normalizedBotToken || !normalizedAppToken || busy) return;
    void onSubmit?.({ botToken: normalizedBotToken, appToken: normalizedAppToken });
  };
  return h(
    "section",
    {
      className: "ddt-card dim-surfaceCard dim-credentialPanel dsl-setup",
      "aria-labelledby": headingId
    },
    h("h3", { id: headingId, className: "dim-credentialTitle" }, "\u63A5\u5165 Slack \u673A\u5668\u4EBA"),
    h(
      "div",
      { className: "dsl-guide" },
      h(
        "div",
        { className: "dsl-guideCopy" },
        h("strong", null, "\u5148\u7528 Manifest \u521B\u5EFA\u5E76\u914D\u7F6E Slack App"),
        h("p", null, "\u590D\u5236\u914D\u7F6E\u540E\uFF0C\u5728 Slack \u9009\u62E9 From a manifest\uFF1B\u521B\u5EFA\u5B8C\u6210\u540E\u751F\u6210 connections:write App Token\uFF0C\u5E76\u5C06\u5E94\u7528\u5B89\u88C5\u5230\u5DE5\u4F5C\u533A\u3002")
      ),
      h(
        "div",
        { className: "dsl-guideActions" },
        h(ActionButton, {
          type: "button",
          className: "ddt-button",
          onClick: () => void copyManifest(),
          disabled: busy || copying,
          loading: copying
        }, copied ? h("span", { className: "dsl-copyState" }, "\u5DF2\u590D\u5236 Manifest") : "\u590D\u5236 Manifest"),
        copyError ? h(FeedbackToast, { text: copyError, tone: "error" }) : null,
        h("a", {
          className: "ddt-button",
          href: SLACK_CREATE_APP_URL,
          target: "_blank",
          rel: "noreferrer"
        }, "\u6253\u5F00 Slack \u521B\u5EFA\u9875")
      )
    ),
    h(
      "form",
      { className: "dim-credentialForm dim-credentialFormSingle", onSubmit: submit },
      h(
        "div",
        { className: "dsl-fields" },
        h(
          "label",
          { className: "dim-credentialField" },
          h("span", null, "Bot Token"),
          h("input", {
            type: "password",
            value: botToken,
            onChange: (event) => setBotToken(event.target.value),
            placeholder: "xoxb-\u2026",
            maxLength: 4096,
            autoCapitalize: "none",
            autoCorrect: "off",
            spellCheck: false,
            autoComplete: "new-password",
            disabled: busy,
            required: true
          })
        ),
        h(
          "label",
          { className: "dim-credentialField" },
          h("span", null, "App Token"),
          h("input", {
            type: "password",
            value: appToken,
            onChange: (event) => setAppToken(event.target.value),
            placeholder: "xapp-\u2026",
            maxLength: 4096,
            autoCapitalize: "none",
            autoCorrect: "off",
            spellCheck: false,
            autoComplete: "new-password",
            disabled: busy,
            required: true
          })
        ),
        h("p", { className: "dsl-tokenHint" }, "Bot Token \u6765\u81EA OAuth & Permissions\uFF1BApp Token \u6765\u81EA Basic Information\uFF0C\u5E76\u4E14\u5FC5\u987B\u5305\u542B connections:write\u3002")
      ),
      error ? h(FeedbackToast, { text: error.message ?? String(error), tone: "error" }) : null,
      h(
        "div",
        { className: "ddt-actions dim-viewActions dim-credentialActions" },
        h(ActionButton, {
          type: "submit",
          className: "ddt-button",
          "data-kind": "primary",
          disabled: busy || !botToken.trim() || !appToken.trim(),
          loading: busy
        }, "\u9A8C\u8BC1\u5E76\u8FDE\u63A5"),
        h("button", {
          type: "button",
          className: "ddt-button",
          onClick: onCancel,
          disabled: busy
        }, "\u53D6\u6D88")
      )
    )
  );
}
var channel2 = createTokenChannelSettings({
  channel: "Slack",
  endpoints: SLACK_ENDPOINTS,
  api: api2,
  LogoGlyph: SlackLogoGlyph,
  installStyles: installSlackStyles,
  pageClass: "dsl-page",
  avatarClass: "dsl-avatar",
  connectionLabel: "Socket Mode \u957F\u8FDE\u63A5",
  emptyTitle: "\u63A5\u5165 Slack \u673A\u5668\u4EBA",
  emptyDescription: "\u4F7F\u7528\u5B98\u65B9 App Manifest \u5FEB\u901F\u914D\u7F6E\u673A\u5668\u4EBA\uFF0C\u518D\u586B\u5199 Bot Token \u4E0E App Token \u5EFA\u7ACB\u672C\u5730 Socket Mode \u8FDE\u63A5\u3002",
  platformLabel: "Slack \u5DE5\u4F5C\u533A",
  CredentialPanel: SlackCredentialPanel,
  credentialPayload: ({ botToken, appToken }) => ({ botToken, appToken }),
  credentialAriaLabel: "\u4F7F\u7528 Manifest \u548C\u53CC Token \u63A5\u5165 Slack \u673A\u5668\u4EBA",
  credentialOpenLabel: "\u63A5\u5165\u673A\u5668\u4EBA",
  credentialCloseLabel: "\u6536\u8D77\u63A5\u5165",
  credentialNoun: "Bot Token \u4E0E App Token",
  emptyActionLabel: "\u5F00\u59CB\u63A5\u5165"
});
var SlackSettingsTab = channel2.SettingsTab;
var SlackAccountCard = channel2.AccountCard;

// plugin-src/client/channels/telegram/api.js
var TELEGRAM_RPC_CHANNEL = "/telegram";
var TELEGRAM_ENDPOINTS = Object.freeze({
  ...TOKEN_BOT_ENDPOINTS,
  setAccessPolicy: "bot.access-policy.set"
});
var api3 = createTokenChannelApi("Telegram", " Bot API \u957F\u8F6E\u8BE2", {
  normalizeBotExtension: (value) => {
    const source = value?.accessPolicy;
    const accessMode = source?.accessMode === "private-allowlist" ? "private-allowlist" : "compatible";
    const allowedUsers = Array.isArray(source?.allowedUsers) ? [...new Set(source.allowedUsers.filter((entry) => typeof entry === "string" && /^[1-9]\d{0,15}$/.test(entry)))] : [];
    return { accessPolicy: { accessMode, allowedUsers } };
  }
});
var unwrapRpcResult6 = api3.unwrapRpcResult;
var normalizeSnapshot5 = api3.normalizeSnapshot;
var presentError6 = api3.presentError;

// plugin-src/client/channels/telegram/index.js
var React17 = __toESM(require("react"), 1);

// plugin-src/client/channels/telegram/styles.js
var TELEGRAM_STYLE_ID = "xmanrui-dsh-im-telegram-settings";
var CSS7 = String.raw`
.dtg-page { --ddt-accent: #229ed9; --ddt-accent-deep: #1687bd; --ddt-accent-wash: #eaf7fd; }
.dtg-avatar { color: #fff; background: #229ed9; }
.dtg-avatar svg { display: block; }
.dtg-access { min-width: 0; width: 100%; max-width: 100%; display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dtg-accessHeading { position: relative; min-width: 0; max-width: 100%; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; }
.dtg-accessHeading > strong { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.dtg-accessStatus { min-width: 0; max-width: 100%; flex: 0 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.dtg-accessBadge { min-width: 0; max-width: 100%; flex: 0 1 auto; padding: 3px 8px; border-radius: 999px; color: #1687bd; background: #eaf7fd; font-size: 11px; font-weight: 700; overflow-wrap: anywhere; text-align: center; }
.dtg-accessBadge[data-mode="private-allowlist"] { color: #a15c00; background: #fff3d6; }
.dtg-accessHelp { position: static; display: inline-flex; flex: none; }
.dtg-accessHelpButton { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); font: inherit; font-size: 12px; line-height: 1; font-weight: 700; cursor: help; transition: border-color .15s ease, color .15s ease, background .15s ease, box-shadow .15s ease; }
.dtg-accessHelpButton:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dtg-accessHelpButton:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.dtg-accessTooltip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: min(300px, 100%); max-width: 100%; display: grid; gap: 8px; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-3, #fff); box-shadow: 0 10px 28px rgb(31 35 41 / 16%); opacity: 0; visibility: hidden; transform: translateY(-3px); pointer-events: none; transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.dtg-accessTooltipItem { display: grid; gap: 2px; }
.dtg-accessTooltipItem + .dtg-accessTooltipItem { padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #eef0f3); }
.dtg-accessTooltipItem strong { color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; line-height: 17px; font-weight: 700; }
.dtg-accessTooltipItem > span { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; line-height: 16px; font-weight: 400; }
.dtg-accessHelp:hover .dtg-accessTooltip, .dtg-accessHelp:focus-within .dtg-accessTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dtg-accessField { min-width: 0; max-width: 100%; display: grid; gap: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; font-weight: 600; }
.dtg-accessField select, .dtg-accessField textarea { min-width: 0; width: 100%; max-width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, #c9cdd4); border-radius: 7px; color: inherit; background: var(--dsw-alias-bg-layer-1, #fff); font: inherit; font-weight: 400; }
.dtg-accessField select { height: 34px; padding: 0 9px; }
.dtg-accessField textarea { min-height: 68px; padding: 8px 9px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dtg-accessField textarea:disabled { color: var(--dsw-alias-label-tertiary, #8f959e); background: var(--dsw-alias-bg-module-platform, #f2f3f5); cursor: not-allowed; resize: none; opacity: 1; }
.dtg-accessField > span, .dtg-accessField small { overflow-wrap: anywhere; }
.dtg-accessField small { color: var(--dsw-alias-label-secondary, #646a73); font-weight: 400; }
.dtg-accessWarning, .dtg-accessError { margin: 0; font-size: 12px; line-height: 1.5; }
.dtg-accessWarning { color: #a15c00; }
.dtg-accessError { color: var(--dsw-alias-state-error-primary, #d83931); }
.dtg-accessActions { min-width: 0; max-width: 100%; display: flex; justify-content: flex-end; flex-wrap: wrap; }
.dtg-accessActions .ddt-button { max-width: 100%; white-space: normal; }
`;
function installTelegramStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${TELEGRAM_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = TELEGRAM_STYLE_ID;
  style.textContent = CSS7;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/telegram/index.js
function policyFor(account) {
  return {
    accessMode: account?.accessPolicy?.accessMode === "private-allowlist" ? "private-allowlist" : "compatible",
    allowedUsers: Array.isArray(account?.accessPolicy?.allowedUsers) ? account.accessPolicy.allowedUsers : []
  };
}
function allowedUsersFromText(value) {
  const entries = value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !/^[1-9]\d{0,15}$/.test(entry))) {
    throw new TypeError("User ID \u5FC5\u987B\u662F 1\u201316 \u4F4D\u6B63\u6574\u6570\uFF0C\u6BCF\u884C\u4E00\u4E2A\u3002");
  }
  return [...new Set(entries)];
}
function TelegramAccessSettings({ account, busy = false, onSave }) {
  const policy = policyFor(account);
  const sourceUsers = policy.allowedUsers.join("\n");
  const accessHelpId = React17.useId();
  const [accessMode, setAccessMode] = React17.useState(policy.accessMode);
  const [allowedUsers, setAllowedUsers] = React17.useState(sourceUsers);
  const [error, setError] = React17.useState(null);
  React17.useEffect(() => {
    setAccessMode(policy.accessMode);
    setAllowedUsers(sourceUsers);
    setError(null);
  }, [policy.accessMode, sourceUsers]);
  const save = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const normalized = allowedUsersFromText(allowedUsers);
      if (typeof onSave !== "function") throw new Error("Telegram \u8BBF\u95EE\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528\u3002");
      await onSave({ accessMode, allowedUsers: normalized });
    } catch (caught) {
      setError(caught?.message ?? "Telegram \u8BBF\u95EE\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002");
    }
  };
  const privateAllowlist = accessMode === "private-allowlist";
  const savedPrivateAllowlist = policy.accessMode === "private-allowlist";
  const emptyAllowlist = privateAllowlist && allowedUsers.trim() === "";
  return h(
    "form",
    { className: "dtg-access", onSubmit: save },
    h(
      "div",
      { className: "dtg-accessHeading" },
      h("strong", null, "\u8BBF\u95EE\u8BBE\u7F6E"),
      h(
        "span",
        { className: "dtg-accessStatus" },
        h(
          "span",
          { className: "dtg-accessBadge", "data-mode": policy.accessMode },
          savedPrivateAllowlist ? "\u5DF2\u751F\u6548\uFF1A\u5B89\u5168\u6A21\u5F0F" : "\u5DF2\u751F\u6548\uFF1A\u517C\u5BB9\u6A21\u5F0F"
        ),
        h(
          "span",
          { className: "dtg-accessHelp" },
          h("button", {
            type: "button",
            className: "dtg-accessHelpButton",
            "aria-label": "\u67E5\u770B Telegram \u8BBF\u95EE\u6A21\u5F0F\u8BF4\u660E",
            "aria-describedby": accessHelpId
          }, h("span", { "aria-hidden": "true" }, "?")),
          h(
            "span",
            {
              id: accessHelpId,
              className: "dtg-accessTooltip",
              role: "tooltip"
            },
            h(
              "span",
              { className: "dtg-accessTooltipItem" },
              h("strong", null, "\u517C\u5BB9\u6A21\u5F0F"),
              h("span", null, "\u4FDD\u6301\u539F\u6709\u884C\u4E3A\uFF1A\u79C1\u804A\u76F4\u63A5\u54CD\u5E94\uFF0C\u7FA4\u804A\u5728\u88AB\u63D0\u53CA\u6216\u56DE\u590D\u65F6\u54CD\u5E94\u3002")
            ),
            h(
              "span",
              { className: "dtg-accessTooltipItem" },
              h("strong", null, "\u5B89\u5168\u6A21\u5F0F"),
              h("span", null, "\u7FA4\u804A\u5168\u90E8\u5FFD\u7565\uFF0C\u79C1\u804A\u4EC5\u5141\u8BB8\u767D\u540D\u5355\u7528\u6237\u3002")
            )
          )
        )
      )
    ),
    h(
      "label",
      { className: "dtg-accessField" },
      h("span", null, "\u6A21\u5F0F"),
      h(
        "select",
        {
          value: accessMode,
          disabled: busy,
          "aria-label": "Telegram \u8BBF\u95EE\u6A21\u5F0F",
          onChange: (event) => {
            setAccessMode(event.target.value);
            setError(null);
          }
        },
        h("option", { value: "compatible" }, "\u517C\u5BB9\u6A21\u5F0F\uFF08\u9ED8\u8BA4\uFF09"),
        h("option", { value: "private-allowlist" }, "\u5B89\u5168\u6A21\u5F0F\uFF08\u79C1\u804A\u767D\u540D\u5355\uFF09")
      )
    ),
    h(
      "label",
      { className: "dtg-accessField" },
      h("span", null, "\u5141\u8BB8\u79C1\u804A\u7684 Telegram User ID"),
      h("textarea", {
        value: allowedUsers,
        disabled: busy || !privateAllowlist,
        rows: 3,
        placeholder: "\u6BCF\u884C\u4E00\u4E2A\u6570\u5B57 User ID",
        "aria-label": "\u5141\u8BB8\u79C1\u804A\u7684 Telegram User ID",
        onChange: (event) => {
          setAllowedUsers(event.target.value);
          setError(null);
        }
      }),
      h("small", null, privateAllowlist ? "\u767D\u540D\u5355\u4EC5\u5C5E\u4E8E\u5F53\u524D\u673A\u5668\u4EBA\u3002" : "\u517C\u5BB9\u6A21\u5F0F\u4E0B\u6682\u4E0D\u4F7F\u7528\u767D\u540D\u5355\uFF0C\u5207\u6362\u6A21\u5F0F\u65F6\u4F1A\u4FDD\u7559\u3002")
    ),
    emptyAllowlist ? h(
      "p",
      { className: "dtg-accessWarning", role: "status" },
      "\u767D\u540D\u5355\u4E3A\u7A7A\uFF1B\u4FDD\u5B58\u540E\u8BE5\u673A\u5668\u4EBA\u4F1A\u62D2\u7EDD\u6240\u6709\u5165\u7AD9\u6D88\u606F\u3002"
    ) : null,
    error ? h(FeedbackToast, { text: error, tone: "error" }) : null,
    h(
      "div",
      { className: "dtg-accessActions" },
      h(ActionButton, {
        type: "submit",
        className: "ddt-button",
        "data-kind": "secondary",
        disabled: busy,
        loading: busy
      }, "\u4FDD\u5B58\u8BBF\u95EE\u8BBE\u7F6E")
    )
  );
}
var channel3 = createTokenChannelSettings({
  channel: "Telegram",
  endpoints: TELEGRAM_ENDPOINTS,
  api: api3,
  LogoGlyph: TelegramLogoGlyph,
  installStyles: installTelegramStyles,
  pageClass: "dtg-page",
  avatarClass: "dtg-avatar",
  connectionLabel: "Bot API \u957F\u8F6E\u8BE2",
  tokenPlaceholder: "\u586B\u5199 @BotFather \u751F\u6210\u7684 Bot Token",
  emptyTitle: "\u63A5\u5165 Telegram \u673A\u5668\u4EBA",
  emptyDescription: "\u5148\u901A\u8FC7 @BotFather \u83B7\u53D6 Bot Token\uFF0C\u518D\u5728\u8FD9\u91CC\u5B8C\u6210\u63A5\u5165\u3002",
  platformLabel: "Telegram",
  AccountSettings: TelegramAccessSettings,
  accountSettingsEndpoint: TELEGRAM_ENDPOINTS.setAccessPolicy
});
var TelegramSettingsTab = channel3.SettingsTab;
var TelegramAccountCard = channel3.AccountCard;

// plugin-src/client/channels/wecom/api.js
var WECOM_RPC_CHANNEL = "/wecom";
var WECOM_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  bindCredentials: "bot.bind-credentials",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
var PROVISION_STATES3 = /* @__PURE__ */ new Set(["starting", "pending", "refreshing", "connecting", "connected", "failed", "cancelled"]);
var ACCOUNT_STATES4 = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
var QR_DATA_URL3 = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;
function isRecord5(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text4(value, fallback, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}
function id3(value) {
  const result = text4(value, "", 128);
  return /^[a-z\d_-]+$/i.test(result) ? result : void 0;
}
function timestamp4(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function normalizeTestMessage3(value) {
  if (!isRecord5(value)) return null;
  if (value.sent === true) return { sent: true };
  if (value.sent !== false) return null;
  const code = value.code === "test-target-unavailable" ? "test-target-unavailable" : "test-message-failed";
  return { sent: false, code };
}
function unwrapRpcResult7(result) {
  if (!isRecord5(result) || typeof result.ok !== "boolean") throw new Error("\u4F01\u4E1A\u5FAE\u4FE1\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  if (!result.ok) {
    const error = new Error(text4(result.error?.message, "\u4F01\u4E1A\u5FAE\u4FE1\u64CD\u4F5C\u5931\u8D25"));
    error.code = text4(result.error?.code, "WECOM_RPC_ERROR", 80);
    throw error;
  }
  return result.value;
}
function safeQrSource4(value) {
  return typeof value === "string" && value.length <= 2 * 1024 * 1024 && QR_DATA_URL3.test(value) ? value : void 0;
}
function normalizeProvisioning4(value, now = Date.now()) {
  const source = isRecord5(value?.provisioning) ? value.provisioning : value;
  if (!isRecord5(source)) throw new Error("\u4F01\u4E1A\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u7ED1\u5B9A\u8FDB\u5EA6");
  const attemptId = id3(source.attemptId);
  if (!attemptId) throw new Error("\u4F01\u4E1A\u5FAE\u4FE1\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1");
  const reported = text4(source.status, "failed", 32);
  const result = {
    attemptId,
    status: PROVISION_STATES3.has(reported) ? reported : "failed",
    expiresAt: timestamp4(source.expiresAt) ?? now + 5 * 6e4,
    pollIntervalMs: Math.min(1e4, Math.max(500, Number(source.pollIntervalMs) || 1e3)),
    qrRevision: Number.isSafeInteger(source.qrRevision) ? source.qrRevision : 0
  };
  const qrCodeDataUrl = safeQrSource4(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (id3(source.botId)) result.botId = id3(source.botId);
  if (isRecord5(source.error)) result.error = {
    code: text4(source.error.code, "WECOM_PROVISION_FAILED", 80),
    message: text4(source.error.message, "\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u6CA1\u6709\u63A5\u5165\u5B8C\u6210")
  };
  return result;
}
function normalizeBot4(value) {
  if (!isRecord5(value) || !id3(value.botId)) return void 0;
  const connected = value.connected === true;
  const state = ACCOUNT_STATES4.has(value.state) ? value.state : "offline";
  return {
    botId: id3(value.botId),
    connected,
    state: connected ? "connected" : state,
    workspace: text4(value.workspace, "", 4096),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    bot: {
      name: text4(value.bot?.name, "\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA", 100),
      appIdMasked: text4(value.bot?.appIdMasked, "\u5E94\u7528\u6807\u8BC6\u5DF2\u5B89\u5168\u4FDD\u5B58", 140)
    },
    health: {
      summary: text4(value.health?.summary, connected ? "\u4F01\u4E1A\u5FAE\u4FE1 WebSocket \u957F\u8FDE\u63A5\u8FD0\u884C\u6B63\u5E38" : "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA"),
      lastCheckedAt: timestamp4(value.health?.lastCheckedAt)
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord5(value.error) ? {
      code: text4(value.error.code, "WECOM_ACCOUNT_ERROR", 80),
      message: text4(value.error.message, "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA")
    } : null
  };
}
function normalizeSnapshot6(value) {
  const source = isRecord5(value?.snapshot) ? value.snapshot : value;
  if (!isRecord5(source) || !Array.isArray(source.bots)) throw new Error("\u4F01\u4E1A\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868");
  const bots = source.bots.map(normalizeBot4).filter(Boolean);
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    bots,
    totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
    provisioning: source.provisioning ? normalizeProvisioning4(source.provisioning) : null,
    testMessage: normalizeTestMessage3(source.testMessage),
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog)
  };
}
function presentError7(error) {
  return {
    code: text4(error?.code, "WECOM_ERROR", 80),
    message: text4(error?.message, "\u4F01\u4E1A\u5FAE\u4FE1\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")
  };
}
function formatRemaining4(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1e3) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// plugin-src/client/channels/wecom/index.js
var React18 = __toESM(require("react"), 1);

// plugin-src/client/channels/wecom/styles.js
var WECOM_STYLE_ID = "xmanrui-dsh-im-wecom-settings";
var CSS8 = String.raw`
.dwecom-page { --ddt-accent: #3370ff; --ddt-accent-deep: #245bdb; --ddt-accent-wash: #eef4ff; }
.dwecom-avatar, .dwecom-brand { color: #3370ff; background: #fff; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); }
.dwecom-avatar svg, .dwecom-brand svg { display: block; }
`;
function installWecomStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${WECOM_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = WECOM_STYLE_ID;
  style.textContent = CSS8;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/wecom/index.js
var ACTIVE_STATES2 = /* @__PURE__ */ new Set(["pending", "refreshing", "connecting"]);
var Button10 = React18.forwardRef(function Button11({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `ddt-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function checkedTime4(value) {
  if (!value) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "\u521A\u521A";
  }
}
function Heading4({ totals, adding, busy, onAdd, onCredential, credentialOpen, addButtonRef }) {
  return h(
    "div",
    { className: "ddt-heading" },
    h(
      "div",
      { className: "ddt-tools" },
      h(
        "div",
        { className: "dim-bindActions" },
        h(Button10, {
          kind: "primary",
          className: "dim-scanButton",
          onClick: onAdd,
          disabled: adding || busy,
          ref: addButtonRef,
          "aria-label": "\u626B\u7801\u63A5\u5165\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA",
          loading: adding
        }, h(QrActionIcon), "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA"),
        h(Button10, {
          kind: "credential",
          className: "dim-credentialButton",
          onClick: onCredential,
          disabled: adding || busy,
          "aria-pressed": credentialOpen,
          "aria-label": "\u4F7F\u7528 Bot ID \u548C Secret \u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA"
        }, h(CredentialActionIcon), credentialOpen ? "\u6536\u8D77\u51ED\u636E" : "\u624B\u52A8\u63A5\u5165")
      ),
      totals.configured > 0 ? h(
        "div",
        { className: "ddt-badge dim-onlineBadge" },
        h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)
      ) : null
    )
  );
}
function LoadingView4() {
  return h(
    "div",
    { className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "ddt-spinner dim-spinner" }),
    h("span", null, "\u6B63\u5728\u8BFB\u53D6\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u72B6\u6001\u2026")
  );
}
function EmptyView4({ busy, onStart }) {
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "dim-emptyCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u4F7F\u7528\u4F01\u4E1A\u5FAE\u4FE1 App \u626B\u7801\u521B\u5EFA\u667A\u80FD\u673A\u5668\u4EBA"),
        h("p", null, "\u626B\u7801\u7531\u817E\u8BAF\u5B98\u65B9\u9875\u9762\u5B8C\u6210\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u586B\u5199 Bot ID \u6216 Secret\u3002\u521B\u5EFA\u6210\u529F\u540E\uFF0C\u673A\u5668\u4EBA\u4F1A\u81EA\u52A8\u8FDE\u63A5 DeepSeek Harness\u3002"),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(
            Button10,
            { kind: "primary", onClick: onStart, disabled: busy, loading: busy },
            "\u751F\u6210\u4F01\u4E1A\u5FAE\u4FE1\u4E8C\u7EF4\u7801"
          )
        )
      ),
      h(
        "div",
        { className: "ddt-brandMark dim-emptyBrand dwecom-brand", "aria-hidden": "true" },
        h(WecomLogoGlyph, { size: 64 })
      )
    )
  );
}
function QrPanel3({ provision, now, busy, onRefresh, onCancel }) {
  const source = safeQrSource4(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const duration = Math.max(1, provision.durationMs ?? 5 * 6e4);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  const refreshing = provision.status === "refreshing";
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "ddt-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "ddt-qrFrame dim-qrFrame" },
          source ? h("img", { src: source, alt: "\u7528\u4E8E\u7ED1\u5B9A\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801" }) : h(
            "div",
            { className: "ddt-qrFallback dim-qrFallback" },
            refreshing ? "\u4E8C\u7EF4\u7801\u6B63\u5728\u81EA\u52A8\u5237\u65B0\u2026" : "\u4E8C\u7EF4\u7801\u56FE\u7247\u6B63\u5728\u751F\u6210\u2026"
          )
        ),
        h(
          "div",
          { className: "ddt-countdown dim-countdown" },
          h(
            "div",
            { className: "ddt-countdownTop dim-countdownTop" },
            h("span", null, "\u5F53\u524D\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, refreshing ? "--:--" : formatRemaining4(remaining))
          ),
          h("div", { className: "ddt-progress dim-progress", style: { "--ddt-progress": `${progress}%` } }, h("span"))
        )
      ),
      h(
        "div",
        { className: "ddt-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot", "data-tone": "warning" }),
          h("span", null, refreshing ? "\u6B63\u5728\u5237\u65B0\u4E8C\u7EF4\u7801" : "\u7B49\u5F85\u4F01\u4E1A\u5FAE\u4FE1 App \u626B\u7801")
        ),
        h("h3", null, "\u4F7F\u7528\u4F01\u4E1A\u5FAE\u4FE1 App \u5B8C\u6210\u667A\u80FD\u673A\u5668\u4EBA\u6388\u6743"),
        h("p", null, "\u4F01\u4E1A\u5FAE\u4FE1\u5B98\u65B9\u9875\u9762\u4F1A\u521B\u5EFA\u4E00\u4E2A\u667A\u80FD\u673A\u5668\u4EBA\uFF0C\u5E76\u628A\u8FDE\u63A5\u51ED\u636E\u5B89\u5168\u4EA4\u7ED9\u672C\u673A Harness Host\u3002"),
        h(
          "ol",
          { className: "ddt-steps dim-steps" },
          h("li", null, "\u6253\u5F00\u4F01\u4E1A\u5FAE\u4FE1 App\uFF0C\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801"),
          h("li", null, "\u5728\u817E\u8BAF\u6388\u6743\u9875\u9762\u786E\u8BA4\u521B\u5EFA\u667A\u80FD\u673A\u5668\u4EBA"),
          h("li", null, "\u8FD4\u56DE\u8FD9\u91CC\u7B49\u5F85\u8FDE\u63A5\u5B8C\u6210")
        ),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(Button10, { onClick: onRefresh, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
          h(Button10, { kind: "quiet", onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
        )
      )
    )
  );
}
function ProvisionView2({ provision, busy, onRetry, onClose }) {
  if (provision.status === "connecting") {
    return h(
      "div",
      { className: "ddt-card ddt-loading dim-surfaceCard dim-specialView", "aria-busy": "true" },
      h("div", { className: "ddt-spinner dim-spinner" }),
      h("h3", null, "\u4F01\u4E1A\u5FAE\u4FE1\u5DF2\u6388\u6743\uFF0C\u6B63\u5728\u8FDE\u63A5\u673A\u5668\u4EBA"),
      h("p", null, "\u51ED\u636E\u6B63\u5728\u5199\u5165\u672C\u673A\uFF0C\u5E76\u542F\u52A8\u4F01\u4E1A\u5FAE\u4FE1 WebSocket \u6D88\u606F\u8FDE\u63A5\u3002")
    );
  }
  const error = provision.error ?? { code: "WECOM_PROVISION_FAILED", message: "\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210" };
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-inlineError dim-inlineError", role: "alert" },
      h("h3", null, "\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210"),
      h("p", null, error.message),
      h("span", { className: "ddt-errorCode" }, error.code),
      h(
        "div",
        { className: "ddt-actions dim-viewActions" },
        h(Button10, { kind: "primary", onClick: onRetry, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
        h(Button10, { onClick: onClose, disabled: busy }, "\u5173\u95ED")
      )
    )
  );
}
function RemoveConfirmation4({ account, busy, error, feedbackSequence, onConfirm, onCancel }) {
  return h(
    ConfirmDialog,
    { className: "ddt-confirm dim-confirm", role: "alertdialog", onClose: onCancel, busy: Boolean(busy), error, feedbackSequence },
    h("strong", null, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${account.bot.name}\u201D\uFF1F`),
    h("p", null, "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5E94\u7528\u51ED\u636E\u3001\u673A\u5668\u4EBA\u914D\u7F6E\u53CA\u4F1A\u8BDD\u6620\u5C04\u3002\u4F01\u4E1A\u5FAE\u4FE1\u5E73\u53F0\u4E2D\u7684\u673A\u5668\u4EBA\u4E0D\u4F1A\u88AB\u81EA\u52A8\u5220\u9664\u3002"),
    h(
      "div",
      { className: "ddt-actions dim-viewActions" },
      h(Button10, { onClick: onCancel, disabled: busy }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(Button10, { kind: "danger", onClick: onConfirm, disabled: busy, loading: busy }, "\u786E\u8BA4\u79FB\u9664\u63A5\u5165")
    )
  );
}
function AccountCard3({
  account,
  busy,
  feedback,
  removing,
  removeError,
  removeFeedbackSequence,
  onReconnect,
  onWorkspaceSave,
  onAgentPresetSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove
}) {
  const tone = account.connected ? "success" : account.state === "error" ? "error" : "warning";
  const stateLabel2 = account.connected ? "\u8FD0\u884C\u6B63\u5E38" : account.state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA";
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h(
    "article",
    { className: "ddt-card dim-botCard", "data-bot-id": account.botId },
    h(
      "div",
      { className: "ddt-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "ddt-accountTop dim-botCardTop" },
        h(
          "div",
          { className: "ddt-accountIdentity dim-botIdentity" },
          h("div", { className: "ddt-avatar dim-botAvatar dwecom-avatar", "aria-hidden": "true" }, h(WecomLogoGlyph, { size: 29 })),
          h(
            "div",
            { className: "dim-botName" },
            h("h3", null, account.bot.name),
            h("p", null, account.bot.appIdMasked)
          )
        ),
        h(BotStatusMeta, {
          className: "ddt-health",
          dotClassName: "ddt-dot",
          tone,
          stateLabel: stateLabel2,
          lastCheckedAt: account.health.lastCheckedAt,
          formatCheckedTime: checkedTime4
        })
      ),
      h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(
        "div",
        { className: "ddt-accountFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "ddt-actions dim-cardActions" },
            h(Button10, { className: "dim-cardAction", onClick: onReconnect, disabled: Boolean(busy), loading: busy === "reconnect" }, account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
            h(Button10, { className: "dim-cardAction", kind: "danger", onClick: onRequestRemove, disabled: Boolean(busy) }, "\u79FB\u9664\u63A5\u5165")
          ),
          summary ? h("div", { className: "ddt-summary dim-cardSummary" }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: "ddt-summary",
            error: account.lastMessageError
          }) : null,
          null
        )
      )
    ),
    removing ? h(RemoveConfirmation4, {
      account,
      busy: busy === "delete",
      error: removeError,
      feedbackSequence: removeFeedbackSequence,
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function WecomSettingsTab({ rpcCall }) {
  const [model, setModel] = React18.useState({
    phase: "loading",
    bots: [],
    totals: { configured: 0, connected: 0 },
    error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [provision, setProvision] = React18.useState(null);
  const [busy, setBusy] = React18.useState(false);
  const [busyByBot, setBusyByBot] = React18.useState({});
  const [feedbackByBot, setFeedbackByBot] = React18.useState({});
  const [removeTarget, setRemoveTarget] = React18.useState(null);
  const [actionError, setActionError] = React18.useState(null);
  const [removeErrorsByBot, setRemoveErrorsByBot] = React18.useState({});
  const [credentialOpen, setCredentialOpen] = React18.useState(false);
  const [credentialError, setCredentialError] = React18.useState(null);
  const [notice, setNotice] = React18.useState("");
  const [now, setNow] = React18.useState(Date.now());
  const mounted = React18.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const addButtonRef = React18.useRef(null);
  const noticeFrameRef = React18.useRef(null);
  const announce = React18.useCallback((message) => {
    if (!mounted.current) return;
    if (noticeFrameRef.current !== null) {
      window.cancelAnimationFrame(noticeFrameRef.current);
      noticeFrameRef.current = null;
    }
    setNotice("");
    if (message) {
      noticeFrameRef.current = window.requestAnimationFrame(() => {
        noticeFrameRef.current = null;
        if (mounted.current) setNotice(message);
      });
    }
  }, []);
  React18.useEffect(() => {
    const disposeDingtalk = installDingtalkStyles();
    const disposeWecom = installWecomStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noticeFrameRef.current !== null) {
        window.cancelAnimationFrame(noticeFrameRef.current);
        noticeFrameRef.current = null;
      }
      disposeWecom();
      disposeDingtalk();
    };
  }, []);
  const invoke = React18.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== "function") throw new TypeError("\u4F01\u4E1A\u5FAE\u4FE1\u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5");
    return unwrapRpcResult7(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const loadStatus = React18.useCallback(async ({ signal, silent = false, restore = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return void 0;
    if (!silent && mounted.current) setModel((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const snapshot = normalizeSnapshot6(await invoke(WECOM_ENDPOINTS.status, {}, signal));
      if (!mounted.current || signal?.aborted || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      setModel({
        phase: "ready",
        bots: snapshot.bots,
        totals: snapshot.totals,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
      });
      if (restore && snapshot.provisioning) setProvision({
        ...snapshot.provisioning,
        durationMs: Math.max(1, snapshot.provisioning.expiresAt - Date.now())
      });
      return snapshot;
    } catch (error) {
      if (error?.name !== "AbortError" && mounted.current && !signal?.aborted && workspaceFence.canCommitStatus(workspaceVersion)) {
        setModel((current) => ({ ...current, phase: silent ? current.phase : "error", error: presentError7(error) }));
      }
      return void 0;
    }
  }, [invoke, workspaceFence]);
  React18.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restore: true });
    return () => controller.abort();
  }, [loadStatus]);
  React18.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    const timer = window.setInterval(() => void loadStatus({ signal: controller.signal, silent: true }), 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React18.useEffect(() => {
    if (!provision || !ACTIVE_STATES2.has(provision.status)) return void 0;
    const timer = window.setInterval(() => mounted.current && setNow(Date.now()), 1e3);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);
  const startProvisioning = React18.useCallback(async (replace = false) => {
    setCredentialOpen(false);
    setCredentialError(null);
    setBusy(true);
    try {
      if (replace && provision?.attemptId) await invoke(WECOM_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      if (!mounted.current) return;
      setProvision({ status: "starting" });
      const started = normalizeProvisioning4(await invoke(WECOM_ENDPOINTS.beginProvisioning, { locale: "zh-CN" }));
      if (!mounted.current) return;
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
    } catch (error) {
      if (mounted.current) setProvision({ status: "failed", error: presentError7(error) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId]);
  const bindCredentials = React18.useCallback(async ({ identity, secret }) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusy(true);
    setCredentialError(null);
    try {
      const snapshot = normalizeSnapshot6(await invoke(
        WECOM_ENDPOINTS.bindCredentials,
        { botId: identity, secret }
      ));
      if (!mounted.current) return;
      if (workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
      setCredentialOpen(false);
    } catch (error) {
      if (mounted.current) setCredentialError(presentError7(error));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusy(false);
    }
  }, [invoke, loadStatus, workspaceFence]);
  const closeProvision = React18.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && ACTIVE_STATES2.has(provision.status)) {
        await invoke(WECOM_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      if (mounted.current) {
        setProvision(null);
        setActionError(null);
      }
    } catch (cause) {
      if (mounted.current) setActionError((current) => ({
        message: cause?.message ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
        sequence: (current?.sequence ?? 0) + 1
      }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId, provision?.status]);
  React18.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_STATES2.has(provision.status)) return void 0;
    const controller = new AbortController();
    let disposed = false;
    let timer;
    const poll = async () => {
      try {
        const current = normalizeProvisioning4(await invoke(WECOM_ENDPOINTS.pollProvisioning, { attemptId }, controller.signal));
        if (disposed || controller.signal.aborted || !mounted.current) return;
        if (current.status === "connected") {
          setProvision(null);
          await loadStatus({ signal: controller.signal, silent: true });
          return;
        }
        setProvision((previous) => previous?.attemptId === attemptId ? { ...previous, ...current, durationMs: current.qrRevision !== previous.qrRevision ? Math.max(1, current.expiresAt - Date.now()) : previous.durationMs } : previous);
        if (ACTIVE_STATES2.has(current.status)) timer = window.setTimeout(poll, current.pollIntervalMs);
      } catch (error) {
        if (!disposed && !controller.signal.aborted && mounted.current) {
          setProvision((current) => ({ ...current, status: "failed", error: presentError7(error) }));
        }
      }
    };
    timer = window.setTimeout(poll, provision.pollIntervalMs ?? 1e3);
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [invoke, loadStatus, provision?.attemptId, provision?.pollIntervalMs, provision?.status]);
  const botAction = React18.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusyByBot((current) => ({ ...current, [account.botId]: operation }));
    try {
      const snapshot = normalizeSnapshot6(await invoke(endpoint, payload));
      if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
      return snapshot;
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusyByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
  }, [invoke, loadStatus, workspaceFence]);
  const reconnect = React18.useCallback(async (account) => {
    setFeedbackByBot((current) => {
      const next = { ...current };
      delete next[account.botId];
      return next;
    });
    try {
      const snapshot = await botAction(
        account,
        "reconnect",
        WECOM_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true }
      );
      if (!snapshot) return;
      const refreshed = snapshot.bots.find((bot) => bot.botId === account.botId);
      let feedback;
      if (!refreshed?.connected) {
        feedback = "\u4F01\u4E1A\u5FAE\u4FE1\u4ECD\u672A\u8FDE\u63A5\uFF0C\u63D2\u4EF6\u4F1A\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002";
      } else if (snapshot.testMessage?.sent) {
        feedback = "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002";
      } else if (snapshot.testMessage?.code === "test-target-unavailable") {
        feedback = "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
      } else if (snapshot.testMessage) {
        feedback = "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002";
      } else {
        feedback = "\u4F01\u4E1A\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002";
      }
      if (mounted.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    } catch {
      const feedback = "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
      if (mounted.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    }
  }, [announce, botAction]);
  let provisionView = null;
  if (provision?.status === "starting") provisionView = h("div", { className: "ddt-card ddt-loading dim-surfaceCard" }, h("div", { className: "ddt-spinner" }), "\u6B63\u5728\u7533\u8BF7\u4F01\u4E1A\u5FAE\u4FE1\u4E8C\u7EF4\u7801\u2026");
  else if (["pending", "refreshing"].includes(provision?.status)) provisionView = h(QrPanel3, {
    provision,
    now,
    busy,
    onRefresh: () => void startProvisioning(true),
    onCancel: () => void closeProvision()
  });
  else if (provision) provisionView = h(ProvisionView2, {
    provision,
    busy,
    onRetry: () => void startProvisioning(true),
    onClose: () => void closeProvision()
  });
  const botList = model.bots.length > 0 ? h(
    "section",
    { className: "dim-listSection" },
    h(ChannelListHeading, {
      className: "ddt-listHeading",
      title: "\u5DF2\u7ED1\u5B9A\u7684\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA",
      connectionLabel: "WebSocket \u957F\u8FDE\u63A5"
    }),
    h("ul", { className: "ddt-list dim-botList" }, model.bots.map((account) => h("li", { key: account.botId }, h(AccountCard3, {
      account,
      busy: busyByBot[account.botId],
      feedback: feedbackByBot[account.botId],
      removing: removeTarget === account.botId,
      removeError: removeErrorsByBot[account.botId]?.message,
      removeFeedbackSequence: removeErrorsByBot[account.botId]?.sequence,
      onReconnect: () => void reconnect(account),
      onWorkspaceSave: (workspace) => botAction(
        account,
        "workspace",
        WECOM_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace }
      ),
      onAgentPresetSave: (agentPreset) => botAction(
        account,
        "preset",
        WECOM_ENDPOINTS.setAgentPreset,
        { botId: account.botId, agentPreset }
      ),
      onRequestRemove: () => setRemoveTarget(account.botId),
      onCancelRemove: () => setRemoveTarget(null),
      onConfirmRemove: async () => {
        try {
          await botAction(account, "delete", WECOM_ENDPOINTS.deleteBot, { botId: account.botId, confirm: true });
          if (mounted.current) {
            setRemoveTarget(null);
            setRemoveErrorsByBot((current) => {
              const next = { ...current };
              delete next[account.botId];
              return next;
            });
          }
        } catch (cause) {
          if (mounted.current) setRemoveErrorsByBot((current) => ({
            ...current,
            [account.botId]: {
              message: cause?.message ?? "\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
              sequence: (current[account.botId]?.sequence ?? 0) + 1
            }
          }));
        }
      }
    }))))
  ) : null;
  const credentialView = credentialOpen ? h(CredentialBindingPanel, {
    channel: "\u4F01\u4E1A\u5FAE\u4FE1",
    identityLabel: "Bot ID",
    identityPlaceholder: "\u586B\u5199\u4F01\u4E1A\u5FAE\u4FE1\u667A\u80FD\u673A\u5668\u4EBA Bot ID",
    secretLabel: "Secret",
    secretPlaceholder: "\u586B\u5199\u4F01\u4E1A\u5FAE\u4FE1\u667A\u80FD\u673A\u5668\u4EBA Secret",
    busy,
    error: credentialError,
    onSubmit: bindCredentials,
    onCancel: () => {
      setCredentialOpen(false);
      setCredentialError(null);
    }
  }) : null;
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    { className: "ddt-page dwecom-page dim-channelPage", "aria-label": "\u4F01\u4E1A\u5FAE\u4FE1\u8BBE\u7F6E" },
    actionError ? h(FeedbackToast, { text: actionError.message, tone: "error", sequence: actionError.sequence }) : null,
    Object.entries(removeErrorsByBot).map(([botId, failure]) => botId !== removeTarget ? h(FeedbackToast, { key: botId, text: failure.message, tone: "error", sequence: failure.sequence }) : null),
    h(Heading4, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      onCredential: () => {
        setCredentialOpen((value) => !value);
        setCredentialError(null);
      },
      credentialOpen,
      addButtonRef
    }),
    notice ? h(FeedbackToast, { text: notice }) : null,
    model.phase === "loading" ? h(LoadingView4) : model.phase === "error" ? h("div", { className: "ddt-card dim-surfaceCard" }, h("div", { className: "ddt-inlineError dim-inlineError" }, h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6\u4F01\u4E1A\u5FAE\u4FE1\u673A\u5668\u4EBA\u72B6\u6001"), h("p", null, model.error?.message), h(Button10, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6"))) : h(
      React18.Fragment,
      null,
      credentialView,
      provisionView,
      model.bots.length === 0 && !provision && !credentialOpen ? h(EmptyView4, { busy, onStart: () => void startProvisioning() }) : null,
      botList
    )
  ));
}

// plugin-src/client/channels/weixin/index.js
var React19 = __toESM(require("react"), 1);

// plugin-src/client/channels/weixin/api.js
var WEIXIN_RPC_CHANNEL = "/weixin";
var WEIXIN_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  submitVerification: "provision.verify",
  cancelProvisioning: "provision.cancel",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
var ACCOUNT_STATES5 = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
var PROVISION_STATES4 = /* @__PURE__ */ new Set([
  "starting",
  "pending",
  "scanned",
  "needs_verification",
  "connecting",
  "connected",
  "expired",
  "failed",
  "cancelled"
]);
function isRecord6(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function string(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function timestamp5(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function normalizeTestMessage4(value) {
  if (!isRecord6(value)) return null;
  if (value.sent === true) return { sent: true };
  if (value.sent !== false) return null;
  const code = value.code === "test-target-unavailable" ? "test-target-unavailable" : "test-message-failed";
  return { sent: false, code };
}
function unwrapRpcResult8(result) {
  if (!isRecord6(result) || typeof result.ok !== "boolean") {
    throw new Error("\u5FAE\u4FE1\u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const error = new Error(string(result.error?.message, "\u5FAE\u4FE1\u64CD\u4F5C\u5931\u8D25"));
    error.code = string(result.error?.code, "WEIXIN_RPC_ERROR");
    throw error;
  }
  return result.value;
}
function safeQrSource5(value) {
  return typeof value === "string" && /^data:image\/(?:png|webp|svg\+xml)(?:;charset=[^;,]+)?;base64,/i.test(value) ? value : void 0;
}
function safeVerificationUrl(value) {
  if (typeof value !== "string") return void 0;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "weixin.qq.com" || host.endsWith(".weixin.qq.com")) ? url.toString() : void 0;
  } catch {
    return void 0;
  }
}
function normalizeProvisioning5(value) {
  if (!isRecord6(value) || !string(value.attemptId)) {
    throw new Error("\u5FAE\u4FE1\u626B\u7801\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u7ED1\u5B9A\u4EFB\u52A1");
  }
  const status = PROVISION_STATES4.has(value.status) ? value.status : "failed";
  const result = {
    attemptId: string(value.attemptId),
    status,
    expiresAt: timestamp5(value.expiresAt) ?? Date.now(),
    pollIntervalMs: Math.min(5e3, Math.max(500, Number(value.pollIntervalMs) || 1e3)),
    verificationRequired: value.verificationRequired === true || status === "needs_verification"
  };
  const verificationUrl = safeVerificationUrl(value.verificationUrl);
  const qrCodeDataUrl = safeQrSource5(value.qrCodeDataUrl);
  if (verificationUrl) result.verificationUrl = verificationUrl;
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (string(value.botId)) result.botId = string(value.botId);
  if (value.alreadyConnected === true) result.alreadyConnected = true;
  if (isRecord6(value.error)) {
    result.error = {
      code: string(value.error.code, "WEIXIN_PROVISION_FAILED"),
      message: string(value.error.message, "\u5FAE\u4FE1\u7ED1\u5B9A\u6CA1\u6709\u5B8C\u6210")
    };
  }
  return result;
}
function normalizeBot5(value) {
  if (!isRecord6(value) || !string(value.botId) || !isRecord6(value.bot)) return null;
  const state = ACCOUNT_STATES5.has(value.state) ? value.state : "error";
  const connected = value.connected === true;
  return {
    botId: string(value.botId),
    state: connected ? "connected" : state,
    connected,
    configured: value.configured === true,
    workspace: string(value.workspace).slice(0, 4096),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    bot: {
      name: string(value.bot.name, "\u5FAE\u4FE1\u673A\u5668\u4EBA"),
      accountIdMasked: string(value.bot.accountIdMasked, "\u5DF2\u5B89\u5168\u4FDD\u5B58")
    },
    health: {
      status: string(value.health?.status, connected ? "healthy" : "offline"),
      summary: string(value.health?.summary, connected ? "\u5FAE\u4FE1\u8FDE\u63A5\u6B63\u5E38" : "\u5FAE\u4FE1\u8FDE\u63A5\u672A\u5C31\u7EEA"),
      lastCheckedAt: timestamp5(value.health?.lastCheckedAt)
    },
    stats: {
      messagesReceived: Math.max(0, Number(value.stats?.messagesReceived) || 0),
      messagesReplied: Math.max(0, Number(value.stats?.messagesReplied) || 0)
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord6(value.error) ? {
      code: string(value.error.code, "WEIXIN_ACCOUNT_ERROR"),
      message: string(value.error.message, "\u5FAE\u4FE1\u8FDE\u63A5\u672A\u5C31\u7EEA")
    } : null
  };
}
function normalizeSnapshot7(value) {
  if (!isRecord6(value) || !Array.isArray(value.bots)) {
    throw new Error("\u5FAE\u4FE1\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u8D26\u53F7\u5217\u8868");
  }
  const bots = value.bots.map(normalizeBot5).filter(Boolean);
  return {
    schemaVersion: Number(value.schemaVersion) || 1,
    revision: Number(value.revision) || 0,
    state: string(value.state, "offline"),
    bots,
    totals: {
      configured: bots.length,
      connected: bots.filter((bot) => bot.connected).length
    },
    provisioning: value.provisioning ? normalizeProvisioning5(value.provisioning) : null,
    testMessage: normalizeTestMessage4(value.testMessage),
    agentPresetCatalog: normalizeAgentPresetCatalog(value.agentPresetCatalog)
  };
}
function presentError8(error) {
  return {
    code: string(error?.code, "WEIXIN_ERROR"),
    message: string(error?.message, "\u5FAE\u4FE1\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")
  };
}
function formatRemaining5(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1e3));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// plugin-src/client/channels/weixin/index.js
var Button12 = React19.forwardRef(function Button13({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `dxw-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function Heading5({ totals, adding, busy, onAdd, addButtonRef }) {
  return h(
    "div",
    { className: "dxw-heading" },
    h(
      "div",
      { className: "dxw-tools" },
      h(Button12, {
        kind: "primary",
        className: "dim-scanButton",
        onClick: onAdd,
        disabled: adding || busy,
        ref: addButtonRef,
        "aria-label": "\u626B\u7801\u63A5\u5165\u5FAE\u4FE1\u673A\u5668\u4EBA",
        loading: adding
      }, h(QrActionIcon), "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA"),
      totals.configured > 0 ? h(
        "div",
        { className: "dxw-badge dim-onlineBadge" },
        h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)
      ) : null
    )
  );
}
function LoadingView5() {
  return h(
    "div",
    { className: "dxw-card dxw-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "dxw-spinner dim-spinner" }),
    h("span", null, "\u6B63\u5728\u8BFB\u53D6\u5FAE\u4FE1\u8FDE\u63A5\u72B6\u6001\u2026")
  );
}
function EmptyView5({ onStart, busy }) {
  return h(
    "div",
    { className: "dxw-card dim-surfaceCard" },
    h(
      "div",
      { className: "dxw-cardBody dxw-empty dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "dim-emptyCopy" },
        h(
          "div",
          { className: "dxw-stateLabel dim-stateLabel" },
          h("span", { className: "dxw-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u7ED1\u5B9A\u5FAE\u4FE1")
        ),
        h("h3", null, "\u626B\u4E00\u6B21\u7801\uFF0C\u5C31\u80FD\u5728\u5FAE\u4FE1\u91CC\u4F7F\u7528 Harness"),
        h("p", null, "\u4E8C\u7EF4\u7801\u7531\u817E\u8BAF\u5FAE\u4FE1 iLink \u670D\u52A1\u7B7E\u53D1\u3002\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u5E76\u786E\u8BA4\u540E\uFF0C\u8D26\u53F7\u51ED\u636E\u4F1A\u76F4\u63A5\u5199\u5165 Harness Host\uFF0C\u6D4F\u89C8\u5668\u4E0D\u4F1A\u6536\u5230 bot_token\u3002"),
        h(
          "div",
          { className: "dxw-actions dim-viewActions" },
          h(
            Button12,
            { kind: "primary", onClick: onStart, disabled: busy, loading: busy },
            "\u751F\u6210\u5FAE\u4FE1\u4E8C\u7EF4\u7801"
          )
        )
      ),
      h("div", { className: "dxw-logo dim-emptyBrand", "aria-hidden": "true" }, h(WeixinLogoGlyph, { size: 64 }))
    )
  );
}
function QrPanel4({ provision, now, busy, onRefresh, onCancel }) {
  const [imageFailed, setImageFailed] = React19.useState(false);
  const source = safeQrSource5(provision.qrCodeDataUrl);
  const href = safeVerificationUrl(provision.verificationUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const expired = remaining === 0 || provision.status === "expired";
  const duration = Math.max(1, provision.durationMs ?? 5 * 6e4);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  React19.useEffect(() => setImageFailed(false), [source]);
  return h(
    "div",
    { className: "dxw-card dim-surfaceCard" },
    h(
      "div",
      { className: "dxw-cardBody dxw-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "dxw-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "dxw-qrFrame dim-qrFrame" },
          source && !imageFailed ? h("img", {
            src: source,
            alt: "\u7528\u4E8E\u628A\u5FAE\u4FE1\u673A\u5668\u4EBA\u7ED1\u5B9A\u5230 DeepSeek Harness \u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801",
            onError: () => setImageFailed(true)
          }) : h("div", { className: "dxw-qrFallback dim-qrFallback" }, "\u4E8C\u7EF4\u7801\u56FE\u7247\u672A\u5C31\u7EEA\uFF0C\u8BF7\u4F7F\u7528\u5907\u7528\u94FE\u63A5\u3002"),
          expired ? h("div", { className: "dxw-expired dim-qrExpired" }, "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F\n\u8BF7\u91CD\u65B0\u751F\u6210") : null
        ),
        h(
          "div",
          { className: "dxw-countdown dim-countdown" },
          h("div", { className: "dim-countdownTop" }, h("span", null, "\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"), h("strong", null, formatRemaining5(remaining))),
          h(
            "div",
            { className: "dxw-progress dim-progress", "aria-hidden": "true" },
            h("span", { style: { "--dxw-progress": `${progress}%` } })
          )
        )
      ),
      h(
        "div",
        { className: "dxw-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "dxw-stateLabel dim-stateLabel" },
          h("span", { className: "dxw-dot dim-stateDot", "data-tone": provision.status === "scanned" ? "success" : "warning" }),
          h("span", null, provision.status === "scanned" ? "\u5DF2\u626B\u7801\uFF0C\u8BF7\u5728\u624B\u673A\u4E0A\u786E\u8BA4" : "\u7B49\u5F85\u5FAE\u4FE1\u626B\u7801")
        ),
        h("h3", null, expired ? "\u4E8C\u7EF4\u7801\u5DF2\u5931\u6548" : "\u4F7F\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u4E8C\u7EF4\u7801"),
        h("p", null, "\u8BF7\u5728\u624B\u673A\u4E0A\u6838\u5BF9\u5E76\u786E\u8BA4\u6388\u6743\u3002\u90E8\u5206\u8D26\u53F7\u4F1A\u989D\u5916\u663E\u793A\u4E00\u4E2A\u914D\u5BF9\u6570\u5B57\uFF0C\u9875\u9762\u4F1A\u5728\u9700\u8981\u65F6\u63D0\u793A\u8F93\u5165\u3002"),
        h(
          "ol",
          { className: "dxw-steps dim-steps" },
          h("li", null, "\u6253\u5F00\u624B\u673A\u5FAE\u4FE1\u5E76\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801"),
          h("li", null, "\u5728\u5FAE\u4FE1\u4E2D\u786E\u8BA4\u8FDE\u63A5\u8BE5\u673A\u5668\u4EBA"),
          h("li", null, "\u4FDD\u6301\u672C\u9875\u6253\u5F00\uFF0C\u7B49\u5F85\u6D88\u606F\u957F\u8F6E\u8BE2\u53D8\u4E3A\u5728\u7EBF")
        ),
        h(
          "div",
          { className: "dxw-actions dim-viewActions" },
          expired ? h(Button12, { kind: "primary", onClick: onRefresh, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801") : null,
          href ? h("a", {
            className: "dxw-button",
            href,
            target: "_blank",
            rel: "noopener noreferrer"
          }, "\u6253\u5F00\u5907\u7528\u94FE\u63A5") : null,
          !expired ? h(Button12, { onClick: onRefresh, disabled: busy }, "\u6362\u4E00\u4E2A\u4E8C\u7EF4\u7801") : null,
          h(Button12, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
        )
      )
    )
  );
}
function VerificationPanel({ provision, busy, onSubmit, onCancel }) {
  const [code, setCode] = React19.useState("");
  const valid = /^\d{4,8}$/.test(code);
  React19.useEffect(() => setCode(""), [provision.attemptId]);
  return h(
    "div",
    { className: "dxw-card dim-surfaceCard" },
    h(
      "form",
      {
        className: "dxw-verify dim-specialView",
        onSubmit: (event) => {
          event.preventDefault();
          if (valid && !busy) onSubmit(code);
        }
      },
      h(
        "div",
        { className: "dxw-stateLabel" },
        h("span", { className: "dxw-dot", "data-tone": "warning" }),
        h("span", null, "\u9700\u8981\u914D\u5BF9\u7801")
      ),
      h("h3", null, "\u8F93\u5165\u624B\u673A\u5FAE\u4FE1\u663E\u793A\u7684\u6570\u5B57"),
      h("p", null, "\u8FD9\u662F\u5FAE\u4FE1\u9644\u52A0\u7684\u5B89\u5168\u786E\u8BA4\u6B65\u9AA4\u3002\u914D\u5BF9\u7801\u53EA\u7528\u4E8E\u672C\u6B21\u626B\u7801\u8F6E\u8BE2\uFF0C\u4E0D\u4F1A\u5199\u5165\u914D\u7F6E\u6216\u65E5\u5FD7\u3002"),
      h(
        "div",
        { className: "dxw-codeRow" },
        h("input", {
          className: "dxw-input",
          value: code,
          inputMode: "numeric",
          autoComplete: "one-time-code",
          maxLength: 8,
          "aria-label": "\u5FAE\u4FE1\u914D\u5BF9\u7801",
          onChange: (event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8)),
          autoFocus: true
        }),
        h(ActionButton, {
          type: "submit",
          className: "dxw-button",
          "data-kind": "primary",
          disabled: !valid || busy,
          loading: busy
        }, "\u7EE7\u7EED\u8FDE\u63A5")
      ),
      h(Button12, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88\u7ED1\u5B9A")
    )
  );
}
function ProgressPanel2({ scanned, onCancel, busy }) {
  return h(
    "div",
    { className: "dxw-card dxw-loading dim-surfaceCard dim-loadingView", "aria-busy": "true" },
    h("div", { className: "dxw-spinner dim-spinner" }),
    h("h3", null, scanned ? "\u5FAE\u4FE1\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u542F\u52A8\u6D88\u606F\u8FDE\u63A5" : "\u6B63\u5728\u51C6\u5907\u5FAE\u4FE1\u4E8C\u7EF4\u7801"),
    h("p", null, scanned ? "\u6B63\u5728\u4FDD\u5B58\u51ED\u636E\u5E76\u9A8C\u8BC1 Harness \u4E0E\u5FAE\u4FE1\u957F\u8F6E\u8BE2\u3002" : "\u6B63\u5728\u8054\u7CFB\u817E\u8BAF\u5FAE\u4FE1 iLink \u670D\u52A1\u3002"),
    onCancel ? h(
      "div",
      { className: "dxw-actions dim-viewActions", style: { justifyContent: "center", marginTop: 14 } },
      h(Button12, { onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
    ) : null
  );
}
function ProvisionError3({ provision, busy, onRetry, onClose }) {
  const error = provision.error ?? { code: "WEIXIN_PROVISION_FAILED", message: "\u5FAE\u4FE1\u7ED1\u5B9A\u6CA1\u6709\u5B8C\u6210" };
  return h(
    "div",
    { className: "dxw-card dim-surfaceCard" },
    h(
      "div",
      { className: "dxw-error dim-inlineError", role: "alert" },
      h("h3", null, provision.status === "expired" ? "\u4E8C\u7EF4\u7801\u5DF2\u8FC7\u671F" : "\u5FAE\u4FE1\u6CA1\u6709\u7ED1\u5B9A\u5B8C\u6210"),
      h("p", null, error.message),
      h("span", { className: "dxw-errorCode" }, error.code),
      h(
        "div",
        { className: "dxw-actions dim-viewActions" },
        h(Button12, { kind: "primary", onClick: onRetry, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
        h(Button12, { onClick: onClose, disabled: busy }, "\u5173\u95ED")
      )
    )
  );
}
function checkedTime5(timestamp7) {
  if (!timestamp7) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(timestamp7));
  } catch {
    return "\u521A\u521A";
  }
}
function AccountCard4({
  account,
  busy,
  feedback,
  removing,
  removeError,
  removeFeedbackSequence,
  onReconnect,
  onWorkspaceSave,
  onAgentPresetSave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove
}) {
  const state = busy === "reconnect" ? "connecting" : account.state;
  const tone = account.connected ? "success" : state === "error" ? "error" : "warning";
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h(
    "article",
    { className: "dxw-card dim-botCard", tabIndex: -1, "data-bot-id": account.botId },
    h(
      "div",
      { className: "dxw-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "dxw-accountTop dim-botCardTop" },
        h(
          "div",
          { className: "dxw-accountIdentity dim-botIdentity" },
          h("div", { className: "dxw-avatar dim-botAvatar", "aria-hidden": "true" }, h(WeixinLogoGlyph, { size: 27 })),
          h("div", { className: "dim-botName" }, h("h3", null, account.bot.name), h("p", null, account.bot.accountIdMasked))
        ),
        h(BotStatusMeta, {
          className: "dxw-health",
          dotClassName: "dxw-dot",
          tone,
          stateLabel: account.connected ? "\u8FD0\u884C\u6B63\u5E38" : state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA",
          lastCheckedAt: account.health.lastCheckedAt,
          formatCheckedTime: checkedTime5
        })
      ),
      h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(
        "div",
        { className: "dxw-accountFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "dxw-actions dim-cardActions" },
            h(
              Button12,
              { className: "dim-cardAction", onClick: onReconnect, disabled: Boolean(busy), loading: busy === "reconnect" },
              account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"
            ),
            h(Button12, { className: "dim-cardAction", kind: "danger", onClick: onRequestRemove, disabled: Boolean(busy) }, "\u79FB\u9664\u63A5\u5165")
          ),
          summary ? h("div", { className: "dxw-summary dim-cardSummary" }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: "dxw-summary",
            error: account.lastMessageError
          }) : null,
          null
        )
      )
    ),
    removing ? h(
      ConfirmDialog,
      { className: "dxw-confirm dim-confirm", role: "alertdialog", onClose: onCancelRemove, busy: Boolean(busy), error: removeError, feedbackSequence: removeFeedbackSequence },
      h("strong", null, "\u4ECE\u6B64 Harness \u79FB\u9664\u8FD9\u4E2A\u5FAE\u4FE1\u8D26\u53F7\uFF1F"),
      h("p", null, "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 bot_token\u3001\u8D26\u53F7\u914D\u7F6E\u548C\u4F1A\u8BDD\u6620\u5C04\u3002\u5176\u4ED6\u5FAE\u4FE1\u8D26\u53F7\u4E0D\u53D7\u5F71\u54CD\u3002"),
      h(
        "div",
        { className: "dxw-actions dim-viewActions" },
        h(Button12, { onClick: onCancelRemove, disabled: busy === "delete" }, "\u4FDD\u7559\u8D26\u53F7"),
        h(
          Button12,
          { kind: "danger", onClick: onConfirmRemove, disabled: busy === "delete", loading: busy === "delete" },
          "\u786E\u8BA4\u79FB\u9664"
        )
      )
    ) : null
  );
}
function AccountList2(props) {
  return h(
    "section",
    { className: "dim-listSection" },
    h(ChannelListHeading, {
      className: "dxw-listHeading",
      title: "\u5DF2\u63A5\u5165\u7684\u5FAE\u4FE1\u8D26\u53F7",
      connectionLabel: "iLink \u957F\u8F6E\u8BE2"
    }),
    h("ul", { className: "dxw-list dim-botList" }, props.bots.map((account) => h(
      "li",
      { key: account.botId },
      h(AccountCard4, {
        account,
        busy: props.busyByBot[account.botId],
        feedback: props.feedbackByBot[account.botId],
        removing: props.removeTarget === account.botId,
        removeError: props.removeErrorsByBot[account.botId]?.message,
        removeFeedbackSequence: props.removeErrorsByBot[account.botId]?.sequence,
        onReconnect: () => props.onReconnect(account),
        onWorkspaceSave: (workspace) => props.onWorkspaceSave(account, workspace),
        onAgentPresetSave: (agentPreset) => props.onAgentPresetSave(account, agentPreset),
        onRequestRemove: () => props.onRequestRemove(account),
        onConfirmRemove: () => props.onConfirmRemove(account),
        onCancelRemove: props.onCancelRemove
      })
    )))
  );
}
var EMPTY_TOTALS3 = Object.freeze({ configured: 0, connected: 0 });
function mergeWeixinProvisioningSnapshot(current, incoming, { restoreProvisioning = false } = {}) {
  if (!incoming || !current && !restoreProvisioning) return current;
  if (current && current.attemptId !== incoming.attemptId) return current;
  return {
    ...current,
    ...incoming,
    durationMs: current?.durationMs ?? 5 * 6e4
  };
}
function WeixinSettingsTab({ rpcCall }) {
  const [model, setModel] = React19.useState({
    phase: "loading",
    bots: [],
    totals: EMPTY_TOTALS3,
    revision: 0,
    error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [provision, setProvision] = React19.useState(null);
  const [busy, setBusy] = React19.useState(false);
  const [busyByBot, setBusyByBot] = React19.useState({});
  const [feedbackByBot, setFeedbackByBot] = React19.useState({});
  const [removeTarget, setRemoveTarget] = React19.useState(null);
  const [removeErrorsByBot, setRemoveErrorsByBot] = React19.useState({});
  const [notice, setNotice] = React19.useState("");
  const [now, setNow] = React19.useState(() => Date.now());
  const addButtonRef = React19.useRef(null);
  const mountedRef = React19.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const scheduleAnimationFrame = useAnimationFrameScheduler();
  React19.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const announce = React19.useCallback((value) => {
    setNotice("");
    scheduleAnimationFrame(() => {
      if (value) setNotice(value);
    }, "announcement");
  }, [scheduleAnimationFrame]);
  const invoke = React19.useCallback(async (endpoint, payload = {}, signal) => {
    return unwrapRpcResult8(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const loadStatus = React19.useCallback(async ({
    signal,
    silent = false,
    restoreProvisioning = false
  } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null || !mountedRef.current) return void 0;
    if (!silent) setModel((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const snapshot = normalizeSnapshot7(await invoke(WEIXIN_ENDPOINTS.status, {}, signal));
      if (signal?.aborted || !mountedRef.current || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      setModel({
        phase: "ready",
        bots: snapshot.bots,
        totals: snapshot.totals,
        revision: snapshot.revision,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
      });
      if (snapshot.provisioning) {
        setProvision((current) => mergeWeixinProvisioningSnapshot(
          current,
          snapshot.provisioning,
          { restoreProvisioning }
        ));
      }
      return snapshot;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || !mountedRef.current || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      setModel((current) => ({
        ...current,
        phase: silent && current.phase === "ready" ? "ready" : "error",
        error: presentError8(error)
      }));
      return void 0;
    }
  }, [invoke, workspaceFence]);
  React19.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restoreProvisioning: true });
    return () => controller.abort();
  }, [loadStatus]);
  React19.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    let running = false;
    const timer = window.setInterval(async () => {
      if (running) return;
      running = true;
      await loadStatus({
        signal: controller.signal,
        silent: true,
        restoreProvisioning: false
      });
      running = false;
    }, 15e3);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React19.useEffect(() => {
    if (!provision || !["pending", "scanned"].includes(provision.status)) return void 0;
    const timer = window.setInterval(() => setNow(Date.now()), 1e3);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);
  const startProvisioning = React19.useCallback(async ({ replace = false } = {}) => {
    setBusy(true);
    try {
      if (replace && provision?.attemptId) {
        await invoke(WEIXIN_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      setProvision({ status: "starting" });
      const started = normalizeProvisioning5(await invoke(WEIXIN_ENDPOINTS.beginProvisioning, { locale: "zh-CN" }));
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
      announce("\u5FAE\u4FE1\u4E8C\u7EF4\u7801\u5DF2\u751F\u6210\uFF0C\u8BF7\u4F7F\u7528\u624B\u673A\u5FAE\u4FE1\u626B\u63CF\u3002");
    } catch (error) {
      setProvision({
        status: "failed",
        error: presentError8(error),
        ...provision?.attemptId ? { attemptId: provision.attemptId } : {}
      });
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);
  const cancelProvisioning = React19.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && !["failed", "expired", "cancelled"].includes(provision.status)) {
        await invoke(WEIXIN_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      setProvision(null);
      announce("\u5DF2\u53D6\u6D88\u5FAE\u4FE1\u7ED1\u5B9A\u3002");
      scheduleAnimationFrame(() => addButtonRef.current?.focus(), "focus");
    } catch (error) {
      setProvision((current) => ({ ...current, status: "failed", error: presentError8(error) }));
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId, provision?.status, scheduleAnimationFrame]);
  const submitVerification = React19.useCallback(async (verifyCode) => {
    if (!provision?.attemptId) return;
    setBusy(true);
    try {
      const next = normalizeProvisioning5(await invoke(WEIXIN_ENDPOINTS.submitVerification, {
        attemptId: provision.attemptId,
        verifyCode
      }));
      setProvision((current) => ({ ...current, ...next }));
      announce("\u914D\u5BF9\u7801\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u7B49\u5F85\u5FAE\u4FE1\u786E\u8BA4\u3002");
    } catch (error) {
      setProvision((current) => ({ ...current, status: "failed", error: presentError8(error) }));
    } finally {
      setBusy(false);
    }
  }, [announce, invoke, provision?.attemptId]);
  React19.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !["pending", "scanned", "connecting"].includes(provision.status)) return void 0;
    const controller = new AbortController();
    const scheduler = createPollScheduler({
      setTimeoutFn: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeoutFn: (timer) => window.clearTimeout(timer)
    });
    const poll = async () => {
      try {
        const result = normalizeProvisioning5(await invoke(
          WEIXIN_ENDPOINTS.pollProvisioning,
          { attemptId },
          controller.signal
        ));
        if (scheduler.disposed) return;
        if (result.status === "connected") {
          const snapshot = await loadStatus({
            signal: controller.signal,
            silent: true,
            restoreProvisioning: false
          });
          if (scheduler.disposed) return;
          const account = snapshot?.bots.find((bot) => bot.botId === result.botId);
          if (!account?.connected) {
            setProvision((current) => current?.attemptId === attemptId ? { ...current, ...result, status: "connecting" } : current);
            scheduler.schedule(poll, result.pollIntervalMs);
            return;
          }
          setProvision(null);
          announce(result.alreadyConnected ? "\u8FD9\u4E2A\u5FAE\u4FE1\u8D26\u53F7\u5DF2\u7ECF\u7ED1\u5B9A\u5E76\u4FDD\u6301\u5728\u7EBF\u3002" : "\u5FAE\u4FE1\u5DF2\u7ED1\u5B9A\uFF0C\u53EF\u4EE5\u5F00\u59CB\u5411\u5DF2\u7ED1\u5B9A\u7684\u673A\u5668\u4EBA\u53D1\u6D88\u606F\u3002");
          return;
        }
        setProvision((current) => current?.attemptId === attemptId ? { ...current, ...result, durationMs: current.durationMs } : current);
        if (["pending", "scanned", "connecting"].includes(result.status)) {
          scheduler.schedule(poll, result.pollIntervalMs);
        }
      } catch (error) {
        if (scheduler.disposed || error?.name === "AbortError") return;
        setProvision((current) => current?.attemptId === attemptId ? { ...current, status: "failed", error: presentError8(error) } : current);
      }
    };
    scheduler.schedule(poll, provision.pollIntervalMs ?? 1e3);
    return () => {
      scheduler.dispose();
      controller.abort();
    };
  }, [announce, invoke, loadStatus, provision?.attemptId, provision?.status, provision?.pollIntervalMs]);
  const setBotBusy = React19.useCallback((botId, value) => {
    setBusyByBot((current) => {
      const next = { ...current };
      if (value) next[botId] = value;
      else delete next[botId];
      return next;
    });
  }, []);
  const reconnect = React19.useCallback(async (account) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "reconnect");
    setFeedbackByBot((current) => {
      const next = { ...current };
      delete next[account.botId];
      return next;
    });
    try {
      const snapshot = normalizeSnapshot7(await invoke(
        WEIXIN_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel((current) => ({
          ...current,
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog
        }));
      }
      const refreshed = snapshot.bots.find((bot) => bot.botId === account.botId);
      let feedback;
      if (!refreshed?.connected) {
        feedback = "\u5FAE\u4FE1\u4ECD\u672A\u8FDE\u63A5\uFF0C\u63D2\u4EF6\u4F1A\u7EE7\u7EED\u81EA\u52A8\u91CD\u8BD5\u3002";
      } else if (snapshot.testMessage?.sent) {
        feedback = "\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\u3002";
      } else if (snapshot.testMessage?.code === "test-target-unavailable") {
        feedback = "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002\u673A\u5668\u4EBA\u5C1A\u672A\u6536\u5230\u53EF\u7528\u4E8E\u6D4B\u8BD5\u7684\u79C1\u804A\u6D88\u606F\u3002";
      } else if (snapshot.testMessage) {
        feedback = "\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002";
      } else {
        feedback = "\u5FAE\u4FE1\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\u3002";
      }
      if (mountedRef.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    } catch {
      const feedback = "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
      if (mountedRef.current) {
        setFeedbackByBot((current) => ({ ...current, [account.botId]: feedback }));
      }
      announce(feedback);
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(account.botId, null);
    }
  }, [announce, invoke, loadStatus, setBotBusy, workspaceFence]);
  const saveWorkspace = React19.useCallback(async (account, workspace) => {
    const workspaceVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "workspace");
    try {
      const snapshot = normalizeSnapshot7(await invoke(
        WEIXIN_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(workspaceVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [invoke, loadStatus, setBotBusy, workspaceFence]);
  const saveAgentPreset = React19.useCallback(async (account, agentPreset) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "preset");
    try {
      const snapshot = normalizeSnapshot7(await invoke(
        WEIXIN_ENDPOINTS.setAgentPreset,
        { botId: account.botId, agentPreset }
      ));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      if (mountedRef.current) setBotBusy(account.botId, null);
    }
  }, [invoke, loadStatus, setBotBusy, workspaceFence]);
  const remove = React19.useCallback(async (account) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBotBusy(account.botId, "delete");
    try {
      const snapshot = normalizeSnapshot7(await invoke(WEIXIN_ENDPOINTS.deleteBot, {
        botId: account.botId,
        confirm: true
      }));
      if (mountedRef.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel((current) => ({
          ...current,
          bots: snapshot.bots,
          totals: snapshot.totals,
          revision: snapshot.revision,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? current.agentPresetCatalog
        }));
      }
      setRemoveTarget(null);
      setRemoveErrorsByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
      announce("\u5FAE\u4FE1\u8D26\u53F7\u53CA\u672C\u673A\u51ED\u636E\u5DF2\u79FB\u9664\u3002");
    } catch (error) {
      if (mountedRef.current) setRemoveErrorsByBot((current) => ({
        ...current,
        [account.botId]: {
          message: `\u79FB\u9664\u5931\u8D25\uFF1A${presentError8(error).message}`,
          sequence: (current[account.botId]?.sequence ?? 0) + 1
        }
      }));
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mountedRef.current) void loadStatus({ silent: true });
      setBotBusy(account.botId, null);
    }
  }, [announce, invoke, loadStatus, setBotBusy, workspaceFence]);
  let provisionView = null;
  if (provision?.status === "starting") {
    provisionView = h(ProgressPanel2, { busy });
  } else if (["pending", "scanned"].includes(provision?.status)) {
    provisionView = h(QrPanel4, {
      provision,
      now,
      busy,
      onRefresh: () => void startProvisioning({ replace: true }),
      onCancel: () => void cancelProvisioning()
    });
  } else if (provision?.status === "needs_verification") {
    provisionView = h(VerificationPanel, {
      provision,
      busy,
      onSubmit: (code) => void submitVerification(code),
      onCancel: () => void cancelProvisioning()
    });
  } else if (provision?.status === "connecting") {
    provisionView = h(ProgressPanel2, {
      scanned: true,
      busy,
      onCancel: () => void cancelProvisioning()
    });
  } else if (provision && ["failed", "expired", "cancelled"].includes(provision.status)) {
    provisionView = h(ProvisionError3, {
      provision,
      busy,
      onRetry: () => void startProvisioning({ replace: Boolean(provision.attemptId) }),
      onClose: () => void cancelProvisioning()
    });
  }
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    { className: "dxw-page dim-channelPage", "aria-label": "\u5FAE\u4FE1\u8BBE\u7F6E" },
    h(Heading5, {
      totals: model.totals,
      adding: Boolean(provision),
      busy,
      onAdd: () => void startProvisioning(),
      addButtonRef
    }),
    notice ? h(FeedbackToast, { text: notice }) : null,
    Object.entries(removeErrorsByBot).map(([botId, failure]) => botId !== removeTarget ? h(FeedbackToast, { key: botId, text: failure.message, tone: "error", sequence: failure.sequence }) : null),
    model.error && model.phase === "ready" ? h(FeedbackToast, { text: `\u72B6\u6001\u5237\u65B0\u5931\u8D25\uFF1A${model.error.message}`, tone: "error" }) : null,
    model.phase === "loading" ? h(LoadingView5) : model.phase === "error" ? h(
      "div",
      { className: "dxw-card dim-surfaceCard" },
      h(
        "div",
        { className: "dxw-error dim-inlineError" },
        h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6\u5FAE\u4FE1\u72B6\u6001"),
        h("p", null, model.error?.message ?? "\u8BF7\u7A0D\u540E\u91CD\u8BD5"),
        h(Button12, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6")
      )
    ) : h(
      React19.Fragment,
      null,
      provisionView,
      model.bots.length === 0 && !provision ? h(EmptyView5, { onStart: () => void startProvisioning(), busy }) : null,
      model.bots.length > 0 ? h(AccountList2, {
        bots: model.bots,
        busyByBot,
        feedbackByBot,
        removeTarget,
        removeErrorsByBot,
        onReconnect: (account) => void reconnect(account),
        onWorkspaceSave: saveWorkspace,
        onAgentPresetSave: saveAgentPreset,
        onRequestRemove: (account) => setRemoveTarget(account.botId),
        onConfirmRemove: (account) => void remove(account),
        onCancelRemove: () => setRemoveTarget(null)
      }) : null
    )
  ));
}

// plugin-src/client/channels/weixin/styles.js
var WEIXIN_STYLE_ID = "xmanrui-dsh-im-weixin-settings";
var CSS9 = String.raw`
.dxw-page {
  --dxw-accent: #07c160;
  --dxw-accent-dark: #05994c;
  --dxw-success: var(--dsw-alias-state-success-primary, #20a162);
  --dxw-warning: var(--dsw-alias-state-warn-primary, #d97706);
  --dxw-error: var(--dsw-alias-state-error-primary, #d54941);
  width: 100%;
  max-width: 880px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 2px 0 28px;
  color: var(--dsw-alias-label-primary, #1f2329);
  box-sizing: border-box;
}
.dxw-page *, .dxw-page *::before, .dxw-page *::after { box-sizing: border-box; }
.dxw-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.dxw-heading h2, .dxw-heading p, .dxw-card h3, .dxw-card p { margin: 0; }
.dxw-eyebrow { color: var(--dsw-alias-label-tertiary, #8f959e); font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 3px; }
.dxw-heading h2 { font-size: 20px; line-height: 28px; font-weight: 700; }
.dxw-heading p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 20px; margin-top: 5px; white-space: nowrap; }
.dxw-tools, .dxw-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.dxw-tools { width: 100%; justify-content: space-between; flex-wrap: nowrap; }
.dxw-badge { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 11px; border-radius: 999px; color: var(--dsw-alias-label-secondary, #646a73); background: var(--dsw-alias-bg-module-platform, #f2f3f5); font-size: 12px; white-space: nowrap; }
.dxw-dot { width: 8px; height: 8px; border-radius: 50%; background: #aeb3bb; flex: none; }
.dxw-dot[data-tone="success"] { background: var(--dxw-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dxw-success) 14%, transparent); }
.dxw-dot[data-tone="warning"] { background: var(--dxw-warning); }
.dxw-dot[data-tone="error"] { background: var(--dxw-error); }
.dxw-button { height: 36px; min-height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; color: var(--dsw-alias-label-primary); background: transparent; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; box-shadow: none; transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.dxw-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); }
.dxw-button:active:not(:disabled) { transform: translateY(1px); }
.dxw-button:focus-visible, .dxw-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dxw-button:disabled { cursor: not-allowed; opacity: .55; }
.dxw-button[data-kind="primary"] { color: var(--dsw-alias-label-primary-foreground); border: none; background: var(--dsw-alias-button-primary-fill); }
.dxw-button[data-kind="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dxw-button[data-kind="danger"] { color: var(--dxw-error); }
.dxw-card { overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: none; }
.dxw-cardBody { padding: 24px; }
.dxw-empty { min-height: 230px; display: grid; grid-template-columns: minmax(0, 1fr) 180px; align-items: center; gap: 30px; }
.dxw-empty h3 { font-size: 18px; margin-bottom: 8px; }
.dxw-empty p { max-width: 560px; color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.65; }
.dxw-empty .dxw-actions { margin-top: 20px; }
.dxw-logo { width: 110px; height: 110px; display: grid; place-items: center; justify-self: center; border-radius: 28px; color: white; background: var(--dxw-accent); box-shadow: none; }
.dxw-logo svg { width: 62px; height: 62px; }
.dxw-qrLayout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 34px; align-items: center; }
.dxw-qrColumn { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dxw-qrFrame { position: relative; width: 270px; aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; padding: 10px; border: 1px solid var(--dsw-alias-border-l2, #e5e6eb); border-radius: 16px; background: white; }
.dxw-qrFrame img { display: block; width: 100%; height: 100%; object-fit: contain; }
.dxw-qrFallback { padding: 24px; text-align: center; color: #646a73; }
.dxw-expired { position: absolute; inset: 0; display: grid; place-items: center; padding: 30px; color: white; text-align: center; font-weight: 600; background: rgb(31 35 41 / 76%); backdrop-filter: blur(3px); }
.dxw-countdown { width: 270px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.dxw-countdown div { display: flex; justify-content: space-between; margin-bottom: 6px; }
.dxw-progress { height: 4px; overflow: hidden; border-radius: 99px; background: #eef0f3; }
.dxw-progress span { display: block; width: var(--dxw-progress); height: 100%; background: var(--dsw-alias-state-business-primary); transition: width .2s linear; }
.dxw-qrCopy h3 { margin: 9px 0 8px; font-size: 18px; }
.dxw-qrCopy > p { color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.65; }
.dxw-steps { margin: 18px 0 22px; padding-left: 22px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 13px; line-height: 1.9; }
.dxw-stateLabel { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; font-weight: 600; }
.dxw-verify { max-width: 560px; margin: 0 auto; padding: 32px; text-align: center; }
.dxw-verify h3 { margin: 8px 0; font-size: 19px; }
.dxw-verify p { color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.6; }
.dxw-codeRow { display: flex; justify-content: center; gap: 10px; margin: 24px 0 10px; }
.dxw-input { width: 190px; height: 42px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; background: var(--dsw-alias-bg-layer-1, white); color: inherit; font: inherit; font-size: 18px; letter-spacing: .16em; text-align: center; }
.dxw-statusNotice, .dxw-error { display: flex; align-items: center; gap: 10px; padding: 13px 15px; border: 1px solid color-mix(in srgb, var(--dxw-error) 28%, transparent); border-radius: 10px; color: var(--dxw-error); background: color-mix(in srgb, var(--dxw-error) 7%, transparent); font-size: 13px; }
.dxw-error { align-items: flex-start; flex-direction: column; padding: 22px; }
.dxw-error h3 { font-size: 17px; }
.dxw-errorCode { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; opacity: .8; }
.dxw-listHeading { display: flex; justify-content: space-between; align-items: center; margin: 2px 0 9px; }
.dxw-listHeading h3 { margin: 0; font-size: 14px; }
.dxw-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.dxw-accountTop { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dxw-accountIdentity { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dxw-avatar { width: 42px; height: 42px; display: grid; place-items: center; flex: none; border-radius: 12px; color: white; background: var(--dxw-accent); }
.dxw-accountIdentity h3 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.dxw-accountIdentity p { color: var(--dsw-alias-label-secondary, #646a73); font: 12px ui-monospace, SFMono-Regular, monospace; margin-top: 4px; }
.dxw-health { display: inline-flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; white-space: nowrap; }
.dxw-accountFooter { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1, #eef0f3); }
.dxw-accountFooter .dxw-actions { flex: none; flex-wrap: nowrap; gap: 8px; margin-top: 0; }
.dxw-accountFooter .dxw-button { flex: none; white-space: nowrap; }
.dxw-summary { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; }
.dxw-confirm { padding: 18px 24px; border-top: 1px solid color-mix(in srgb, var(--dxw-error) 25%, transparent); background: color-mix(in srgb, var(--dxw-error) 5%, transparent); }
.dxw-confirm strong { display: block; font-size: 14px; margin-bottom: 6px; }
.dxw-confirm p { color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; line-height: 1.55; }
.dxw-confirm .dxw-actions { margin-top: 13px; }
.dxw-loading { padding: 36px; color: var(--dsw-alias-label-secondary, #646a73); text-align: center; }
.dxw-spinner { width: 24px; height: 24px; margin: 0 auto 12px; border: 3px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-state-business-primary); border-radius: 50%; animation: dxw-spin .8s linear infinite; }
.dxw-visuallyHidden { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@keyframes dxw-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .dxw-heading, .dxw-accountTop { flex-direction: column; align-items: stretch; }
  .dxw-empty { grid-template-columns: minmax(0, 1fr); }
  .dxw-logo { display: none; }
  .dxw-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .dxw-qrCopy { width: 100%; }
  .dxw-cardBody { padding: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .dxw-page *, .dxw-page *::before, .dxw-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;
function installWeixinStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${WEIXIN_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = WEIXIN_STYLE_ID;
  style.textContent = CSS9;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/whatsapp/api.js
var WHATSAPP_RPC_CHANNEL = "/whatsapp";
var WHATSAPP_ENDPOINTS = Object.freeze({
  status: "connection.status",
  beginProvisioning: "provision.begin",
  pollProvisioning: "provision.poll",
  cancelProvisioning: "provision.cancel",
  reconnectBot: "bot.reconnect",
  deleteBot: "bot.delete",
  setAccessPolicy: "bot.access-policy.set",
  setWorkspace: "bot.workspace.set",
  setAgentPreset: SET_AGENT_PRESET_ENDPOINT
});
var PROVISION_STATES5 = /* @__PURE__ */ new Set(["starting", "pending", "connecting", "connected", "failed", "cancelled"]);
var BOT_STATES = /* @__PURE__ */ new Set(["connected", "connecting", "offline", "error"]);
var QR_DATA_URL4 = /^data:image\/(?:png|webp);base64,[a-z\d+/]+={0,2}$/i;
function isRecord7(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text5(value, fallback, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}
function id4(value) {
  const result = text5(value, "", 128);
  return /^[a-z\d_-]+$/i.test(result) ? result : void 0;
}
function timestamp6(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function unwrapRpcResult9(result) {
  if (!isRecord7(result) || typeof result.ok !== "boolean") {
    throw new Error("WhatsApp \u670D\u52A1\u8FD4\u56DE\u4E86\u65E0\u6CD5\u8BC6\u522B\u7684\u54CD\u5E94");
  }
  if (!result.ok) {
    const error = new Error(text5(result.error?.message, "WhatsApp \u64CD\u4F5C\u5931\u8D25"));
    error.code = text5(result.error?.code, "WHATSAPP_RPC_ERROR", 80);
    throw error;
  }
  return result.value;
}
function safeQrSource6(value) {
  return typeof value === "string" && value.length <= 2 * 1024 * 1024 && QR_DATA_URL4.test(value) ? value : void 0;
}
function normalizeProvisioning6(value, now = Date.now()) {
  const source = isRecord7(value?.provisioning) ? value.provisioning : value;
  if (!isRecord7(source)) throw new Error("WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u626B\u7801\u8FDB\u5EA6");
  const attemptId = id4(source.attemptId);
  if (!attemptId) throw new Error("WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u626B\u7801\u4EFB\u52A1");
  const reported = text5(source.status, "failed", 32);
  const result = {
    attemptId,
    status: PROVISION_STATES5.has(reported) ? reported : "failed",
    expiresAt: timestamp6(source.expiresAt) ?? now + 6e4,
    pollIntervalMs: Math.min(5e3, Math.max(500, Number(source.pollIntervalMs) || 1e3)),
    qrRevision: Number.isSafeInteger(source.qrRevision) ? source.qrRevision : 0
  };
  const qrCodeDataUrl = safeQrSource6(source.qrCodeDataUrl);
  if (qrCodeDataUrl) result.qrCodeDataUrl = qrCodeDataUrl;
  if (id4(source.botId)) result.botId = id4(source.botId);
  if (isRecord7(source.error)) result.error = {
    code: text5(source.error.code, "WHATSAPP_PROVISION_FAILED", 80),
    message: text5(source.error.message, "WhatsApp \u6CA1\u6709\u63A5\u5165\u5B8C\u6210")
  };
  return result;
}
function normalizeBot6(value) {
  if (!isRecord7(value) || !id4(value.botId)) return void 0;
  const connected = value.connected === true;
  const state = BOT_STATES.has(value.state) ? value.state : "offline";
  return {
    botId: id4(value.botId),
    connected,
    state: connected ? "connected" : state,
    workspace: text5(value.workspace, "", 4096),
    agentPreset: normalizeAgentPresetId(value.agentPreset),
    accessPolicy: {
      accessMode: ["self-only", "private-allowlist", "open"].includes(
        value.accessPolicy?.accessMode
      ) ? value.accessPolicy.accessMode : "self-only",
      allowedNumbers: Array.isArray(value.accessPolicy?.allowedNumbers) ? [...new Set(value.accessPolicy.allowedNumbers.filter((entry) => typeof entry === "string" && /^[1-9]\d{4,14}$/.test(entry)))] : []
    },
    bot: {
      name: text5(value.bot?.name, "WhatsApp\u673A\u5668\u4EBA", 100),
      idMasked: text5(value.bot?.idMasked, "WhatsApp\u8D26\u53F7", 140)
    },
    health: {
      summary: text5(value.health?.summary, connected ? "WhatsApp Web \u5173\u8054\u8BBE\u5907\u8FD0\u884C\u6B63\u5E38" : "WhatsApp \u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA"),
      lastCheckedAt: timestamp6(value.health?.lastCheckedAt)
    },
    lastMessageError: normalizeLastMessageError(value.lastMessageError),
    error: isRecord7(value.error) ? {
      code: text5(value.error.code, "WHATSAPP_ACCOUNT_ERROR", 80),
      message: text5(value.error.message, "WhatsApp \u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA")
    } : null
  };
}
function normalizeSnapshot8(value) {
  const source = isRecord7(value?.snapshot) ? value.snapshot : value;
  if (!isRecord7(source) || !Array.isArray(source.bots)) {
    throw new Error("WhatsApp \u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u673A\u5668\u4EBA\u5217\u8868");
  }
  const bots = source.bots.map(normalizeBot6).filter(Boolean);
  return {
    revision: Number.isSafeInteger(source.revision) ? source.revision : 0,
    bots,
    totals: { configured: bots.length, connected: bots.filter((bot) => bot.connected).length },
    provisioning: source.provisioning ? normalizeProvisioning6(source.provisioning) : null,
    agentPresetCatalog: normalizeAgentPresetCatalog(source.agentPresetCatalog)
  };
}
function presentError9(error) {
  return {
    code: text5(error?.code, "WHATSAPP_ERROR", 80),
    message: text5(error?.message, "WhatsApp \u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")
  };
}
function formatRemaining6(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1e3) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// plugin-src/client/channels/whatsapp/index.js
var React20 = __toESM(require("react"), 1);

// plugin-src/client/channels/whatsapp/styles.js
var WHATSAPP_STYLE_ID = "xmanrui-dsh-im-whatsapp-settings";
var CSS10 = String.raw`
.dwa-page { --ddt-accent: #25d366; --ddt-accent-deep: #128c7e; --ddt-accent-wash: #eafbf0; }
.dwa-avatar { color: #fff; background: #25d366; }
.dwa-avatar svg { display: block; }
.dwa-access { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dwa-accessHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dwa-accessHeading > strong { font-size: 13px; }
.dwa-accessStatus { min-width: 0; display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dwa-accessBadge { flex: none; padding: 3px 8px; border-radius: 999px; color: #08785f; background: #eafbf0; font-size: 11px; font-weight: 700; }
.dwa-accessBadge[data-mode="private-allowlist"] { color: #0f6f8f; background: #eaf7fd; }
.dwa-accessBadge[data-mode="open"] { color: #a15c00; background: #fff3d6; }
.dwa-accessHelp { position: relative; display: inline-flex; flex: none; }
.dwa-accessHelpButton { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); font: inherit; font-size: 12px; line-height: 1; font-weight: 700; cursor: help; }
.dwa-accessHelpButton:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dwa-accessHelpButton:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.dwa-accessTooltip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: 270px; max-width: min(290px, calc(100vw - 48px)); display: grid; gap: 8px; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l2, #dfe1e5); border-radius: 9px; color: var(--dsw-alias-label-primary, #1f2329); background: var(--dsw-alias-bg-layer-3, #fff); box-shadow: 0 10px 28px rgb(31 35 41 / 16%); opacity: 0; visibility: hidden; transform: translateY(-3px); pointer-events: none; transition: opacity .15s ease, transform .15s ease, visibility .15s ease; }
.dwa-accessTooltipItem { display: grid; gap: 2px; }
.dwa-accessTooltipItem + .dwa-accessTooltipItem { padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2, #eef0f3); }
.dwa-accessTooltipItem strong { font-size: 12px; line-height: 17px; }
.dwa-accessTooltipItem > span { color: var(--dsw-alias-label-secondary, #646a73); font-size: 11px; line-height: 16px; }
.dwa-accessHelp:hover .dwa-accessTooltip, .dwa-accessHelp:focus-within .dwa-accessTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dwa-accessField { display: grid; gap: 5px; color: var(--dsw-alias-label-primary, #1f2329); font-size: 12px; font-weight: 600; }
.dwa-accessField select, .dwa-accessField textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l1, #c9cdd4); border-radius: 7px; color: inherit; background: var(--dsw-alias-bg-layer-1, #fff); font: inherit; font-weight: 400; }
.dwa-accessField select { height: 34px; padding: 0 9px; }
.dwa-accessField textarea { min-height: 68px; padding: 8px 9px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dwa-accessField textarea:disabled { color: var(--dsw-alias-label-tertiary, #8f959e); background: var(--dsw-alias-bg-module-platform, #f2f3f5); cursor: not-allowed; resize: none; opacity: 1; }
.dwa-accessField small { color: var(--dsw-alias-label-secondary, #646a73); font-weight: 400; }
.dwa-accessWarning, .dwa-accessError { margin: 0; font-size: 12px; line-height: 1.5; }
.dwa-accessWarning { color: #a15c00; }
.dwa-accessError { color: var(--dsw-alias-state-error-primary, #d83931); }
.dwa-accessActions { display: flex; justify-content: flex-end; }
`;
function installWhatsappStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${WHATSAPP_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = WHATSAPP_STYLE_ID;
  style.textContent = CSS10;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/channels/whatsapp/index.js
var ACTIVE_STATES3 = /* @__PURE__ */ new Set(["pending", "connecting"]);
function accessPolicyFor(account) {
  const accessMode = ["self-only", "private-allowlist", "open"].includes(
    account?.accessPolicy?.accessMode
  ) ? account.accessPolicy.accessMode : "self-only";
  return {
    accessMode,
    allowedNumbers: Array.isArray(account?.accessPolicy?.allowedNumbers) ? account.accessPolicy.allowedNumbers : []
  };
}
function allowedNumbersFromText(value) {
  const entries = value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const normalized = entries.map((entry) => entry.replace(/^\+/, ""));
  if (normalized.some((entry) => !/^[1-9]\d{4,14}$/.test(entry))) {
    throw new TypeError("\u7535\u8BDD\u53F7\u7801\u5FC5\u987B\u5305\u542B\u56FD\u5BB6\u6216\u5730\u533A\u4EE3\u7801\uFF0C\u6BCF\u884C\u4E00\u4E2A\u3002");
  }
  return [...new Set(normalized)];
}
function WhatsappAccessSettings({ account, busy = false, onSave }) {
  const policy = accessPolicyFor(account);
  const sourceNumbers = policy.allowedNumbers.join("\n");
  const helpId = React20.useId();
  const [accessMode, setAccessMode] = React20.useState(policy.accessMode);
  const [allowedNumbers, setAllowedNumbers] = React20.useState(sourceNumbers);
  const [error, setError] = React20.useState(null);
  React20.useEffect(() => {
    setAccessMode(policy.accessMode);
    setAllowedNumbers(sourceNumbers);
    setError(null);
  }, [policy.accessMode, sourceNumbers]);
  const save = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      const normalized = allowedNumbersFromText(allowedNumbers);
      if (typeof onSave !== "function") throw new Error("WhatsApp \u8BBF\u95EE\u8BBE\u7F6E\u6682\u4E0D\u53EF\u7528\u3002");
      await onSave({ accessMode, allowedNumbers: normalized });
    } catch (caught) {
      setError(caught?.message ?? "WhatsApp \u8BBF\u95EE\u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\u3002");
    }
  };
  const allowlistEnabled = accessMode === "private-allowlist";
  const labels = {
    "self-only": "\u4EC5\u81EA\u5DF1\u6A21\u5F0F",
    "private-allowlist": "\u6307\u5B9A\u8054\u7CFB\u4EBA\u6A21\u5F0F",
    open: "\u5F00\u653E\u54CD\u5E94\u6A21\u5F0F"
  };
  return h(
    "form",
    { className: "dwa-access", onSubmit: save },
    h(
      "div",
      { className: "dwa-accessHeading" },
      h("strong", null, "\u8BBF\u95EE\u8BBE\u7F6E"),
      h(
        "span",
        { className: "dwa-accessStatus" },
        h(
          "span",
          { className: "dwa-accessBadge", "data-mode": policy.accessMode },
          ["\u5DF2\u751F\u6548\uFF1A", labels[policy.accessMode]]
        ),
        h(
          "span",
          { className: "dwa-accessHelp" },
          h("button", {
            type: "button",
            className: "dwa-accessHelpButton",
            "aria-label": "\u67E5\u770B WhatsApp \u8BBF\u95EE\u6A21\u5F0F\u8BF4\u660E",
            "aria-describedby": helpId
          }, h("span", { "aria-hidden": "true" }, "?")),
          h(
            "span",
            { id: helpId, className: "dwa-accessTooltip", role: "tooltip" },
            h(
              "span",
              { className: "dwa-accessTooltipItem" },
              h("strong", null, "\u4EC5\u81EA\u5DF1\u6A21\u5F0F"),
              h("span", null, "\u53EA\u54CD\u5E94\u5DF2\u7ED1\u5B9A WhatsApp \u8D26\u53F7\u7684\u81EA\u804A\u6D88\u606F\u3002")
            ),
            h(
              "span",
              { className: "dwa-accessTooltipItem" },
              h("strong", null, "\u6307\u5B9A\u8054\u7CFB\u4EBA\u6A21\u5F0F"),
              h("span", null, "\u54CD\u5E94\u81EA\u804A\u548C\u767D\u540D\u5355\u8054\u7CFB\u4EBA\u7684\u79C1\u804A\uFF0C\u5FFD\u7565\u7FA4\u804A\u3002")
            ),
            h(
              "span",
              { className: "dwa-accessTooltipItem" },
              h("strong", null, "\u5F00\u653E\u54CD\u5E94\u6A21\u5F0F"),
              h("span", null, "\u54CD\u5E94\u6240\u6709\u79C1\u804A\u3001\u5DF2\u7ED1\u5B9A\u8D26\u53F7\u81EA\u5DF1\u53D1\u51FA\u7684\u7FA4\u804A\u6D88\u606F\uFF0C\u4EE5\u53CA\u5176\u4ED6\u7FA4\u6210\u5458\u7684\u63D0\u53CA\u6216\u56DE\u590D\u3002")
            )
          )
        )
      )
    ),
    h(
      "label",
      { className: "dwa-accessField" },
      h("span", null, "\u6A21\u5F0F"),
      h(
        "select",
        {
          value: accessMode,
          disabled: busy,
          "aria-label": "WhatsApp \u8BBF\u95EE\u6A21\u5F0F",
          onChange: (event) => {
            setAccessMode(event.target.value);
            setError(null);
          }
        },
        h("option", { value: "self-only" }, "\u4EC5\u81EA\u5DF1\u6A21\u5F0F\uFF08\u9ED8\u8BA4\uFF09"),
        h("option", { value: "private-allowlist" }, "\u6307\u5B9A\u8054\u7CFB\u4EBA\u6A21\u5F0F"),
        h("option", { value: "open" }, "\u5F00\u653E\u54CD\u5E94\u6A21\u5F0F")
      )
    ),
    allowlistEnabled ? h(
      "label",
      { className: "dwa-accessField" },
      h("span", null, "\u5141\u8BB8\u79C1\u804A\u7684 WhatsApp \u7535\u8BDD\u53F7\u7801"),
      h("textarea", {
        value: allowedNumbers,
        disabled: busy,
        rows: 3,
        placeholder: "\u6BCF\u884C\u4E00\u4E2A\u542B\u56FD\u5BB6\u6216\u5730\u533A\u4EE3\u7801\u7684\u53F7\u7801",
        "aria-label": "\u5141\u8BB8\u79C1\u804A\u7684 WhatsApp \u7535\u8BDD\u53F7\u7801",
        onChange: (event) => {
          setAllowedNumbers(event.target.value);
          setError(null);
        }
      }),
      h("small", null, "\u53EF\u4EE5\u5305\u542B\u5F00\u5934\u7684 +\uFF0C\u4FDD\u5B58\u65F6\u4F1A\u81EA\u52A8\u79FB\u9664\u3002")
    ) : null,
    allowlistEnabled && allowedNumbers.trim() === "" ? h(
      "p",
      { className: "dwa-accessWarning", role: "status" },
      "\u767D\u540D\u5355\u4E3A\u7A7A\uFF1B\u4FDD\u5B58\u540E\u5C06\u53EA\u63A5\u53D7\u81EA\u804A\u6D88\u606F\u3002"
    ) : null,
    error ? h(FeedbackToast, { text: error, tone: "error" }) : null,
    h(
      "div",
      { className: "dwa-accessActions" },
      h(ActionButton, {
        type: "submit",
        className: "ddt-button",
        "data-kind": "secondary",
        disabled: busy,
        loading: busy
      }, "\u4FDD\u5B58\u8BBF\u95EE\u8BBE\u7F6E")
    )
  );
}
var Button14 = React20.forwardRef(function Button15({ children, kind = "secondary", className = "", ...props }, ref) {
  return h(ActionButton, {
    ...props,
    ref,
    type: "button",
    className: `ddt-button ${className}`.trim(),
    "data-kind": kind
  }, children);
});
function checkedTime6(value) {
  if (!value) return "\u5C1A\u672A\u68C0\u67E5";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date(value));
  } catch {
    return "\u521A\u521A";
  }
}
function connectionTestNotice3(value) {
  if (value?.testMessage?.sent === true) {
    return "\u6D4B\u8BD5\u6D88\u606F\u5DF2\u53D1\u9001\uFF0C\u8BF7\u5230 WhatsApp \u81EA\u804A\u4F1A\u8BDD\u4E2D\u786E\u8BA4\u3002";
  }
  if (value?.testMessage?.code === "test-target-unavailable") {
    return "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u7684 WhatsApp \u81EA\u804A\u76EE\u6807\u3002";
  }
  return value?.testMessage ? "\u8FDE\u63A5\u68C0\u67E5\u5B8C\u6210\uFF0C\u4F46\u6D4B\u8BD5\u6D88\u606F\u53D1\u9001\u5931\u8D25\u3002" : null;
}
function Heading6({ totals, busy, onAdd, addButtonRef }) {
  return h(
    "div",
    { className: "ddt-heading" },
    h(
      "div",
      { className: "ddt-tools" },
      h(
        "div",
        { className: "dim-bindActions" },
        h(Button14, {
          kind: "primary",
          className: "dim-scanButton",
          onClick: onAdd,
          disabled: busy,
          ref: addButtonRef,
          "aria-label": "\u626B\u7801\u63A5\u5165 WhatsApp \u673A\u5668\u4EBA",
          loading: busy
        }, h(QrActionIcon), "\u626B\u7801\u63A5\u5165\u673A\u5668\u4EBA")
      ),
      totals.configured > 0 ? h(
        "div",
        { className: "ddt-badge dim-onlineBadge" },
        h("span", null, `${totals.connected} / ${totals.configured} \u5728\u7EBF`)
      ) : null
    )
  );
}
function LoadingView6() {
  return h("div", {
    className: "ddt-card ddt-loading dim-surfaceCard dim-loadingView",
    "aria-busy": "true"
  }, h("div", { className: "ddt-spinner dim-spinner" }), "\u6B63\u5728\u8BFB\u53D6 WhatsApp \u673A\u5668\u4EBA\u72B6\u6001\u2026");
}
function EmptyView6({ busy, onStart }) {
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-empty dim-surfaceBody dim-emptyView" },
      h(
        "div",
        { className: "dim-emptyCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot" }),
          h("span", null, "\u5C1A\u672A\u63A5\u5165 WhatsApp \u673A\u5668\u4EBA")
        ),
        h("h3", null, "\u626B\u7801\u7ED1\u5B9A WhatsApp \u673A\u5668\u4EBA"),
        h("p", null, "\u4F7F\u7528\u624B\u673A WhatsApp \u626B\u63CF\u4E8C\u7EF4\u7801\u5373\u53EF\u63A5\u5165\u3002"),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(
            Button14,
            { kind: "primary", onClick: onStart, disabled: busy, loading: busy },
            "\u751F\u6210\u4E8C\u7EF4\u7801"
          )
        )
      ),
      h("div", {
        className: "ddt-brandMark dim-emptyBrand dwa-avatar",
        "aria-hidden": "true"
      }, h(WhatsappLogoGlyph, { size: 64 }))
    )
  );
}
function QrPanel5({ provision, now, busy, onRefresh, onCancel }) {
  const source = safeQrSource6(provision.qrCodeDataUrl);
  const remaining = Math.max(0, provision.expiresAt - now);
  const duration = Math.max(1, provision.durationMs ?? 6e4);
  const progress = Math.round(Math.min(1, remaining / duration) * 100);
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-cardBody ddt-qrLayout dim-surfaceBody dim-qrLayout" },
      h(
        "div",
        { className: "ddt-qrColumn dim-qrColumn" },
        h(
          "div",
          { className: "ddt-qrFrame dim-qrFrame" },
          source ? h("img", {
            src: source,
            alt: "\u7528\u4E8E\u5173\u8054 WhatsApp \u8BBE\u5907\u7684\u4E00\u6B21\u6027\u4E8C\u7EF4\u7801"
          }) : h("div", { className: "ddt-qrFallback dim-qrFallback" }, "\u4E8C\u7EF4\u7801\u6B63\u5728\u751F\u6210\u2026")
        ),
        h(
          "div",
          { className: "ddt-countdown dim-countdown" },
          h(
            "div",
            { className: "ddt-countdownTop dim-countdownTop" },
            h("span", null, "\u5F53\u524D\u4E8C\u7EF4\u7801\u6709\u6548\u65F6\u95F4"),
            h("strong", null, formatRemaining6(remaining))
          ),
          h("div", {
            className: "ddt-progress dim-progress",
            style: { "--ddt-progress": `${progress}%` }
          }, h("span"))
        )
      ),
      h(
        "div",
        { className: "ddt-qrCopy dim-qrCopy" },
        h(
          "div",
          { className: "ddt-stateLabel dim-stateLabel" },
          h("span", { className: "ddt-dot dim-stateDot", "data-tone": "warning" }),
          h("span", null, "\u7B49\u5F85 WhatsApp \u626B\u7801")
        ),
        h("h3", null, "\u7528\u624B\u673A WhatsApp \u626B\u63CF\u4E8C\u7EF4\u7801"),
        h(
          "ol",
          { className: "ddt-steps dim-steps" },
          h("li", null, "\u6253\u5F00 WhatsApp \u2192 \u8BBE\u7F6E \u2192 \u5DF2\u5173\u8054\u8BBE\u5907"),
          h("li", null, "\u70B9\u51FB\u201C\u5173\u8054\u8BBE\u5907\u201D\u5E76\u626B\u63CF\u5DE6\u4FA7\u4E8C\u7EF4\u7801")
        ),
        h(
          "div",
          { className: "ddt-actions dim-viewActions" },
          h(Button14, { onClick: onRefresh, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
          h(Button14, { kind: "quiet", onClick: onCancel, disabled: busy }, "\u53D6\u6D88")
        )
      )
    )
  );
}
function ProvisionView3({ provision, busy, onRetry, onClose }) {
  if (provision.status === "starting" || provision.status === "connecting") {
    const starting = provision.status === "starting";
    return h(
      "div",
      {
        className: "ddt-card ddt-loading dim-surfaceCard dim-specialView",
        "aria-busy": "true"
      },
      h("div", { className: "ddt-spinner dim-spinner" }),
      h("h3", null, starting ? "\u6B63\u5728\u751F\u6210 WhatsApp \u4E8C\u7EF4\u7801" : "\u5DF2\u626B\u7801\uFF0C\u6B63\u5728\u8FDE\u63A5 WhatsApp"),
      h("p", null, starting ? "\u6B63\u5728\u5EFA\u7ACB\u5B89\u5168\u7684\u5173\u8054\u8BBE\u5907\u4F1A\u8BDD\u3002" : "\u5173\u8054\u8BBE\u5907\u6B63\u5728\u63A5\u5165 DeepSeek Harness\u3002")
    );
  }
  const error = provision.error ?? {
    code: "WHATSAPP_PROVISION_FAILED",
    message: "WhatsApp \u6CA1\u6709\u63A5\u5165\u5B8C\u6210"
  };
  return h(
    "div",
    { className: "ddt-card dim-surfaceCard" },
    h(
      "div",
      { className: "ddt-inlineError dim-inlineError", role: "alert" },
      h("h3", null, "WhatsApp \u6CA1\u6709\u63A5\u5165\u5B8C\u6210"),
      h("p", null, error.message),
      h("span", { className: "ddt-errorCode" }, error.code),
      h(
        "div",
        { className: "ddt-actions dim-viewActions" },
        h(Button14, { kind: "primary", onClick: onRetry, disabled: busy }, "\u91CD\u65B0\u751F\u6210\u4E8C\u7EF4\u7801"),
        h(Button14, { onClick: onClose, disabled: busy }, "\u5173\u95ED")
      )
    )
  );
}
function RemoveConfirmation5({ account, busy, error, feedbackSequence, onConfirm, onCancel }) {
  return h(
    ConfirmDialog,
    { className: "ddt-confirm dim-confirm", role: "alertdialog", onClose: onCancel, busy: Boolean(busy), error, feedbackSequence },
    h("strong", null, `\u4ECE DeepSeek Harness \u79FB\u9664\u201C${account.bot.name}\u201D\uFF1F`),
    h("p", null, "\u8FD9\u4F1A\u505C\u6B62\u6D88\u606F\u8FDE\u63A5\uFF0C\u5E76\u5220\u9664\u672C\u673A\u4FDD\u5B58\u7684 WhatsApp \u5173\u8054\u8BBE\u5907\u548C\u4F1A\u8BDD\u6620\u5C04\u3002"),
    h(
      "div",
      { className: "ddt-actions dim-viewActions" },
      h(Button14, { onClick: onCancel, disabled: busy }, "\u4FDD\u7559\u673A\u5668\u4EBA"),
      h(
        Button14,
        { kind: "danger", onClick: onConfirm, disabled: busy, loading: busy },
        "\u786E\u8BA4\u79FB\u9664\u63A5\u5165"
      )
    )
  );
}
function WhatsappAccountCard({
  account,
  busy,
  testNotice,
  removing,
  removeError,
  removeFeedbackSequence,
  onReconnect,
  onWorkspaceSave,
  onAgentPresetSave,
  onAccessPolicySave,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove
}) {
  const state = busy === "reconnect" ? "connecting" : account.state;
  const tone = account.connected ? "success" : state === "error" ? "error" : "warning";
  const stateLabel2 = account.connected ? "\u8FD0\u884C\u6B63\u5E38" : state === "connecting" ? "\u6B63\u5728\u8FDE\u63A5" : "\u8FDE\u63A5\u672A\u5C31\u7EEA";
  const summary = account.error?.message ?? (account.connected ? null : account.health.summary);
  return h(
    "article",
    { className: "ddt-card dim-botCard", "data-bot-id": account.botId },
    h(
      "div",
      { className: "ddt-cardBody dim-botCardBody" },
      h(
        "div",
        { className: "ddt-accountTop dim-botCardTop" },
        h(
          "div",
          { className: "ddt-accountIdentity dim-botIdentity" },
          h("div", {
            className: "ddt-avatar dim-botAvatar dwa-avatar",
            "aria-hidden": "true"
          }, h(WhatsappLogoGlyph, { size: 29 })),
          h(
            "div",
            { className: "dim-botName" },
            h("h3", null, account.bot.name),
            h("p", null, account.bot.idMasked)
          )
        ),
        h(BotStatusMeta, {
          className: "ddt-health",
          dotClassName: "ddt-dot",
          tone,
          stateLabel: stateLabel2,
          lastCheckedAt: account.health.lastCheckedAt,
          formatCheckedTime: checkedTime6
        })
      ),
      h(WorkspaceEditor, {
        workspace: account.workspace,
        disabled: Boolean(busy),
        onSave: onWorkspaceSave
      }),
      h(AgentPresetEditor, {
        agentPreset: account.agentPreset,
        disabled: Boolean(busy),
        onSave: onAgentPresetSave
      }),
      h(WhatsappAccessSettings, {
        account,
        busy: Boolean(busy),
        onSave: onAccessPolicySave
      }),
      h(
        "div",
        { className: "ddt-accountFooter dim-cardFooter" },
        h(
          "div",
          { className: "dim-cardFooterLayout" },
          h(
            "div",
            { className: "ddt-actions dim-cardActions" },
            h(Button14, {
              className: "dim-cardAction",
              onClick: onReconnect,
              disabled: Boolean(busy),
              loading: busy === "reconnect"
            }, account.connected ? "\u68C0\u67E5\u8FDE\u63A5" : "\u91CD\u8BD5\u8FDE\u63A5"),
            h(Button14, {
              className: "dim-cardAction",
              kind: "danger",
              onClick: onRequestRemove,
              disabled: Boolean(busy)
            }, "\u79FB\u9664\u63A5\u5165")
          ),
          summary ? h("div", { className: "ddt-summary dim-cardSummary" }, summary) : null,
          account.lastMessageError ? h(LastMessageErrorSummary, {
            className: "ddt-summary",
            error: account.lastMessageError
          }) : null,
          testNotice ? h(FeedbackToast, { text: testNotice }) : null
        )
      )
    ),
    removing ? h(RemoveConfirmation5, {
      account,
      busy: busy === "delete",
      error: removeError,
      feedbackSequence: removeFeedbackSequence,
      onConfirm: onConfirmRemove,
      onCancel: onCancelRemove
    }) : null
  );
}
function WhatsappSettingsTab({ rpcCall }) {
  const [model, setModel] = React20.useState({
    phase: "loading",
    bots: [],
    totals: { configured: 0, connected: 0 },
    error: null,
    agentPresetCatalog: EMPTY_AGENT_PRESET_CATALOG
  });
  const [provision, setProvision] = React20.useState(null);
  const [busy, setBusy] = React20.useState(false);
  const [busyByBot, setBusyByBot] = React20.useState({});
  const [testNoticeByBot, setTestNoticeByBot] = React20.useState({});
  const [removeTarget, setRemoveTarget] = React20.useState(null);
  const [actionError, setActionError] = React20.useState(null);
  const [removeErrorsByBot, setRemoveErrorsByBot] = React20.useState({});
  const [now, setNow] = React20.useState(Date.now());
  const mounted = React20.useRef(true);
  const workspaceFence = useWorkspaceSnapshotFence();
  const addButtonRef = React20.useRef(null);
  React20.useEffect(() => {
    const disposeDingtalk = installDingtalkStyles();
    const disposeWhatsapp = installWhatsappStyles();
    mounted.current = true;
    return () => {
      mounted.current = false;
      disposeWhatsapp();
      disposeDingtalk();
    };
  }, []);
  const invoke = React20.useCallback(async (endpoint, payload = {}, signal) => {
    if (typeof rpcCall !== "function") throw new TypeError("WhatsApp \u8BBE\u7F6E\u9875\u7F3A\u5C11 RPC \u8FDE\u63A5");
    return unwrapRpcResult9(await rpcCall(endpoint, payload, signal));
  }, [rpcCall]);
  const loadStatus = React20.useCallback(async ({ signal, silent = false, restore = false } = {}) => {
    const workspaceVersion = workspaceFence.beginStatus();
    if (workspaceVersion === null) return void 0;
    if (!silent && mounted.current) setModel((current) => ({ ...current, phase: "loading", error: null }));
    try {
      const snapshot = normalizeSnapshot8(await invoke(WHATSAPP_ENDPOINTS.status, {}, signal));
      if (!mounted.current || signal?.aborted || !workspaceFence.canCommitStatus(workspaceVersion)) return void 0;
      setModel({
        phase: "ready",
        bots: snapshot.bots,
        totals: snapshot.totals,
        error: null,
        agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
      });
      if (restore && snapshot.provisioning) setProvision({
        ...snapshot.provisioning,
        durationMs: Math.max(1, snapshot.provisioning.expiresAt - Date.now())
      });
      return snapshot;
    } catch (error) {
      if (error?.name !== "AbortError" && mounted.current && !signal?.aborted && workspaceFence.canCommitStatus(workspaceVersion)) {
        setModel((current) => ({
          ...current,
          phase: silent ? current.phase : "error",
          error: presentError9(error)
        }));
      }
      return void 0;
    }
  }, [invoke, workspaceFence]);
  React20.useEffect(() => {
    const controller = new AbortController();
    void loadStatus({ signal: controller.signal, restore: true });
    return () => controller.abort();
  }, [loadStatus]);
  React20.useEffect(() => {
    if (model.phase !== "ready") return void 0;
    const controller = new AbortController();
    const timer = window.setInterval(
      () => void loadStatus({ signal: controller.signal, silent: true }),
      15e3
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadStatus, model.phase]);
  React20.useEffect(() => {
    if (!provision || !ACTIVE_STATES3.has(provision.status)) return void 0;
    const timer = window.setInterval(() => mounted.current && setNow(Date.now()), 1e3);
    return () => window.clearInterval(timer);
  }, [provision?.attemptId, provision?.status]);
  const startProvisioning = React20.useCallback(async (replace = false) => {
    setBusy(true);
    try {
      if (replace && provision?.attemptId) {
        await invoke(WHATSAPP_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      if (!mounted.current) return;
      setProvision({ status: "starting" });
      const started = normalizeProvisioning6(await invoke(WHATSAPP_ENDPOINTS.beginProvisioning, {}));
      if (!mounted.current) return;
      setNow(Date.now());
      setProvision({ ...started, durationMs: Math.max(1, started.expiresAt - Date.now()) });
    } catch (error) {
      if (mounted.current) setProvision({ status: "failed", error: presentError9(error) });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId]);
  const closeProvision = React20.useCallback(async () => {
    setBusy(true);
    try {
      if (provision?.attemptId && ACTIVE_STATES3.has(provision.status)) {
        await invoke(WHATSAPP_ENDPOINTS.cancelProvisioning, { attemptId: provision.attemptId });
      }
      if (mounted.current) {
        setProvision(null);
        setActionError(null);
      }
    } catch (cause) {
      if (mounted.current) setActionError((current) => ({
        message: cause?.message ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
        sequence: (current?.sequence ?? 0) + 1
      }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [invoke, provision?.attemptId, provision?.status]);
  React20.useEffect(() => {
    const attemptId = provision?.attemptId;
    if (!attemptId || !ACTIVE_STATES3.has(provision.status)) return void 0;
    const controller = new AbortController();
    let disposed = false;
    let timer;
    const schedule = (delay) => {
      if (disposed || controller.signal.aborted) return;
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      try {
        const current = normalizeProvisioning6(await invoke(
          WHATSAPP_ENDPOINTS.pollProvisioning,
          { attemptId },
          controller.signal
        ));
        if (disposed || controller.signal.aborted || !mounted.current) return;
        if (current.status === "connected") {
          setProvision(null);
          await loadStatus({ signal: controller.signal, silent: true });
          return;
        }
        setProvision((previous) => ({
          ...current,
          durationMs: previous?.durationMs ?? Math.max(1, current.expiresAt - Date.now())
        }));
        if (ACTIVE_STATES3.has(current.status)) schedule(current.pollIntervalMs);
      } catch (error) {
        if (!disposed && !controller.signal.aborted && mounted.current) {
          setProvision({ status: "failed", error: presentError9(error) });
        }
      }
    };
    schedule(provision.pollIntervalMs ?? 1e3);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [invoke, loadStatus, provision?.attemptId, provision?.status]);
  const botAction = React20.useCallback(async (account, operation, endpoint, payload) => {
    const snapshotVersion = workspaceFence.beginMutation();
    setBusyByBot((current) => ({ ...current, [account.botId]: operation }));
    if (operation === "reconnect") {
      setTestNoticeByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
    try {
      const value = await invoke(endpoint, payload);
      const snapshot = normalizeSnapshot8(value);
      if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setModel({
          phase: "ready",
          bots: snapshot.bots,
          totals: snapshot.totals,
          error: null,
          agentPresetCatalog: snapshot.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
        });
        if (operation === "reconnect") {
          setTestNoticeByBot((current) => ({
            ...current,
            [account.botId]: connectionTestNotice3(value)
          }));
        }
      }
    } catch (error) {
      if (operation !== "reconnect") throw error;
      if (mounted.current && workspaceFence.canCommitMutation(snapshotVersion)) {
        setTestNoticeByBot((current) => ({
          ...current,
          [account.botId]: "\u8FDE\u63A5\u68C0\u67E5\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002"
        }));
      }
    } finally {
      const shouldRefresh = workspaceFence.endMutation();
      if (shouldRefresh && mounted.current) void loadStatus({ silent: true });
      if (mounted.current) setBusyByBot((current) => {
        const next = { ...current };
        delete next[account.botId];
        return next;
      });
    }
  }, [invoke, loadStatus, workspaceFence]);
  const botList = model.bots.length > 0 ? h(
    "section",
    { className: "dim-listSection" },
    h(ChannelListHeading, {
      className: "ddt-listHeading",
      title: "\u5DF2\u63A5\u5165\u7684 WhatsApp \u673A\u5668\u4EBA",
      connectionLabel: "WhatsApp Web"
    }),
    h("ul", { className: "ddt-list dim-botList" }, model.bots.map((account) => h("li", { key: account.botId }, h(WhatsappAccountCard, {
      account,
      busy: busyByBot[account.botId],
      testNotice: testNoticeByBot[account.botId],
      removing: removeTarget === account.botId,
      removeError: removeErrorsByBot[account.botId]?.message,
      removeFeedbackSequence: removeErrorsByBot[account.botId]?.sequence,
      onReconnect: () => void botAction(
        account,
        "reconnect",
        WHATSAPP_ENDPOINTS.reconnectBot,
        { botId: account.botId, sendTest: true }
      ),
      onWorkspaceSave: (workspace) => botAction(
        account,
        "workspace",
        WHATSAPP_ENDPOINTS.setWorkspace,
        { botId: account.botId, workspace }
      ),
      onAgentPresetSave: (agentPreset) => botAction(
        account,
        "preset",
        WHATSAPP_ENDPOINTS.setAgentPreset,
        { botId: account.botId, agentPreset }
      ),
      onAccessPolicySave: (accessPolicy) => botAction(
        account,
        "access",
        WHATSAPP_ENDPOINTS.setAccessPolicy,
        { botId: account.botId, ...accessPolicy }
      ),
      onRequestRemove: () => setRemoveTarget(account.botId),
      onCancelRemove: () => setRemoveTarget(null),
      onConfirmRemove: async () => {
        try {
          await botAction(account, "delete", WHATSAPP_ENDPOINTS.deleteBot, {
            botId: account.botId,
            confirm: true
          });
          if (mounted.current) {
            setRemoveTarget(null);
            setRemoveErrorsByBot((current) => {
              const next = { ...current };
              delete next[account.botId];
              return next;
            });
          }
        } catch (cause) {
          if (mounted.current) setRemoveErrorsByBot((current) => ({
            ...current,
            [account.botId]: {
              message: cause?.message ?? "\u79FB\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
              sequence: (current[account.botId]?.sequence ?? 0) + 1
            }
          }));
        }
      }
    }))))
  ) : null;
  return h(AgentPresetCatalogContext.Provider, {
    value: model.agentPresetCatalog ?? EMPTY_AGENT_PRESET_CATALOG
  }, h(
    "section",
    {
      className: "ddt-page dwa-page dim-channelPage",
      "aria-label": "WhatsApp \u8BBE\u7F6E"
    },
    actionError ? h(FeedbackToast, { text: actionError.message, tone: "error", sequence: actionError.sequence }) : null,
    Object.entries(removeErrorsByBot).map(([botId, failure]) => botId !== removeTarget ? h(FeedbackToast, { key: botId, text: failure.message, tone: "error", sequence: failure.sequence }) : null),
    h(Heading6, {
      totals: model.totals,
      busy,
      onAdd: () => void startProvisioning(false),
      addButtonRef
    }),
    model.phase === "loading" ? h(LoadingView6) : model.phase === "error" ? h(
      "div",
      { className: "ddt-card dim-surfaceCard" },
      h(
        "div",
        { className: "ddt-inlineError dim-inlineError" },
        h("h3", null, "\u65E0\u6CD5\u8BFB\u53D6 WhatsApp \u673A\u5668\u4EBA\u72B6\u6001"),
        h("p", null, model.error?.message),
        h(Button14, { onClick: () => void loadStatus() }, "\u91CD\u65B0\u8BFB\u53D6")
      )
    ) : h(
      React20.Fragment,
      null,
      provision?.status === "pending" ? h(QrPanel5, {
        provision,
        now,
        busy,
        onRefresh: () => void startProvisioning(true),
        onCancel: () => void closeProvision()
      }) : provision ? h(ProvisionView3, {
        provision,
        busy,
        onRetry: () => void startProvisioning(true),
        onClose: () => void closeProvision()
      }) : model.bots.length === 0 ? h(EmptyView6, { busy, onStart: () => void startProvisioning(false) }) : null,
      botList
    )
  ));
}

// plugin-src/client/loopback-recovery.js
var TRANSPORT_FORBIDDEN = /^transport failure for \/[A-Za-z0-9._~-]+\/[A-Za-z0-9_$./~-]+: HTTP 403$/;
var LOOPBACK_RECOVERY_ERROR_CODE = "loopback-recovery-required";
var LOOPBACK_RECOVERY_ERROR_MESSAGE = "\u5F53\u524D\u5730\u5740\u4E0E\u6D4F\u89C8\u5668\u7684\u672C\u673A\u8BF7\u6C42\u6821\u9A8C\u4E0D\u517C\u5BB9\u3002\u8BF7\u4F7F\u7528\u4E0A\u65B9\u6309\u94AE\u6539\u7528 localhost \u91CD\u65B0\u6253\u5F00\u3002";
function isIpv4Loopback(hostname) {
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function createLoopbackRecovery(error, location) {
  if (!TRANSPORT_FORBIDDEN.test(error?.message ?? "")) return null;
  if (typeof location?.href !== "string") return null;
  try {
    const current = new URL(location.href);
    if (current.protocol !== "http:" || !isIpv4Loopback(current.hostname)) return null;
    current.hostname = "localhost";
    return Object.freeze({
      url: current.href,
      origin: current.origin
    });
  } catch {
    return null;
  }
}
function createLoopbackAwareRpcCall(rpcCall, {
  location,
  onRecovery
} = {}) {
  if (typeof rpcCall !== "function") throw new TypeError("rpcCall must be a function");
  return async (...args) => {
    try {
      return await rpcCall(...args);
    } catch (error) {
      const recovery = createLoopbackRecovery(error, location);
      if (!recovery) throw error;
      onRecovery?.(recovery);
      const presented = new Error(LOOPBACK_RECOVERY_ERROR_MESSAGE);
      presented.code = LOOPBACK_RECOVERY_ERROR_CODE;
      presented.cause = error;
      presented.recoveryUrl = recovery.url;
      throw presented;
    }
  };
}
function createLoopbackAwareRpcCalls(rpcCalls, options) {
  return Object.freeze(Object.fromEntries(
    Object.entries(rpcCalls).map(([name2, rpcCall]) => [
      name2,
      typeof rpcCall === "function" ? createLoopbackAwareRpcCall(rpcCall, options) : rpcCall
    ])
  ));
}
function replacePageLocation(url, location = globalThis.location) {
  location?.replace?.(url);
}

// plugin-src/client/styles.js
var IM_STYLE_ID = "xmanrui-dsh-im-settings";
var CSS11 = String.raw`
.dim-page {
  --dim-blue: var(--dsw-alias-state-business-primary);
  --dim-blue-soft: color-mix(in srgb, var(--dim-blue) 9%, transparent);
  width: 100%;
  max-width: 1080px;
  padding: 2px 0 30px;
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
  font-family: var(--dsw-font-family);
}
.dim-page *, .dim-page *::before, .dim-page *::after { box-sizing: border-box; }
.dim-layout { display: grid; grid-template-columns: 174px 1px minmax(0, 1fr); gap: 24px; align-items: start; }
.dim-rail { max-height: 520px; display: grid; align-content: start; gap: 8px; overflow-y: auto; padding: 1px 4px 1px 1px; }
.dim-channel {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  box-shadow: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, color .16s ease;
}
.dim-channel:hover {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-channel[aria-selected="true"] {
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-active));
}
.dim-channel:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-logo { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; box-shadow: none; }
.dim-logo svg { display: block; width: 20px; height: 20px; }
.dim-logoWeixin { color: white; background: #07c160; }
.dim-logoWeixin svg { width: 19px; height: 19px; }
.dim-logoFeishu { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.dim-logoFeishu svg { width: 28px; height: 28px; }
.dim-logoDingtalk { color: white; background: #1677ff; }
.dim-logoDingtalk svg { width: 24px; height: 24px; }
.dim-logoQq { color: white; background: #1677ff; }
.dim-logoQq svg { width: 21px; height: 21px; }
.dim-logoWecom { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); }
.dim-logoWecom svg { width: 22px; height: 22px; }
.dim-logoTelegram { color: white; background: #229ed9; }
.dim-logoTelegram svg { width: 21px; height: 21px; }
.dim-logoOffice { color: white; background: var(--dsw-alias-state-business-primary); }
.dim-logoOffice svg { width: 23px; height: 23px; }
.dim-logoDiscord { color: white; background: #5865f2; }
.dim-logoDiscord svg { width: 21px; height: 21px; }
.dim-logoSlack { color: white; background: #4a154b; }
.dim-logoSlack svg { width: 21px; height: 21px; }
.dim-logoWhatsapp { color: white; background: #25d366; }
.dim-logoWhatsapp svg { width: 21px; height: 21px; }
.dim-channelCopy { min-width: 0; display: grid; }
.dim-channelCopy strong { overflow: hidden; color: inherit; font-size: 14px; line-height: 20px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.dim-channelNote { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.dim-divider { width: 1px; min-height: 520px; background: var(--dsw-alias-border-l1); }
.dim-panel { min-width: 0; container-type: inline-size; }
.dim-loopbackRecovery {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 14px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, var(--dsw-alias-border-l2));
  border-radius: 12px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.dim-loopbackRecoveryCopy { min-width: 0; }
.dim-loopbackRecoveryCopy strong { display: block; font-size: 14px; line-height: 20px; font-weight: 600; }
.dim-loopbackRecoveryCopy p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-loopbackRecoveryCopy code { display: block; overflow: hidden; margin-top: 5px; color: var(--dsw-alias-label-secondary); font: 11px/16px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); text-overflow: ellipsis; white-space: nowrap; }
.dim-loopbackRecoveryAction {
  flex: none;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-loopbackRecoveryAction:hover { background: var(--dsw-alias-button-primary-hover); }
.dim-loopbackRecoveryAction:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dim-panel .bxf-page, .dim-panel .dxw-page, .dim-panel .ddt-page, .dim-panel .dqq-page, .dim-panel .dwecom-page, .dim-panel .dsl-page, .dim-panel .dwa-page { width: 100%; max-width: none; padding: 0 0 24px; }
.dim-panel .bxf-heading, .dim-panel .dxw-heading, .dim-panel .ddt-heading { justify-content: flex-end; }
.dim-panel .bxf-headingTools, .dim-panel .dxw-tools, .dim-panel .ddt-tools { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) max-content; align-items: center; justify-content: stretch; gap: 8px; }
.dim-panel .dim-bindActions { min-width: 0; display: flex; align-items: center; flex-wrap: nowrap; gap: 8px; }
.dim-panel .dim-bindActions > button { min-width: 0; }
/*
 * Header actions (扫码接入 / 手动接入) share one sizing contract across every channel.
 * Each channel renders these through its own base button class (.bxf-button / .dxw-button /
 * .ddt-button) which carries its own height, min-height, gap and font-size; the selectors below
 * are deliberately more specific than any of those (including .bxf-button[data-size="small"])
 * and set every box-affecting property so the base class cannot leak through.
 */
.dim-panel .bxf-headingTools .dim-scanButton,
.dim-panel .dxw-tools .dim-scanButton,
.dim-panel .ddt-tools .dim-scanButton,
.dim-panel .bxf-headingTools .dim-credentialButton,
.dim-panel .dxw-tools .dim-credentialButton,
.dim-panel .ddt-tools .dim-credentialButton {
  flex: none;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  gap: 6px;
  margin: 0;
  padding: 0 14px;
  border-radius: 18px;
  box-shadow: none;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transform: none;
}
.dim-panel .bxf-headingTools .dim-scanButton,
.dim-panel .dxw-tools .dim-scanButton,
.dim-panel .ddt-tools .dim-scanButton {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-panel .bxf-headingTools .dim-scanButton:hover:not(:disabled),
.dim-panel .dxw-tools .dim-scanButton:hover:not(:disabled),
.dim-panel .ddt-tools .dim-scanButton:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-panel .bxf-headingTools .dim-credentialButton,
.dim-panel .dxw-tools .dim-credentialButton,
.dim-panel .ddt-tools .dim-credentialButton {
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  background: transparent;
}
.dim-panel .bxf-headingTools .dim-credentialButton:hover:not(:disabled),
.dim-panel .dxw-tools .dim-credentialButton:hover:not(:disabled),
.dim-panel .ddt-tools .dim-credentialButton:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .bxf-headingTools .dim-credentialButton[aria-pressed="true"],
.dim-panel .dxw-tools .dim-credentialButton[aria-pressed="true"],
.dim-panel .ddt-tools .dim-credentialButton[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-active);
}
.dim-panel .bxf-headingTools .dim-scanButton:disabled,
.dim-panel .dxw-tools .dim-scanButton:disabled,
.dim-panel .ddt-tools .dim-scanButton:disabled,
.dim-panel .bxf-headingTools .dim-credentialButton:disabled,
.dim-panel .dxw-tools .dim-credentialButton:disabled,
.dim-panel .ddt-tools .dim-credentialButton:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.dim-panel .dim-actionIcon { width: 16px; height: 16px; flex: 0 0 16px; }
.dim-panel .bxf-headingTools .dim-onlineBadge,
.dim-panel .dxw-tools .dim-onlineBadge,
.dim-panel .ddt-tools .dim-onlineBadge {
  height: 28px;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-self: end;
  gap: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 14px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  white-space: nowrap;
}
.dim-panel .dim-channelPage { min-width: 0; width: 100%; max-width: none; display: flex; flex-direction: column; gap: 12px; padding: 0 0 24px; color: var(--dsw-alias-label-primary); box-sizing: border-box; }
.dim-panel .dim-surfaceCard {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: none;
}
.dim-panel .dim-surfaceCard::before { display: none; }
.dim-panel .dim-surfaceBody { padding: 20px; }
.dim-panel .dim-credentialPanel { display: grid; gap: 16px; padding: 20px; }
.dim-panel .dim-credentialTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-credentialForm { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; }
.dim-panel .dim-credentialFormSingle { grid-template-columns: minmax(0, 1fr); }
.dim-panel .dim-credentialField { min-width: 0; display: grid; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dim-panel .dim-credentialField input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  outline: none;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-module-platform);
  font: 13px/20px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  transition: border-color .16s ease;
}
.dim-panel .dim-credentialField input:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dim-panel .dim-credentialField input::placeholder { color: var(--dsw-alias-label-tertiary); font-family: inherit; }
.dim-panel .dim-credentialError, .dim-panel .dim-credentialActions { grid-column: 1 / -1; }
.dim-panel .dim-credentialError { margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-credentialActions { margin-top: 0; }
.dim-panel .dim-listSection { min-width: 0; width: 100%; max-width: 100%; display: flex; flex-direction: column; gap: 0; }
.dim-panel .dim-listHeading { min-height: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 6px; padding: 0; }
.dim-panel .dim-listHeading h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 600; }
.dim-panel .dim-listTitle { min-width: 0; display: inline-flex; align-items: center; gap: 6px; }
.dim-panel .dim-channelHelp { position: relative; display: inline-flex; flex: none; }
.dim-panel .dim-channelHelpButton {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  cursor: help;
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.dim-panel .dim-channelHelpButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-channelHelpButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-panel .dim-channelTooltip {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 30;
  width: max-content;
  max-width: min(280px, calc(100vw - 48px));
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-alias-shadow-lv2, 0 4px 16px rgb(0 0 0 / 8%));
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease, visibility .15s ease;
}
.dim-panel .dim-channelTooltip strong { color: var(--dsw-alias-label-primary); font-weight: 600; white-space: nowrap; }
.dim-panel .dim-channelHelp:hover .dim-channelTooltip, .dim-panel .dim-channelHelp:focus-within .dim-channelTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dim-panel .dim-botList { min-width: 0; width: 100%; max-width: 100%; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin: 0; padding: 0; list-style: none; }
.dim-panel .dim-botList > li { min-width: 0; max-width: 100%; }
.dim-panel .dim-loadingView { padding: 32px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dim-panel .dim-loadingView h3 { margin: 0 0 8px; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-loadingView p { margin: 0; font-size: 14px; line-height: 22px; }
.dim-panel .dim-spinner {
  width: 24px;
  height: 24px;
  margin: 0 auto 12px;
  border: 3px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: dim-spin .8s linear infinite;
}
@keyframes dim-spin { to { transform: rotate(360deg); } }
.dim-panel .dim-emptyView { min-height: 200px; display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 16px; }
.dim-panel .dim-emptyCopy { min-width: 0; }
.dim-panel .dim-emptyCopy h3 { margin: 8px 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-emptyCopy > p { max-width: 560px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-emptyBrand { display: none; }
.dim-panel .dim-stateLabel { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.dim-panel .dim-stateDot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); box-shadow: none; }
.dim-panel .dim-stateDot[data-tone="success"] { background: var(--dsw-alias-state-success-primary); }
.dim-panel .dim-stateDot[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dim-panel .dim-stateDot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-viewActions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.dim-panel .dim-viewActions .bxf-button,
.dim-panel .dim-viewActions .dxw-button,
.dim-panel .dim-viewActions .ddt-button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  box-shadow: none;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-viewActions .bxf-button:hover:not(:disabled),
.dim-panel .dim-viewActions .dxw-button:hover:not(:disabled),
.dim-panel .dim-viewActions .ddt-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="primary"],
.dim-panel .dim-viewActions .dxw-button[data-kind="primary"],
.dim-panel .dim-viewActions .ddt-button[data-kind="primary"] {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="primary"]:hover:not(:disabled),
.dim-panel .dim-viewActions .dxw-button[data-kind="primary"]:hover:not(:disabled),
.dim-panel .dim-viewActions .ddt-button[data-kind="primary"]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-panel .dim-viewActions .bxf-button[data-kind="danger"],
.dim-panel .dim-viewActions .dxw-button[data-kind="danger"],
.dim-panel .dim-viewActions .ddt-button[data-kind="danger"] {
  color: var(--dsw-alias-state-error-primary);
}
.dim-panel .dim-qrLayout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: start; }
.dim-panel .dim-qrColumn { width: 100%; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.dim-panel .dim-qrFrame {
  position: relative;
  width: min(270px, 100%);
  height: auto;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dim-panel .dim-qrFrame::before { display: none; }
.dim-panel .dim-qrFrame::after { display: none; }
.dim-panel .dim-qrFrame img { position: relative; z-index: 1; width: 100%; height: 100%; display: block; object-fit: contain; }
.dim-panel .dim-qrFallback { position: relative; z-index: 1; display: grid; place-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; text-align: center; }
.dim-panel .dim-qrExpired {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 20px;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  text-align: center;
  white-space: pre-line;
  backdrop-filter: blur(2px);
}
.dim-panel .dim-countdown { width: min(270px, 100%); margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-countdownTop { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.dim-panel .dim-countdownTop strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dim-panel .dim-progress { height: 4px; overflow: hidden; margin: 0; border-radius: 99px; background: var(--dsw-alias-bg-module-platform); }
.dim-panel .dim-progress span {
  display: block;
  width: var(--bxf-progress, var(--dxw-progress, var(--ddt-progress, 0%)));
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary);
  transition: width .25s linear;
}
.dim-panel .dim-qrCopy { min-width: 0; overflow-wrap: anywhere; }
.dim-panel .dim-qrCopy h3 { margin: 8px 0; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-qrCopy > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-steps { margin: 16px 0; padding: 0; list-style: none; counter-reset: dim-step; }
.dim-panel .dim-steps li {
  position: relative;
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 4px 0 4px 36px;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
  counter-increment: dim-step;
}
.dim-panel .dim-steps li::before {
  content: counter(dim-step);
  position: absolute;
  left: 0;
  top: 4px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 12px;
  font-weight: 600;
}
.dim-panel .dim-specialView { padding: 32px; text-align: center; }
.dim-panel .dim-statusNotice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l2));
  border-radius: 12px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
  font-size: 13px;
  line-height: 20px;
}
.dim-panel .dim-inlineError {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
}
.dim-panel .dim-inlineError > div { min-width: 0; }
.dim-panel .dim-inlineError h3 { margin: 0; color: inherit; font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-panel .dim-inlineError p { margin: 8px 0 0; color: inherit; font-size: 14px; line-height: 22px; }
.dim-panel .dim-confirm { padding: 16px 20px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-interactive-bg-hover); }
.dim-panel .dim-confirm strong, .dim-panel .dim-confirm h4 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-weight: 600; }
.dim-panel .dim-confirm p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dim-panel .dim-cardFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dim-panel .dim-workspace {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
}
.dim-panel .dim-workspaceHeader { display: contents; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dim-panel .dim-workspaceHeader > span { grid-column: 1; grid-row: 1; white-space: nowrap; }
.dim-panel .dim-workspaceEdit {
  grid-column: 2;
  grid-row: 1;
  padding: 0;
  border: 0;
  color: var(--dsw-alias-state-business-primary);
  background: transparent;
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-workspaceEdit:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-workspacePath {
  min-width: 0;
  max-width: 100%;
  grid-column: 1 / -1;
  grid-row: 2;
  display: block;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font: 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow-wrap: anywhere;
  white-space: normal;
}
.dim-panel .dim-preset {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
}
.dim-panel .dim-presetHeader {
  position: relative;
  min-width: 0;
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dim-panel .dim-presetTitle { min-width: 0; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.dim-panel .dim-presetHelp { display: inline-flex; align-items: center; flex: none; }
.dim-panel .dim-presetHelpButton {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  cursor: help;
}
.dim-panel .dim-presetHelpButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-panel .dim-presetHelpButton:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dim-panel .dim-presetTooltip {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 30;
  width: min(320px, 100%);
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-alias-shadow-lv2, 0 4px 16px rgb(0 0 0 / 8%));
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  overflow-wrap: anywhere;
  white-space: normal;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease, visibility .15s ease;
}
.dim-panel .dim-presetHelp:hover .dim-presetTooltip, .dim-panel .dim-presetHelp:focus-within .dim-presetTooltip { opacity: 1; visibility: visible; transform: translateY(0); }
.dim-panel .dim-presetStatus { grid-column: 2; grid-row: 1; color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.dim-panel .dim-presetSelect {
  min-width: 0;
  max-width: 100%;
  grid-column: 1 / -1;
  grid-row: 2;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  font-size: 12px;
}
.dim-panel .dim-presetSelect:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-presetError { grid-column: 1 / -1; grid-row: 3; margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dim-directoryPickerBackdrop {
  --dim-blue: var(--dsw-alias-state-business-primary);
  --dim-blue-soft: color-mix(in srgb, var(--dim-blue) 9%, transparent);
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: blur(2px);
}
.dim-directoryPickerBackdrop, .dim-directoryPickerBackdrop *, .dim-directoryPickerBackdrop *::before, .dim-directoryPickerBackdrop *::after { box-sizing: border-box; }
.dim-directoryPicker {
  width: min(720px, 100%);
  height: min(620px, calc(100vh - 48px));
  min-height: 420px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 24px;
  outline: none;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-alias-shadow-lv3, 0 12px 40px rgb(0 0 0 / 12%));
}
.dim-directoryPickerHeader { min-width: 0; padding: 20px 24px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dim-directoryPickerHeader h3 { margin: 0 0 12px; color: var(--dsw-alias-label-primary); font-size: 16px; line-height: 24px; font-weight: 600; }
.dim-directoryPickerHeader > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dim-directoryCrumbs { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--dsw-alias-label-tertiary); }
.dim-directoryCrumbs button {
  max-width: 210px;
  overflow: hidden;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryCrumbs button:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dim-directoryCrumbs button[aria-current="page"] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dim-directoryCrumbs button:focus-visible,
.dim-directoryList button:focus-visible,
.dim-directoryPickerActions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dim-directoryCrumbSeparator { flex: none; font-size: 12px; }
.dim-directoryPickerBody { min-height: 0; overflow-y: auto; padding: 14px 16px; }
.dim-directoryList { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.dim-directoryList button {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dim-directoryList button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dim-directoryList button:disabled, .dim-directoryCrumbs button:disabled { cursor: wait; opacity: .4; }
.dim-directoryFolder { width: 24px; height: 24px; display: grid; place-items: center; color: var(--dsw-alias-label-secondary); }
.dim-directoryFolder svg { width: 22px; height: 22px; }
.dim-directoryName { min-width: 0; overflow: hidden; font-size: 14px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.dim-directoryChevron { width: 18px; height: 18px; display: grid; place-items: center; color: var(--dsw-alias-label-tertiary); }
.dim-directoryChevron svg { width: 17px; height: 17px; }
.dim-directoryPickerState { min-height: 210px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dim-directoryPickerState p { margin: 0; font-size: 13px; line-height: 20px; }
.dim-directoryPickerSpinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: dim-spin .8s linear infinite;
}
.dim-directoryPickerError {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, var(--dsw-alias-border-l2));
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-layer-1));
  font-size: 12px;
  line-height: 18px;
}
.dim-directoryPickerError button {
  flex: none;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.dim-directoryPickerTruncated { margin: 10px 4px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dim-directoryPickerFooter {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dim-directoryHidden {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  border: 0;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryHidden:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.dim-directoryHidden:disabled { cursor: not-allowed; opacity: .4; }
.dim-directoryHiddenBox {
  position: relative;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
}
.dim-directoryHidden[aria-pressed="true"] .dim-directoryHiddenBox {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-directoryHidden[aria-pressed="true"] .dim-directoryHiddenBox::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid var(--dsw-alias-label-primary-foreground);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.dim-directoryPickerNotice { min-width: 0; margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; text-align: right; }
.dim-directoryPickerActions { display: flex; gap: 8px; }
.dim-directoryPickerActions button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 18px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-directoryPickerActions .dim-directoryPickerPrimary {
  border: none;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-button-primary-fill);
}
.dim-directoryPickerActions .dim-directoryPickerPrimary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
}
.dim-directoryPickerActions button:hover:not(:disabled):not(.dim-directoryPickerPrimary) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dim-directoryPickerActions button:disabled { cursor: not-allowed; opacity: .4; }
.dim-panel .dim-cardSummary { min-width: 0; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; font-weight: 400; line-height: 18px; overflow-wrap: anywhere; white-space: normal; }
.dim-panel .dim-cardFooterLayout { min-width: 0; width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.dim-panel .dim-cardFooterLayout > .dim-cardActions { align-self: stretch; }
.dim-panel .dim-cardFeedback {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-module-platform);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: normal;
}
.dim-panel .dim-cardActions { flex: none; width: 100%; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin: 0; }
.dim-panel .dim-cardActions .dim-cardAction {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.dim-panel .dim-cardActions .dim-cardAction:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dim-panel .dim-cardActions .dim-cardAction[data-kind="danger"] { color: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-botCard {
  position: relative;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: none;
}
.dim-panel .dim-botCard::before { display: none; }
.dim-panel .dim-botCardBody { position: relative; min-width: 0; width: 100%; max-width: 100%; padding: 12px; }
.dim-panel .dim-botCardTop { min-width: 0; max-width: 100%; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dim-panel .dim-botIdentity { min-width: 0; flex: 1 1 0; display: flex; align-items: center; gap: 10px; }
.dim-panel .dim-botAvatar { flex: none; width: 36px; height: 36px; display: grid; place-items: center; overflow: hidden; border-radius: 8px; box-shadow: none; }
.dim-panel .dim-botAvatar svg { width: 24px; height: 24px; }
.dim-panel .dim-botName { min-width: 0; }
.dim-panel .dim-botName h3 { overflow: hidden; margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.dim-panel .dim-botName p { overflow: hidden; margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font: 12px/18px var(--ds-font-family-code, ui-monospace, SFMono-Regular, monospace); text-overflow: ellipsis; white-space: nowrap; }
.dim-panel .dim-botHealthGroup { min-width: 0; max-width: 100%; flex: none; display: grid; justify-items: end; gap: 4px; }
.dim-panel .dim-botCard .dim-botHealth {
  flex: none;
  min-height: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  white-space: nowrap;
}
.dim-panel .dim-lastChecked { display: inline-flex; align-items: baseline; gap: 4px; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; font-weight: 400; line-height: 16px; white-space: nowrap; }
.dim-panel .dim-botCard .dim-healthDot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); box-shadow: none; }
.dim-panel .dim-botCard .dim-healthDot[data-tone="success"] { background: var(--dsw-alias-state-success-primary); }
.dim-panel .dim-botCard .dim-healthDot[data-tone="warning"] { background: var(--dsw-alias-state-warn-primary); }
.dim-panel .dim-botCard .dim-healthDot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dim-panel .dim-botCard .dim-cardFooter { margin-top: 0; }
.dim-panel .ddt-headingCopy { display: none; }
.dim-panel .ddt-qrFrame, .dim-panel .ddt-countdown { width: min(270px, 100%); }
@container (max-width: 680px) {
  .dim-panel .bxf-headingTools, .dim-panel .dxw-tools, .dim-panel .ddt-tools { gap: 6px; }
  .dim-panel .dim-botCardTop { flex-direction: column; align-items: stretch; }
  .dim-panel .dim-botHealthGroup { justify-items: start; }
  .dim-panel .dim-bindActions { gap: 6px; }
  .dim-panel .bxf-headingTools .dim-scanButton,
  .dim-panel .dxw-tools .dim-scanButton,
  .dim-panel .ddt-tools .dim-scanButton,
  .dim-panel .bxf-headingTools .dim-credentialButton,
  .dim-panel .dxw-tools .dim-credentialButton,
  .dim-panel .ddt-tools .dim-credentialButton {
    height: 28px;
    min-height: 28px;
    max-height: 28px;
    gap: 4px;
    padding: 0 10px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 18px;
  }
  .dim-panel .dim-actionIcon { width: 14px; height: 14px; flex-basis: 14px; }
  .dim-panel .bxf-headingTools .dim-onlineBadge,
  .dim-panel .dxw-tools .dim-onlineBadge,
  .dim-panel .ddt-tools .dim-onlineBadge { padding-inline: 8px; font-size: 11px; }
  .dim-panel .dim-credentialForm { grid-template-columns: minmax(0, 1fr); }
  .dim-panel .dim-credentialError, .dim-panel .dim-credentialActions { grid-column: auto; }
  .dim-panel .dim-emptyView { min-height: 0; }
  .dim-panel .dim-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 24px; }
  .dim-panel .dim-qrColumn { width: 100%; min-width: 0; }
  .dim-panel .dim-qrCopy { width: 100%; min-width: 0; overflow-wrap: anywhere; }
  .dim-panel .ddt-qrLayout { grid-template-columns: minmax(0, 1fr); justify-items: center; gap: 24px; }
  .dim-panel .ddt-qrColumn { width: 100%; min-width: 0; }
  .dim-panel .ddt-qrCopy { width: 100%; min-width: 0; overflow-wrap: anywhere; }
}
@media (max-width: 840px) {
  .dim-layout { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .dim-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dim-divider { display: none; }
  .dim-rail { max-height: none; overflow: visible; padding-right: 1px; }
  .dim-channel { min-height: 48px; }
}
@media (max-width: 720px) {
  .dim-panel .dim-botCardTop { flex-direction: column; align-items: stretch; }
  .dim-panel .dim-botHealthGroup { justify-items: start; }
}
@media (max-width: 560px) {
  .dim-rail { grid-template-columns: minmax(0, 1fr); }
  .dim-loopbackRecovery { align-items: stretch; flex-direction: column; gap: 12px; }
  .dim-loopbackRecoveryAction { width: 100%; }
  .dim-directoryPickerBackdrop { padding: 10px; }
  .dim-directoryPicker { height: calc(100vh - 20px); min-height: 0; border-radius: 16px; }
  .dim-directoryPickerHeader { padding: 16px; }
  .dim-directoryPickerHeader h3 { font-size: 16px; }
  .dim-directoryPickerBody { padding: 10px; }
  .dim-directoryPickerFooter { grid-template-columns: minmax(0, 1fr) max-content; gap: 10px; padding: 12px 14px; }
  .dim-directoryPickerNotice { grid-column: 1 / -1; grid-row: 1; text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .dim-page * { transition-duration: .01ms !important; }
  .dim-directoryPickerSpinner { animation-duration: 1.8s; }
}
.dim-busyButton { position: relative; }
.dim-buttonContent { display: contents; }
.dim-busyButton[data-loading="true"] .dim-buttonContent { visibility: hidden; }
.dim-buttonSpinner, .dim-controlSpinner { width: 14px; height: 14px; box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: dim-feedback-spin .8s linear infinite; }
.dim-buttonSpinner { position: absolute; top: 50%; left: 50%; margin: -7px 0 0 -7px; }
.dim-controlSpinner { position: absolute; right: 28px; top: 50%; margin-top: -7px; pointer-events: none; color: var(--dsw-alias-label-secondary); }
.dim-controlBusy { position: relative; display: block; min-width: 0; }
.dim-preset > .dim-controlBusy, .dim-responseMode > .dim-controlBusy { grid-column: 1 / -1; grid-row: 2; }
.dim-controlBusy > select { display: block; width: 100%; }
.dim-confirmBackdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 24px; background: var(--dsw-alias-mask-bg, rgba(0,0,0,.35)); }
.dim-confirmDialog { width: min(480px, 100%); max-height: calc(100vh - 48px); overflow: auto; box-sizing: border-box; padding: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-shadow-lv3); font-size: 14px; line-height: 22px; }
.dim-confirmDialog strong, .dim-confirmDialog h4 { margin: 0; font: inherit; font-weight: 600; }
.dim-confirmDialog p { margin: 8px 0 16px; color: var(--dsw-alias-label-secondary); }
.dim-confirmDialog .dim-viewActions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.dim-confirmDialog button { position: relative; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dim-confirmDialog button[data-kind="danger"] { color: var(--dsw-alias-state-error-primary); }
.dim-confirmDialog button:disabled { opacity: .5; cursor: not-allowed; }
@keyframes dim-feedback-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dim-buttonSpinner, .dim-controlSpinner { animation: none; } }
`;
function installImStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${IM_STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "@xmanrui/dsh-im";
  style.dataset.pluginCss = IM_STYLE_ID;
  style.textContent = CSS11;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/index.js
var name = "im-settings";
var inject = ["slots", "connection", "locale", "workspaces"];
var IM_PLUGIN_VERSION = package_default.version;
var CHANNELS = Object.freeze([
  { id: "weixin", label: "\u5FAE\u4FE1" },
  { id: "feishu", label: "\u98DE\u4E66" },
  { id: "dingtalk", label: "\u9489\u9489" },
  { id: "wecom", label: "\u4F01\u4E1A\u5FAE\u4FE1" },
  { id: "qq", label: "QQ" },
  { id: "slack", label: "Slack" },
  { id: "telegram", label: "Telegram" },
  { id: "discord", label: "Discord" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "office", label: "AI Office", note: "\uFF08\u5B9E\u9A8C\u529F\u80FD\uFF09" }
]);
function WeixinLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoWeixin", "aria-hidden": "true" },
    h(WeixinLogoGlyph)
  );
}
function FeishuLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoFeishu", "aria-hidden": "true" },
    h(FeishuLogoGlyph)
  );
}
function DingtalkLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoDingtalk", "aria-hidden": "true" },
    h(DingtalkLogoGlyph)
  );
}
function QqLogo() {
  return h("span", { className: "dim-logo dim-logoQq", "aria-hidden": "true" }, h(QqLogoGlyph));
}
function WecomLogo() {
  return h("span", { className: "dim-logo dim-logoWecom", "aria-hidden": "true" }, h(WecomLogoGlyph));
}
function TelegramLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoTelegram", "aria-hidden": "true" },
    h(TelegramLogoGlyph)
  );
}
function SlackLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoSlack", "aria-hidden": "true" },
    h(SlackLogoGlyph)
  );
}
function DiscordLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoDiscord", "aria-hidden": "true" },
    h(DiscordLogoGlyph)
  );
}
function WhatsappLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoWhatsapp", "aria-hidden": "true" },
    h(WhatsappLogoGlyph)
  );
}
function OfficeLogo() {
  return h(
    "span",
    { className: "dim-logo dim-logoOffice", "aria-hidden": "true" },
    h(OfficeLogoGlyph)
  );
}
function ChannelLogo({ channel: channel4 }) {
  if (channel4 === "weixin") return h(WeixinLogo);
  if (channel4 === "feishu") return h(FeishuLogo);
  if (channel4 === "dingtalk") return h(DingtalkLogo);
  if (channel4 === "wecom") return h(WecomLogo);
  if (channel4 === "qq") return h(QqLogo);
  if (channel4 === "slack") return h(SlackLogo);
  if (channel4 === "telegram") return h(TelegramLogo);
  if (channel4 === "discord") return h(DiscordLogo);
  if (channel4 === "whatsapp") return h(WhatsappLogo);
  return h(OfficeLogo);
}
function LoopbackRecoveryNotice({ recovery, onNavigate = replacePageLocation }) {
  return h(FeedbackToast, {
    text: [localizeText("\u8BF7\u6539\u7528 localhost \u91CD\u65B0\u6253\u5F00"), localizeText("\u9875\u9762\u4F1A\u5728\u5F53\u524D\u7AEF\u53E3\u91CD\u65B0\u6253\u5F00\uFF0C\u673A\u5668\u4EBA\u914D\u7F6E\u4E0D\u4F1A\u6539\u53D8\u3002"), recovery.origin].join(" "),
    tone: "error",
    actions: [{ label: "\u4F7F\u7528 localhost \u91CD\u65B0\u6253\u5F00", onClick: () => onNavigate(recovery.url) }]
  });
}
function IMSettingsTab({
  dingtalkRpcCall,
  discordRpcCall,
  feishuRpcCall,
  qqRpcCall,
  slackRpcCall,
  telegramRpcCall,
  wecomRpcCall,
  weixinRpcCall,
  whatsappRpcCall,
  officeRpcCall,
  workspaceDirectoryPicker,
  browserLocation = globalThis.location,
  navigateToRecoveryUrl = replacePageLocation
}) {
  const [selected, setSelected] = React21.useState("weixin");
  const [loopbackRecovery, setLoopbackRecovery] = React21.useState(null);
  const active = CHANNELS.find((channel4) => channel4.id === selected) ?? CHANNELS[0];
  const reportLoopbackRecovery = React21.useCallback((recovery) => {
    setLoopbackRecovery((current) => current?.url === recovery.url ? current : recovery);
  }, []);
  const rpcCalls = React21.useMemo(() => createLoopbackAwareRpcCalls({
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    qqRpcCall,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    weixinRpcCall,
    whatsappRpcCall,
    officeRpcCall
  }, {
    location: browserLocation,
    onRecovery: reportLoopbackRecovery
  }), [
    browserLocation,
    dingtalkRpcCall,
    discordRpcCall,
    feishuRpcCall,
    officeRpcCall,
    qqRpcCall,
    reportLoopbackRecovery,
    slackRpcCall,
    telegramRpcCall,
    wecomRpcCall,
    weixinRpcCall,
    whatsappRpcCall
  ]);
  return h(
    WorkspaceDirectoryPickerContext.Provider,
    { value: workspaceDirectoryPicker },
    h(
      "section",
      { className: "dim-page", "aria-label": "\u6D88\u606F\u6E20\u9053" },
      h(
        "div",
        { className: "dim-layout" },
        h(
          "nav",
          { className: "dim-rail", role: "tablist", "aria-label": "\u6D88\u606F\u6E20\u9053" },
          CHANNELS.map((channel4) => h(
            "button",
            {
              key: channel4.id,
              type: "button",
              role: "tab",
              id: `dim-tab-${channel4.id}`,
              className: "dim-channel",
              "aria-selected": channel4.id === active.id,
              "aria-controls": `dim-panel-${channel4.id}`,
              onClick: () => setSelected(channel4.id)
            },
            h(ChannelLogo, { channel: channel4.id }),
            h(
              "span",
              { className: "dim-channelCopy" },
              h("strong", null, channel4.label),
              channel4.note ? h("small", { className: "dim-channelNote" }, channel4.note) : null
            )
          ))
        ),
        h("div", { className: "dim-divider", "aria-hidden": "true" }),
        h(
          "main",
          {
            className: "dim-panel",
            role: "tabpanel",
            id: `dim-panel-${active.id}`,
            "aria-labelledby": `dim-tab-${active.id}`
          },
          loopbackRecovery ? h(LoopbackRecoveryNotice, {
            recovery: loopbackRecovery,
            onNavigate: navigateToRecoveryUrl
          }) : null,
          active.id === "weixin" ? h(WeixinSettingsTab, { rpcCall: rpcCalls.weixinRpcCall }) : active.id === "feishu" ? h(FeishuSettingsTab, { rpcCall: rpcCalls.feishuRpcCall }) : active.id === "dingtalk" ? h(DingtalkSettingsTab, { rpcCall: rpcCalls.dingtalkRpcCall }) : active.id === "wecom" ? h(WecomSettingsTab, { rpcCall: rpcCalls.wecomRpcCall }) : active.id === "qq" ? h(QqSettingsTab, { rpcCall: rpcCalls.qqRpcCall }) : active.id === "slack" ? h(SlackSettingsTab, { rpcCall: rpcCalls.slackRpcCall }) : active.id === "telegram" ? h(TelegramSettingsTab, { rpcCall: rpcCalls.telegramRpcCall }) : active.id === "discord" ? h(DiscordSettingsTab, { rpcCall: rpcCalls.discordRpcCall }) : active.id === "whatsapp" ? h(WhatsappSettingsTab, { rpcCall: rpcCalls.whatsappRpcCall }) : h(OfficeSettingsTab, { rpcCall: rpcCalls.officeRpcCall })
        )
      )
    )
  );
}
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(IM_LOCALE_NAMESPACE, { zh, en }),
    "im-settings: bilingual dictionaries"
  );
  const t = ctx.locale.bind(IM_LOCALE_NAMESPACE);
  setImTranslator(t);
  ctx.effect(() => {
    const disposers = [
      installFeishuStyles(),
      installWeixinStyles(),
      installWecomStyles(),
      installQqStyles(),
      installSlackStyles(),
      installTelegramStyles(),
      installDiscordStyles(),
      installWhatsappStyles(),
      installOfficeStyles(),
      installImStyles()
    ];
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  }, "im-settings: install combined channel styles");
  const feishuRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(FEISHU_RPC_CHANNEL, endpoint, payload, signal);
  const weixinRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(WEIXIN_RPC_CHANNEL, endpoint, payload, signal);
  const dingtalkRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(DINGTALK_RPC_CHANNEL, endpoint, payload, signal);
  const qqRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(QQ_RPC_CHANNEL, endpoint, payload, signal);
  const wecomRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(WECOM_RPC_CHANNEL, endpoint, payload, signal);
  const telegramRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(TELEGRAM_RPC_CHANNEL, endpoint, payload, signal);
  const discordRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(DISCORD_RPC_CHANNEL, endpoint, payload, signal);
  const whatsappRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(WHATSAPP_RPC_CHANNEL, endpoint, payload, signal);
  const slackRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(SLACK_RPC_CHANNEL, endpoint, payload, signal);
  const officeRpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(OFFICE_RPC_CHANNEL, endpoint, payload, signal);
  const workspaceDirectoryPicker = Object.freeze({
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
    pickDirectory: () => ctx.workspaces.pickDirectory()
  });
  ctx.slots.inject("settings.remote.tab", () => ctx.slots.register({
    name: "settings.remote.tab",
    id: "channels",
    order: 10,
    label: () => ctx.locale.getLocale().active === "en" ? "Channels" : "\u6D88\u606F\u6E20\u9053",
    locale: IM_LOCALE_NAMESPACE,
    inject: () => ({
      dingtalkRpcCall,
      discordRpcCall,
      feishuRpcCall,
      qqRpcCall,
      slackRpcCall,
      telegramRpcCall,
      wecomRpcCall,
      weixinRpcCall,
      whatsappRpcCall,
      officeRpcCall,
      workspaceDirectoryPicker
    })
  }, IMSettingsTab));
}

    return module.exports;
  }
});
