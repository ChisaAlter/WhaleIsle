window.__ModuleLoader__.load({
  id: "dsh-remote",
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
  REMOTE_EXPLORER_ID: () => REMOTE_EXPLORER_ID,
  REMOTE_FILE_ID: () => REMOTE_FILE_ID,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// plugin-src/client/i18n.js
var NS = "dsh-remote";
var zh = {
  "settings.nav": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "settings.summary": "\u628A SSH \u673A\u5668\u53D8\u6210\u5DE5\u4F5C\u533A\uFF1A\u672C\u5730\u955C\u50CF\u76EE\u5F55 + SFTP \u540C\u6B65 + \u8FDC\u7A0B\u6587\u4EF6\u4E0E\u547D\u4EE4\u3002",
  "settings.loading": "\u6B63\u5728\u8BFB\u53D6\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u914D\u7F6E\u2026",
  "settings.loadFailed": "\u65E0\u6CD5\u8BFB\u53D6\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u914D\u7F6E\uFF1A{error}\u3002\u8BF7\u91CD\u8BD5\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u540E\u53F0\u670D\u52A1\u662F\u5426\u8FD0\u884C\u3002",
  "settings.retry": "\u91CD\u65B0\u8BFB\u53D6",
  "settings.active": "\u5F53\u524D\u673A\u5668",
  "settings.none": "\u672A\u9009\u62E9\u673A\u5668",
  "settings.connected": "\u5DF2\u8FDE\u63A5",
  "settings.disconnected": "\u672A\u8FDE\u63A5",
  "settings.workspace": "\u8FDC\u7A0B\u76EE\u5F55",
  "settings.mirror": "\u672C\u5730\u955C\u50CF",
  "settings.clearCurrent": "\u53D6\u6D88\u5F53\u524D",
  "settings.cleared": "\u5DF2\u53D6\u6D88\u5F53\u524D\u8FDC\u7A0B\u673A\u5668",
  "settings.hostKeyKnown": "\u4E3B\u673A\u6307\u7EB9\u5DF2\u4FE1\u4EFB",
  "settings.hostKeyNew": "\u4E3B\u673A\u6307\u7EB9\u672A\u8BB0\u5F55",
  "settings.forgetKey": "\u5FD8\u8BB0\u6307\u7EB9",
  "settings.latency": "{ms} ms",
  "settings.lastConnected": "\u4E0A\u6B21\u8FDE\u63A5 {time}",
  "machines.title": "SSH \u673A\u5668",
  "machines.add": "\u6DFB\u52A0\u673A\u5668",
  "machines.edit": "\u7F16\u8F91",
  "machines.delete": "\u5220\u9664",
  "machines.setCurrent": "\u8BBE\u4E3A\u5F53\u524D",
  "machines.current": "\u5F53\u524D",
  "machines.test": "\u6D4B\u8BD5\u8FDE\u63A5",
  "machines.testing": "\u6D4B\u8BD5\u4E2D\u2026",
  "machines.empty": "\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7684 SSH \u673A\u5668",
  "machines.emptyHint": "\u6DFB\u52A0\u4E00\u53F0\u673A\u5668\u540E\uFF0C\u65B0\u5EFA\u5DE5\u4F5C\u533A\u65F6\u53EF\u4EE5\u9009\u62E9\u300C\u8FDC\u7A0B\u300D\u6807\u7B7E\u9875\u3002",
  "machines.deleteConfirm": "\u5220\u9664\u673A\u5668\u300C{name}\u300D\uFF1F\u672C\u673A\u4FDD\u5B58\u7684\u51ED\u636E\u4F1A\u4E00\u5E76\u79FB\u9664\u3002",
  "machines.passwordSet": "\u5DF2\u5B58\u5BC6\u7801",
  "form.titleAdd": "\u6DFB\u52A0 SSH \u673A\u5668",
  "form.titleEdit": "\u7F16\u8F91 SSH \u673A\u5668",
  "form.name": "\u540D\u79F0",
  "form.namePlaceholder": "\u53EF\u9009\uFF0C\u9ED8\u8BA4\u540C\u4E3B\u673A",
  "form.host": "\u4E3B\u673A",
  "form.hostPlaceholder": "example.com \u6216 192.168.1.10",
  "form.port": "\u7AEF\u53E3",
  "form.username": "\u7528\u6237\u540D",
  "form.auth": "\u8BA4\u8BC1\u65B9\u5F0F",
  "form.password": "\u5BC6\u7801",
  "form.passwordPlaceholder": "SSH \u5BC6\u7801",
  "form.passwordKeep": "\u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8",
  "form.privateKeyPath": "\u79C1\u94A5\u8DEF\u5F84",
  "form.privateKeyPlaceholder": "~/.ssh/id_ed25519",
  "form.passphrase": "\u79C1\u94A5\u53E3\u4EE4",
  "form.passphrasePlaceholder": "\u79C1\u94A5\u52A0\u5BC6\u65F6\u586B\u5199",
  "form.useAgent": "\u4F7F\u7528 SSH Agent",
  "form.keyboardInteractive": "\u952E\u76D8\u4EA4\u4E92\uFF08OTP/\u4E8C\u6B21\u9A8C\u8BC1\uFF09",
  "form.hostKeyMode": "\u4E3B\u673A\u6307\u7EB9\u6821\u9A8C",
  "form.hostKeyAcceptNew": "\u9996\u6B21\u4FE1\u4EFB\uFF08TOFU\uFF09",
  "form.hostKeyVerify": "\u4E25\u683C\u6821\u9A8C",
  "form.hostKeyOff": "\u4E0D\u6821\u9A8C",
  "form.workspace": "\u9ED8\u8BA4\u8FDC\u7A0B\u76EE\u5F55",
  "form.workspacePlaceholder": "\u53EF\u9009\uFF0C\u5982 /srv/app",
  "form.encryptPassword": "\u5B58\u5165\u7CFB\u7EDF\u94A5\u5319\u4E32",
  "form.proxy": "\u8DF3\u677F\u673A",
  "form.proxyHost": "\u8DF3\u677F\u4E3B\u673A",
  "form.proxyPort": "\u8DF3\u677F\u7AEF\u53E3",
  "form.proxyUser": "\u8DF3\u677F\u7528\u6237\u540D",
  "form.proxyPassword": "\u8DF3\u677F\u5BC6\u7801",
  "form.proxyKey": "\u8DF3\u677F\u79C1\u94A5\u8DEF\u5F84",
  "form.save": "\u4FDD\u5B58",
  "form.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "form.cancel": "\u53D6\u6D88",
  "form.testOk": "\u8FDE\u63A5\u6210\u529F\uFF08{ms} ms\uFF0C{platform}\uFF09",
  "form.testFail": "\u8FDE\u63A5\u5931\u8D25\uFF1A{error}",
  "sshconfig.title": "\u4ECE ~/.ssh/config \u5BFC\u5165",
  "sshconfig.import": "\u5BFC\u5165",
  "sshconfig.hint": "\u8BC6\u522B\u5230 {count} \u4E2A\u4E3B\u673A\u522B\u540D\uFF0C\u70B9\u51FB\u5BFC\u5165\u586B\u5165\u8868\u5355\u3002",
  "forwards.title": "\u7AEF\u53E3\u8F6C\u53D1",
  "forwards.empty": "\u5F53\u524D\u673A\u5668\u6CA1\u6709\u8F6C\u53D1\u89C4\u5219",
  "forwards.directionLocal": "\u672C\u5730 \u2192 \u8FDC\u7A0B",
  "forwards.directionReverse": "\u8FDC\u7A0B \u2192 \u672C\u5730",
  "forwards.listenPort": "\u76D1\u542C\u7AEF\u53E3",
  "forwards.targetHost": "\u76EE\u6807\u4E3B\u673A",
  "forwards.targetPort": "\u76EE\u6807\u7AEF\u53E3",
  "forwards.autoStart": "\u81EA\u52A8\u542F\u52A8",
  "forwards.add": "\u6DFB\u52A0\u8F6C\u53D1",
  "forwards.start": "\u542F\u52A8",
  "forwards.stop": "\u505C\u6B62",
  "forwards.remove": "\u79FB\u9664",
  "forwards.running": "\u8FD0\u884C\u4E2D",
  "forwards.stopped": "\u5DF2\u505C\u6B62",
  "forwards.needsMachine": "\u5148\u8BBE\u4E3A\u5F53\u524D\u673A\u5668\u518D\u7BA1\u7406\u8F6C\u53D1",
  "audit.title": "\u64CD\u4F5C\u5BA1\u8BA1",
  "audit.show": "\u67E5\u770B\u5BA1\u8BA1\u65E5\u5FD7",
  "audit.hide": "\u6536\u8D77\u5BA1\u8BA1\u65E5\u5FD7",
  "audit.empty": "\u6682\u65E0\u5BA1\u8BA1\u8BB0\u5F55",
  "audit.disabled": "\u5BA1\u8BA1\u65E5\u5FD7\u672A\u5F00\u542F",
  "picker.machine": "\u8FDC\u7A0B\u673A\u5668",
  "picker.rootPc": "\u6B64\u7535\u8111",
  "picker.machineEmpty": "\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684 SSH \u673A\u5668",
  "picker.machineEmptyHint": "\u5148\u5728 \u8BBE\u7F6E \u203A \u8FDC\u7A0B\u5DE5\u4F5C\u533A \u4E2D\u6DFB\u52A0\u4E00\u53F0\u673A\u5668\u3002",
  "picker.pathPlaceholder": "\u8FDC\u7A0B\u76EE\u5F55\u7EDD\u5BF9\u8DEF\u5F84",
  "picker.home": "\u7528\u6237\u4E3B\u76EE\u5F55",
  "picker.mkdir": "\u65B0\u5EFA\u6587\u4EF6\u5939",
  "picker.mkdirName": "\u6587\u4EF6\u5939\u540D\u79F0",
  "picker.choose": "\u9009\u7528\u6B64\u76EE\u5F55",
  "picker.choosing": "\u5EFA\u7ACB\u955C\u50CF\u4E2D\u2026",
  "picker.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "picker.empty": "\u6B64\u76EE\u5F55\u4E3A\u7A7A",
  "picker.noDirs": "\u6B64\u76EE\u5F55\u6CA1\u6709\u5B50\u76EE\u5F55",
  "picker.up": "\u4E0A\u4E00\u7EA7",
  "picker.refresh": "\u5237\u65B0",
  "picker.mirrorHint": "\u5C06\u5728\u672C\u673A\u521B\u5EFA\u955C\u50CF\u5DE5\u4F5C\u533A\u5E76\u4E0E\u8FDC\u7A0B\u76EE\u5F55\u540C\u6B65\u3002",
  "picker.listFail": "\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25\uFF1A{error}",
  "picker.loadFail": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A\u52A0\u8F7D\u5931\u8D25\uFF1A{error}",
  "explorer.tabTitle": "\u8FDC\u7A0B\u6587\u4EF6",
  "explorer.empty": "\u672C\u4F1A\u8BDD\u4E0D\u662F\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "explorer.emptyHint": "\u4F1A\u8BDD\u76EE\u5F55\u4E0D\u5728\u4EFB\u4F55\u8FDC\u7A0B\u955C\u50CF\u5185\u65F6\uFF0C\u8FD9\u91CC\u4E0D\u663E\u793A\u8FDC\u7A0B\u6587\u4EF6\u3002",
  "explorer.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "explorer.retry": "\u91CD\u8BD5",
  "explorer.missing": "\u8FDC\u7A0B\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BFB",
  "explorer.menuOpen": "\u6253\u5F00",
  "explorer.menuExpand": "\u5C55\u5F00",
  "explorer.menuDownload": "\u4E0B\u8F7D\u5230\u955C\u50CF",
  "explorer.menuCopyAbs": "\u590D\u5236\u7EDD\u5BF9\u8DEF\u5F84",
  "explorer.menuCopyRel": "\u590D\u5236\u76F8\u5BF9\u8DEF\u5F84",
  "explorer.menuRename": "\u91CD\u547D\u540D",
  "explorer.menuMkdir": "\u65B0\u5EFA\u6587\u4EF6\u5939",
  "explorer.menuDelete": "\u5220\u9664",
  "explorer.menuDeleteDir": "\u5220\u9664\u76EE\u5F55",
  "explorer.deleteConfirm": "\u5220\u9664\u8FDC\u7A0B {path}\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
  "explorer.copied": "\u5DF2\u590D\u5236",
  "explorer.newName": "\u65B0\u540D\u79F0",
  "explorer.root": "\u8FDC\u7A0B\u5DE5\u4F5C\u533A",
  "file.readonly": "\u53EA\u8BFB",
  "file.edit": "\u7F16\u8F91",
  "file.editing": "\u7F16\u8F91\u4E2D",
  "file.dirty": "\u672A\u4FDD\u5B58",
  "file.saveToRemote": "\u4FDD\u5B58\u5230\u8FDC\u7A0B",
  "file.saveHint": "Ctrl/Cmd+S \u4FDD\u5B58\uFF1Bmtime \u51B2\u7A81\u4F1A\u88AB\u62D2\u7EDD",
  "file.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "file.cancel": "\u53D6\u6D88",
  "file.download": "\u4E0B\u8F7D\u5230\u955C\u50CF",
  "file.downloaded": "\u5DF2\u4E0B\u8F7D{path}",
  "file.downloadedAt": " \u5230 {path}",
  "file.loading": "\u8BFB\u53D6\u4E2D\u2026",
  "file.empty": "\uFF08\u7A7A\u6587\u4EF6\uFF09",
  "file.binary": "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF08{size}\uFF09\uFF0C\u4E0D\u652F\u6301\u9884\u89C8\u6216\u7F16\u8F91",
  "file.unknownSize": "\u5927\u5C0F\u672A\u77E5",
  "file.truncated": "\u5185\u5BB9\u8FC7\u957F\uFF0C\u5DF2\u622A\u65AD\uFF1B\u7F16\u8F91\u4FDD\u5B58\u4F1A\u5199\u5165\u622A\u65AD\u540E\u7684\u5185\u5BB9",
  "file.conflict": "\u8FDC\u7AEF\u6587\u4EF6\u5DF2\u53D8\u5316\uFF0C\u4FDD\u5B58\u88AB\u62D2\u7EDD\u2014\u2014\u8BF7\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u7F16\u8F91",
  "file.readFail": "\u8BFB\u53D6\u5931\u8D25\uFF1A{msg}",
  "common.close": "\u5173\u95ED"
};
var en = {
  "settings.nav": "Remote Workspaces",
  "settings.summary": "Turn SSH machines into workspaces: local mirror directories with SFTP sync, remote files and commands.",
  "settings.loading": "Reading remote workspace configuration\u2026",
  "settings.loadFailed": "Could not read remote workspace configuration: {error}. Retry, then check that the background service is running.",
  "settings.retry": "Reload",
  "settings.active": "Active machine",
  "settings.none": "No machine selected",
  "settings.connected": "Connected",
  "settings.disconnected": "Disconnected",
  "settings.workspace": "Remote path",
  "settings.mirror": "Local mirror",
  "settings.clearCurrent": "Clear active",
  "settings.cleared": "Active remote machine cleared",
  "settings.hostKeyKnown": "Host key trusted",
  "settings.hostKeyNew": "Host key not recorded",
  "settings.forgetKey": "Forget key",
  "settings.latency": "{ms} ms",
  "settings.lastConnected": "Last connected {time}",
  "machines.title": "SSH machines",
  "machines.add": "Add machine",
  "machines.edit": "Edit",
  "machines.delete": "Delete",
  "machines.setCurrent": "Set active",
  "machines.current": "Active",
  "machines.test": "Test connection",
  "machines.testing": "Testing\u2026",
  "machines.empty": "No saved SSH machines yet",
  "machines.emptyHint": 'Once a machine is added, the "Remote" tab appears when creating a workspace.',
  "machines.deleteConfirm": 'Delete machine "{name}"? Locally stored credentials are removed too.',
  "machines.passwordSet": "Password saved",
  "form.titleAdd": "Add SSH machine",
  "form.titleEdit": "Edit SSH machine",
  "form.name": "Name",
  "form.namePlaceholder": "Optional; defaults to host",
  "form.host": "Host",
  "form.hostPlaceholder": "example.com or 192.168.1.10",
  "form.port": "Port",
  "form.username": "Username",
  "form.auth": "Authentication",
  "form.password": "Password",
  "form.passwordPlaceholder": "SSH password",
  "form.passwordKeep": "Leave blank to keep current",
  "form.privateKeyPath": "Private key path",
  "form.privateKeyPlaceholder": "~/.ssh/id_ed25519",
  "form.passphrase": "Key passphrase",
  "form.passphrasePlaceholder": "If the key is encrypted",
  "form.useAgent": "Use SSH agent",
  "form.keyboardInteractive": "Keyboard-interactive (OTP/2FA)",
  "form.hostKeyMode": "Host key verification",
  "form.hostKeyAcceptNew": "Trust on first use (TOFU)",
  "form.hostKeyVerify": "Strict verify",
  "form.hostKeyOff": "Disabled",
  "form.workspace": "Default remote path",
  "form.workspacePlaceholder": "Optional, e.g. /srv/app",
  "form.encryptPassword": "Store in system keychain",
  "form.proxy": "Jump host",
  "form.proxyHost": "Jump host",
  "form.proxyPort": "Jump port",
  "form.proxyUser": "Jump username",
  "form.proxyPassword": "Jump password",
  "form.proxyKey": "Jump key path",
  "form.save": "Save",
  "form.saving": "Saving\u2026",
  "form.cancel": "Cancel",
  "form.testOk": "Connected ({ms} ms, {platform})",
  "form.testFail": "Connection failed: {error}",
  "sshconfig.title": "Import from ~/.ssh/config",
  "sshconfig.import": "Import",
  "sshconfig.hint": "{count} host aliases found; click import to fill the form.",
  "forwards.title": "Port forwards",
  "forwards.empty": "No forwards on the active machine",
  "forwards.directionLocal": "Local \u2192 remote",
  "forwards.directionReverse": "Remote \u2192 local",
  "forwards.listenPort": "Listen port",
  "forwards.targetHost": "Target host",
  "forwards.targetPort": "Target port",
  "forwards.autoStart": "Auto start",
  "forwards.add": "Add forward",
  "forwards.start": "Start",
  "forwards.stop": "Stop",
  "forwards.remove": "Remove",
  "forwards.running": "Running",
  "forwards.stopped": "Stopped",
  "forwards.needsMachine": "Set a machine active to manage forwards",
  "audit.title": "Audit log",
  "audit.show": "Show audit log",
  "audit.hide": "Hide audit log",
  "audit.empty": "No audit entries yet",
  "audit.disabled": "Audit log is disabled",
  "picker.machine": "Remote machine",
  "picker.rootPc": "This PC",
  "picker.machineEmpty": "No saved SSH machines",
  "picker.machineEmptyHint": "Add a machine first under Settings \u203A Remote Workspaces.",
  "picker.pathPlaceholder": "Absolute remote directory path",
  "picker.home": "Home directory",
  "picker.mkdir": "New folder",
  "picker.mkdirName": "Folder name",
  "picker.choose": "Use this directory",
  "picker.choosing": "Creating mirror\u2026",
  "picker.loading": "Loading\u2026",
  "picker.empty": "This directory is empty",
  "picker.noDirs": "No subdirectories here",
  "picker.up": "Up",
  "picker.refresh": "Refresh",
  "picker.mirrorHint": "A local mirror workspace will be created and synced with the remote directory.",
  "picker.listFail": "Could not list directory: {error}",
  "picker.loadFail": "Failed to load remote workspace: {error}",
  "explorer.tabTitle": "Remote Files",
  "explorer.empty": "This session is not a remote workspace",
  "explorer.emptyHint": "Remote files show only when the session directory sits inside a remote mirror.",
  "explorer.loading": "Loading\u2026",
  "explorer.retry": "Retry",
  "explorer.missing": "Remote directory is missing or unreadable",
  "explorer.menuOpen": "Open",
  "explorer.menuExpand": "Expand",
  "explorer.menuDownload": "Download to mirror",
  "explorer.menuCopyAbs": "Copy absolute path",
  "explorer.menuCopyRel": "Copy relative path",
  "explorer.menuRename": "Rename",
  "explorer.menuMkdir": "New folder",
  "explorer.menuDelete": "Delete",
  "explorer.menuDeleteDir": "Delete directory",
  "explorer.deleteConfirm": "Delete remote {path}? This cannot be undone.",
  "explorer.copied": "Copied",
  "explorer.newName": "New name",
  "explorer.root": "Remote workspace",
  "file.readonly": "Read-only",
  "file.edit": "Edit",
  "file.editing": "Editing",
  "file.dirty": "Unsaved",
  "file.saveToRemote": "Save to remote",
  "file.saveHint": "Ctrl/Cmd+S to save; an mtime conflict is rejected",
  "file.saving": "Saving\u2026",
  "file.cancel": "Cancel",
  "file.download": "Download to mirror",
  "file.downloaded": "Downloaded{path}",
  "file.downloadedAt": " to {path}",
  "file.loading": "Reading\u2026",
  "file.empty": "(empty file)",
  "file.binary": "Binary file ({size}); preview and edit are unavailable",
  "file.unknownSize": "unknown size",
  "file.truncated": "Content truncated; saving writes the truncated text",
  "file.conflict": "The remote file changed; save rejected \u2014 read it again before editing",
  "file.readFail": "Read failed: {msg}",
  "common.close": "Close"
};

// plugin-src/client/api.js
function withSessionQuery(path, sessionId) {
  if (!sessionId) return path;
  return path + (path.includes("?") ? "&" : "?") + "sessionId=" + encodeURIComponent(sessionId);
}
function withSessionBody(body, sessionId) {
  if (!sessionId) return { ...body || {} };
  return Object.assign({}, body || {}, { sessionId });
}
async function apiRaw(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== void 0) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function api(method, path, body) {
  const { status, data } = await apiRaw(method, path, body);
  if (status >= 400) throw new Error(data && (data.error || data.message) || "HTTP " + status);
  return data;
}
var remoteApi = {
  raw: apiRaw,
  status: (sessionId) => api("GET", withSessionQuery("/dsh-remote/status", sessionId)),
  machines: () => api("GET", "/dsh-remote/machines"),
  saveMachine: (payload) => api("POST", "/dsh-remote/machines", payload),
  deleteMachine: (id) => api("POST", "/dsh-remote/machines", { action: "delete", id }),
  setCurrent: (id) => api("POST", "/dsh-remote/current", { id }),
  testConnect: (payload) => api("POST", "/dsh-remote/test-connect", payload),
  connect: (payload = {}) => api("POST", "/dsh-remote/connect", payload),
  pickWorkspace: (path) => api("POST", "/dsh-remote/mirror", { path }),
  resolveMirror: (local, sessionId) => {
    if (local) return api("GET", "/dsh-remote/resolve-mirror?local=" + encodeURIComponent(local));
    if (sessionId) return api("GET", "/dsh-remote/resolve-mirror?sessionId=" + encodeURIComponent(sessionId));
    return Promise.resolve({ remotePath: "" });
  },
  remoteHome: () => api("POST", "/dsh-remote/home"),
  ls: (path, sessionId) => api("GET", withSessionQuery("/dsh-remote/ls?path=" + encodeURIComponent(path || ""), sessionId)),
  read: (path, maxBytes, sessionId) => api("POST", "/dsh-remote/read", withSessionBody({ path, maxBytes }, sessionId)),
  write: (path, content, expectedMtime, sessionId) => apiRaw("POST", "/dsh-remote/write", withSessionBody({ path, content, expectedMtime }, sessionId)),
  fs: (op, payload, sessionId) => api("POST", "/dsh-remote/fs", withSessionBody({ op, ...payload }, sessionId)),
  forwards: () => api("GET", "/dsh-remote/forwards"),
  forwardAction: (payload) => api("POST", "/dsh-remote/forwards", payload),
  audit: (limit) => api("GET", "/dsh-remote/audit?limit=" + encodeURIComponent(limit || 100)),
  sshConfig: () => api("GET", "/dsh-remote/ssh-config"),
  forgetKey: () => api("POST", "/dsh-remote/forget-key")
};
var RESOURCE_PREFIX = "dsh-resource://dsh-remote/";
function remoteFileAddress(sessionId, path) {
  return RESOURCE_PREFIX + encodeURIComponent(sessionId) + "/" + encodeURIComponent(path);
}
function remoteFileTarget(address) {
  const url = new URL(address);
  if (url.protocol !== "dsh-resource:" || url.hostname !== "dsh-remote") {
    throw new Error("invalid remote resource address");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  return {
    sessionId: decodeURIComponent(parts[0] || ""),
    path: decodeURIComponent(parts.slice(1).join("/"))
  };
}
function parentRemotePath(p) {
  const t = String(p || "");
  if (!t || t === "/") return null;
  const win = /^[a-zA-Z]:/.test(t);
  if (win && /^[a-zA-Z]:\\?$/.test(t)) return null;
  const sep = win ? "\\" : "/";
  const idx = t.lastIndexOf(sep);
  if (idx <= 0) return null;
  const par = t.slice(0, idx);
  if (win && /^[a-zA-Z]:$/.test(par)) return par + "\\";
  return par || "/";
}
function remoteCrumbs(p) {
  const t = String(p || "");
  if (!t) return [];
  const win = /^[a-zA-Z]:/.test(t);
  const sep = win ? "\\" : "/";
  const parts = t.split(/[\\/]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (win) {
      out.push({ name: parts[i], path: i === 0 ? parts[0] + "\\" : parts.slice(0, i + 1).join("\\") });
    } else {
      out.push({ name: parts[i], path: "/" + parts.slice(0, i + 1).join("/") });
    }
  }
  return { sep, parts: out, windows: win };
}

// plugin-src/client/styles.js
var STYLE_ID = "dsh-remote";
var CSS = `
.dshr-page { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshr-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshr-cardTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px; }
.dshr-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshr-rowBetween { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dshr-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dshr-grow { flex: 1; min-width: 0; }
.dshr-muted { color: var(--dsw-alias-label-tertiary); }
.dshr-secondary { color: var(--dsw-alias-label-secondary); }
.dshr-caption { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); font-size: 12px; }
.dshr-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }
.dshr-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.dshr-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-mono { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-mono input { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dshr-iconBtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.dshr-iconBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-iconBtn:disabled { opacity: 0.4; cursor: not-allowed; }

.dshr-machineList { display: flex; flex-direction: column; gap: 6px; }
.dshr-machine { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dshr-machine[data-current="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.dshr-machineMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dshr-machineName { font-weight: 600; font-size: 13px; }
.dshr-machineSub { font-size: 12px; color: var(--dsw-alias-label-tertiary); display: flex; gap: 8px; flex-wrap: wrap; }

.dshr-form { display: grid; grid-template-columns: 108px minmax(0, 1fr); gap: 8px 10px; align-items: center; }
.dshr-formLabel { font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: right; }
.dshr-formFull { grid-column: 1 / -1; }
.dshr-checkRow { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }

.dshr-flow { display: flex; flex-direction: column; min-height: 0; min-width: 0; flex: 1; color: var(--dsw-alias-label-primary); }
.dshr-flowContent { display: flex; flex-direction: column; gap: 12px; flex: 1 1 0; min-height: 0; overflow: auto; padding: 16px 24px; }
.dshr-flowContent > .dshr-row { flex: none; }
.dshr-flowContent .dshr-formLabel { flex: none; }
.dshr-flowContent .dshr-iconBtn { flex: none; }
.dshr-flowContent .dshr-list { min-height: 80px; max-height: none; }
.dshr-flowContent .dshr-emptyState { flex: 1; justify-content: center; }
.dshr-flowStatus { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; flex: 1; padding: 16px; text-align: center; overflow-wrap: anywhere; }
.dshr-flowFooter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: none; padding: 16px 24px; border-top: 0.5px solid var(--dsw-alias-border-l3); }
.dshr-flowActions { display: flex; gap: 8px; margin-left: auto; }
.dshr-flowActions > button { min-width: 72px; }
.dshr-crumbs { display: flex; align-items: center; gap: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; }
.dshr-crumb { cursor: pointer; padding: 1px 3px; border: none; background: transparent; color: inherit; font: inherit; border-radius: 4px; }
.dshr-crumb:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshr-crumbLast { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dshr-list { flex: 1; min-height: 140px; max-height: 280px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 4px; }
.dshr-listItem { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; text-align: left; cursor: pointer; }
.dshr-listItem:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-listItem:disabled { cursor: default; }
.dshr-listItem[data-kind="file"] { color: var(--dsw-alias-label-tertiary); }
.dshr-listEmpty { padding: 18px 12px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.dshr-tree { height: 100%; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; }
.dshr-treeRow { display: flex; align-items: center; gap: 4px; width: 100%; padding: 3px 4px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; text-align: left; cursor: pointer; }
.dshr-treeRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshr-treeRow[data-kind="file"] { color: var(--dsw-alias-label-secondary); }
.dshr-treeToggle { width: 14px; flex-shrink: 0; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dshr-treeName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshr-treeBadge { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); flex-shrink: 0; }

.dshr-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); }
.dshr-editorHead { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); font-size: 12px; }
.dshr-editorBody { flex: 1; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.dshr-editorText { flex: 1; width: 100%; box-sizing: border-box; border: none; outline: none; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
.dshr-editorView { font-size: 13px; line-height: 1.55; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }

.dshr-audit { max-height: 220px; overflow-y: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; }
.dshr-emptyState { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dshr-warn { color: var(--dsw-alias-state-warn-primary); }
`;
function installRemoteStyles() {
  if (typeof document === "undefined") return () => {
  };
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`);
  if (existing) return () => {
  };
  const style = document.createElement("style");
  style.dataset.plugin = "dsh-remote";
  style.dataset.pluginCss = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

// plugin-src/client/RemoteSettingsSection.jsx
var React2 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// plugin-src/client/MachineForm.jsx
var React = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
var EMPTY_FORM = {
  name: "",
  host: "",
  port: "22",
  username: "root",
  password: "",
  privateKeyPath: "",
  passphrase: "",
  workspace: "",
  hostKeyMode: "",
  useAgent: false,
  keyboardInteractive: false,
  encryptPassword: false,
  proxyHost: "",
  proxyPort: "22",
  proxyUser: "",
  proxyPassword: "",
  proxyKey: "",
  id: ""
};
function formFromMachine(m) {
  return {
    ...EMPTY_FORM,
    id: m.id || "",
    name: m.name || "",
    host: m.host || "",
    port: String(m.port || 22),
    username: m.username || "root",
    password: "",
    privateKeyPath: m.privateKeyPath || "",
    passphrase: m.passphrase || "",
    workspace: m.workspace || "",
    hostKeyMode: m.hostKeyMode || "",
    useAgent: !!m.useAgent,
    keyboardInteractive: !!m.keyboardInteractive,
    encryptPassword: m.credentialBackend && m.credentialBackend !== "plain",
    proxyHost: m.proxy && m.proxy.host || "",
    proxyPort: String(m.proxy && m.proxy.port || 22),
    proxyUser: m.proxy && m.proxy.username || "",
    proxyPassword: "",
    proxyKey: m.proxy && m.proxy.privateKeyPath || ""
  };
}
function payloadOf(f) {
  return {
    action: f.id ? "update" : "add",
    id: f.id || void 0,
    name: f.name,
    host: f.host.trim(),
    port: Number(f.port) || 22,
    username: f.username.trim() || "root",
    password: f.password || void 0,
    privateKeyPath: f.privateKeyPath,
    passphrase: f.passphrase,
    workspace: f.workspace,
    hostKeyMode: f.hostKeyMode || void 0,
    useAgent: f.useAgent,
    keyboardInteractive: f.keyboardInteractive,
    encryptPassword: f.encryptPassword,
    proxy: f.proxyHost.trim() ? {
      host: f.proxyHost.trim(),
      port: Number(f.proxyPort) || 22,
      username: f.proxyUser,
      password: f.proxyPassword,
      privateKeyPath: f.proxyKey
    } : void 0
  };
}
function testPayloadOf(f) {
  return {
    machineId: f.id || void 0,
    host: f.host.trim(),
    port: Number(f.port) || 22,
    username: f.username.trim() || "root",
    password: f.password,
    privateKeyPath: f.privateKeyPath,
    passphrase: f.passphrase,
    hostKeyMode: f.hostKeyMode || void 0,
    useAgent: f.useAgent,
    keyboardInteractive: f.keyboardInteractive,
    proxy: f.proxyHost.trim() ? {
      host: f.proxyHost.trim(),
      port: Number(f.proxyPort) || 22,
      username: f.proxyUser,
      password: f.proxyPassword,
      privateKeyPath: f.proxyKey
    } : void 0
  };
}
function MachineForm({ t, machine, onSaved, onCancel }) {
  const editing = machine || null;
  const [form, setForm] = React.useState(() => editing ? formFromMachine(editing) : EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const set = (key) => (e) => {
    const value = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const hostKeyOptions = [
    { id: "", label: t("form.hostKeyAcceptNew") },
    { id: "verify", label: t("form.hostKeyVerify") },
    { id: "off", label: t("form.hostKeyOff") }
  ];
  const save = () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    remoteApi.saveMachine(payloadOf(form)).then((r) => {
      const warning = r && r.warning;
      if (warning) setNotice({ kind: "err", text: warning + (r.warningDetail ? ` (${r.warningDetail})` : "") });
      onSaved && onSaved(r);
    }).catch((e) => setNotice({ kind: "err", text: String(e && e.message || e) })).finally(() => setBusy(false));
  };
  const test = () => {
    if (testing) return;
    setTesting(true);
    setNotice(null);
    remoteApi.testConnect(testPayloadOf(form)).then((r) => {
      if (r && r.ok) setNotice({ kind: "ok", text: t("form.testOk", { ms: String(r.latencyMs ?? "?"), platform: r.platform || "?" }) });
      else setNotice({ kind: "err", text: t("form.testFail", { error: r && r.error || "?" }) });
    }).catch((e) => setNotice({ kind: "err", text: t("form.testFail", { error: String(e && e.message || e) }) })).finally(() => setTesting(false));
  };
  const field = (label, node) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(React.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-formLabel", children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-row", children: node })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-col", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-cardTitle", children: editing ? t("form.titleEdit") : t("form.titleAdd") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-form", children: [
      field(t("form.name"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.name, onChange: set("name"), placeholder: t("form.namePlaceholder"), className: "dshr-grow" })),
      field(t("form.host"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.host, onChange: set("host"), placeholder: t("form.hostPlaceholder"), className: "dshr-grow" })),
      field(t("form.port"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.port, onChange: set("port"), inputMode: "numeric", className: "dshr-grow" })),
      field(t("form.username"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.username, onChange: set("username"), className: "dshr-grow" })),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-formFull dshr-cardTitle", style: { marginTop: 4 }, children: t("form.auth") }),
      field(t("form.password"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.Input,
        {
          type: "password",
          value: form.password,
          onChange: set("password"),
          placeholder: editing && editing.passwordSet ? t("form.passwordKeep") : t("form.passwordPlaceholder"),
          className: "dshr-grow"
        }
      )),
      field(t("form.privateKeyPath"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.privateKeyPath, onChange: set("privateKeyPath"), placeholder: t("form.privateKeyPlaceholder"), className: "dshr-grow" })),
      field(t("form.passphrase"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { type: "password", value: form.passphrase, onChange: set("passphrase"), placeholder: t("form.passphrasePlaceholder"), className: "dshr-grow" })),
      field(t("form.hostKeyMode"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_dsh_client_ui_primitives.SettingsSelect,
        {
          variant: "block",
          value: form.hostKeyMode,
          options: hostKeyOptions,
          onChange: (id) => setForm((f) => ({ ...f, hostKeyMode: id })),
          "aria-label": t("form.hostKeyMode"),
          className: "dshr-grow"
        }
      )),
      field(t("form.workspace"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.workspace, onChange: set("workspace"), placeholder: t("form.workspacePlaceholder"), className: "dshr-grow" })),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-formFull dshr-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-checkRow", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Checkbox, { checked: form.useAgent, onChange: (v) => setForm((f) => ({ ...f, useAgent: v })), label: t("form.useAgent") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-checkRow", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Checkbox, { checked: form.keyboardInteractive, onChange: (v) => setForm((f) => ({ ...f, keyboardInteractive: v })), label: t("form.keyboardInteractive") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-checkRow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Switch, { checked: form.encryptPassword, onChange: (v) => setForm((f) => ({ ...f, encryptPassword: v })), label: t("form.encryptPassword") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("form.encryptPassword") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-formFull", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dshr-cardTitle", children: t("form.proxy") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-form", style: { marginTop: 8 }, children: [
          field(t("form.proxyHost"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.proxyHost, onChange: set("proxyHost"), className: "dshr-grow" })),
          field(t("form.proxyPort"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.proxyPort, onChange: set("proxyPort"), inputMode: "numeric", className: "dshr-grow" })),
          field(t("form.proxyUser"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.proxyUser, onChange: set("proxyUser"), className: "dshr-grow" })),
          field(t("form.proxyPassword"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { type: "password", value: form.proxyPassword, onChange: set("proxyPassword"), className: "dshr-grow" })),
          field(t("form.proxyKey"), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Input, { value: form.proxyKey, onChange: set("proxyKey"), className: "dshr-grow" }))
        ] })
      ] })
    ] }),
    notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: notice.kind === "ok" ? "dshr-ok" : "dshr-error", children: notice.text }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dshr-row", style: { justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", onClick: test, disabled: testing || !form.host.trim(), children: testing ? t("machines.testing") : t("machines.test") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", onClick: onCancel, children: t("form.cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", size: "sm", onClick: save, disabled: busy || !form.host.trim(), children: busy ? t("form.saving") : t("form.save") })
    ] })
  ] });
}

// plugin-src/client/RemoteSettingsSection.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var EMPTY_FORWARD = { direction: "local", listenPort: "", targetHost: "127.0.0.1", targetPort: "", autoStart: false };
function RemoteSettingsSection({ t }) {
  const [status, setStatus] = React2.useState(null);
  const [machines, setMachines] = React2.useState([]);
  const [currentId, setCurrentId] = React2.useState(null);
  const [err, setErr] = React2.useState("");
  const [loadError, setLoadError] = React2.useState("");
  const [loading, setLoading] = React2.useState(true);
  const loadGeneration = React2.useRef(0);
  const [msg, setMsg] = React2.useState("");
  const [busyId, setBusyId] = React2.useState("");
  const [formOpen, setFormOpen] = React2.useState(false);
  const [editing, setEditing] = React2.useState(null);
  const [sshEntries, setSshEntries] = React2.useState(null);
  const [forwards, setForwards] = React2.useState([]);
  const [fwdForm, setFwdForm] = React2.useState(EMPTY_FORWARD);
  const [audit, setAudit] = React2.useState(null);
  const [confirmDel, setConfirmDel] = React2.useState(null);
  const refresh = React2.useCallback(() => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    return Promise.all([remoteApi.machines(), remoteApi.status(), remoteApi.forwards()]).then(([r, s, f]) => {
      if (generation !== loadGeneration.current) return;
      setMachines(r.machines || []);
      setCurrentId(r.currentId || null);
      setStatus(s);
      setForwards(f.forwards || []);
    }).catch((e) => {
      if (generation === loadGeneration.current) setLoadError(String(e && e.message || e));
    }).finally(() => {
      if (generation === loadGeneration.current) setLoading(false);
    });
  }, []);
  React2.useEffect(() => {
    refresh();
    return () => {
      loadGeneration.current++;
    };
  }, [refresh]);
  const run = (fn, okMsg) => {
    setErr("");
    setMsg("");
    return fn().then(() => {
      if (okMsg) setMsg(okMsg);
      refresh();
    }).catch((e) => setErr(String(e && e.message || e)));
  };
  const setCurrent = (id) => {
    setBusyId(id || "clear");
    run(() => remoteApi.setCurrent(id), id ? "" : t("settings.cleared")).finally(() => setBusyId(""));
  };
  const testMachine = (m) => {
    setBusyId("test:" + m.id);
    setErr("");
    setMsg("");
    remoteApi.testConnect({
      machineId: m.id,
      host: m.host,
      port: m.port,
      username: m.username,
      privateKeyPath: m.privateKeyPath,
      passphrase: m.passphrase,
      hostKeyMode: m.hostKeyMode || void 0,
      useAgent: m.useAgent,
      keyboardInteractive: m.keyboardInteractive,
      proxy: m.proxy && m.proxy.host ? m.proxy : void 0
    }).then((r) => {
      if (r && r.ok) setMsg(t("form.testOk", { ms: String(r.latencyMs ?? "?"), platform: r.platform || "?" }));
      else setErr(t("form.testFail", { error: r && r.error || "?" }));
      refresh();
    }).catch((e) => setErr(t("form.testFail", { error: String(e && e.message || e) }))).finally(() => setBusyId(""));
  };
  const removeMachine = (m) => {
    setConfirmDel(m);
  };
  const importable = sshEntries || [];
  React2.useEffect(() => {
    remoteApi.sshConfig().then((r) => setSshEntries(r && r.entries || [])).catch(() => setSshEntries([]));
  }, []);
  const addForward = () => {
    const listen = Number(fwdForm.listenPort) || 0;
    const target = Number(fwdForm.targetPort) || listen;
    if (!listen) return;
    run(() => remoteApi.forwardAction({
      action: "define",
      direction: fwdForm.direction,
      listenPort: listen,
      targetHost: fwdForm.targetHost || "127.0.0.1",
      targetPort: target,
      autoStart: fwdForm.autoStart
    })).then(() => setFwdForm(EMPTY_FORWARD));
  };
  const current = machines.find((m) => m.id === currentId) || null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-page", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("settings.summary") }),
    loading ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", className: "dshr-caption", children: t("settings.loading") }) : null,
    loadError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "alert", className: "dshr-error", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("settings.loadFailed", { error: loadError }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "ghost", onClick: refresh, children: t("settings.retry") })
    ] }) : null,
    err ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-error", children: err }) : null,
    msg ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-ok", children: msg }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-cardTitle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: status && status.connected ? "done" : "idle" }),
        t("settings.active"),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-muted dshr-ellipsis", children: current ? current.name || current.host : t("settings.none") })
      ] }),
      status ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row dshr-secondary", style: { fontSize: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: status.connected ? t("settings.connected") : t("settings.disconnected") }),
          status.host ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-mono", children: [
            status.username,
            "@",
            status.host,
            ":",
            status.port
          ] }) : null,
          status.connected ? status.hostKeyKnown ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("settings.hostKeyKnown") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("settings.hostKeyNew") }) : null
        ] }),
        status.workspace ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-col", style: { fontSize: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-muted", children: [
            t("settings.workspace"),
            ": ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-mono", children: status.workspace })
          ] }),
          status.localMirror ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-muted", children: [
            t("settings.mirror"),
            ": ",
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-mono", children: status.localMirror })
          ] }) : null
        ] }) : null,
        currentId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => setCurrent(""), disabled: busyId === "clear", children: t("settings.clearCurrent") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => run(() => remoteApi.forgetKey()), children: t("settings.forgetKey") })
        ] }) : null
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-rowBetween", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-cardTitle", children: t("machines.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => {
          setEditing(null);
          setFormOpen((v) => !v);
        }, children: t("machines.add") })
      ] }),
      formOpen || editing ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        MachineForm,
        {
          t,
          machine: editing,
          onSaved: () => {
            setFormOpen(false);
            setEditing(null);
            refresh();
          },
          onCancel: () => {
            setFormOpen(false);
            setEditing(null);
          }
        }
      ) : null,
      !loading && !loadError && !formOpen && !editing && machines.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-emptyState", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("machines.empty") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-caption", children: t("machines.emptyHint") })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-machineList", children: machines.map((m) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-machine", "data-current": m.id === currentId, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-machineMeta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-machineName dshr-ellipsis", children: m.name || m.host }),
            m.id === currentId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tag, { tone: "outline", children: t("machines.current") }) : null,
            m.passwordSet ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-caption", children: t("machines.passwordSet") }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-machineSub", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-mono", children: [
              m.username,
              "@",
              m.host,
              ":",
              m.port
            ] }),
            m.workspace ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dshr-mono dshr-ellipsis", children: m.workspace }) : null,
            m.latencyMs ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("settings.latency", { ms: String(m.latencyMs) }) }) : null,
            m.lastConnectedAt ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("settings.lastConnected", { time: String(m.lastConnectedAt).replace("T", " ").slice(0, 16) }) }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row", style: { flexShrink: 0 }, children: [
          m.id !== currentId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => setCurrent(m.id), disabled: busyId === m.id, children: t("machines.setCurrent") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => testMachine(m), disabled: busyId === "test:" + m.id, children: busyId === "test:" + m.id ? t("machines.testing") : t("machines.test") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => {
            setEditing(m);
            setFormOpen(false);
          }, children: t("machines.edit") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => removeMachine(m), disabled: busyId === "del:" + m.id, children: t("machines.delete") })
        ] })
      ] }, m.id)) })
    ] }),
    importable.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-cardTitle", children: t("sshconfig.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("sshconfig.hint", { count: String(importable.length) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-machineList", children: importable.map((e, i) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-rowBetween", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-mono dshr-secondary", style: { fontSize: 12 }, children: [
          e.host,
          e.user ? ` (${e.user}@${e.hostName || e.host}${e.port && e.port !== 22 ? ":" + e.port : ""})` : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => {
          setEditing({
            name: e.host,
            host: e.hostName || e.host,
            port: e.port || 22,
            username: e.user || "root",
            privateKeyPath: e.identityFile || "",
            proxy: e.proxyJump ? { host: e.proxyJump } : void 0
          });
          setFormOpen(false);
        }, children: t("sshconfig.import") })
      ] }, i)) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-cardTitle", children: t("forwards.title") }),
      !currentId ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("forwards.needsMachine") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(React2.Fragment, { children: [
        forwards.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("forwards.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-machineList", children: forwards.map((f) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-rowBetween", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dshr-mono dshr-secondary", style: { fontSize: 12 }, children: [
            f.direction === "reverse" ? "R" : "L",
            " :",
            f.listenPort,
            " \u2192 ",
            f.targetHost,
            ":",
            f.targetPort
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tag, { tone: "outline", children: f.running ? t("forwards.running") : t("forwards.stopped") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => run(() => remoteApi.forwardAction({ action: f.running ? "stop" : "start", id: f.id })), children: f.running ? t("forwards.stop") : t("forwards.start") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => run(() => remoteApi.forwardAction({ action: "remove", id: f.id })), children: t("forwards.remove") })
          ] })
        ] }, f.id)) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-row", style: { flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            import_dsh_client_ui_primitives2.SettingsSelect,
            {
              variant: "inline",
              value: fwdForm.direction,
              options: [
                { id: "local", label: t("forwards.directionLocal") },
                { id: "reverse", label: t("forwards.directionReverse") }
              ],
              onChange: (id) => setFwdForm((f) => ({ ...f, direction: id })),
              "aria-label": t("forwards.title")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            import_dsh_client_ui_primitives2.Input,
            {
              value: fwdForm.listenPort,
              onChange: (e) => setFwdForm((f) => ({ ...f, listenPort: e.target.value })),
              placeholder: t("forwards.listenPort"),
              inputMode: "numeric",
              style: { width: 90 }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            import_dsh_client_ui_primitives2.Input,
            {
              value: fwdForm.targetHost,
              onChange: (e) => setFwdForm((f) => ({ ...f, targetHost: e.target.value })),
              placeholder: t("forwards.targetHost"),
              style: { width: 130 }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            import_dsh_client_ui_primitives2.Input,
            {
              value: fwdForm.targetPort,
              onChange: (e) => setFwdForm((f) => ({ ...f, targetPort: e.target.value })),
              placeholder: t("forwards.targetPort"),
              inputMode: "numeric",
              style: { width: 90 }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Checkbox, { checked: fwdForm.autoStart, onChange: (v) => setFwdForm((f) => ({ ...f, autoStart: v })), label: t("forwards.autoStart") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: addForward, disabled: !fwdForm.listenPort, children: t("forwards.add") })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dshr-rowBetween", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-cardTitle", children: t("audit.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => {
          if (audit) {
            setAudit(null);
            return;
          }
          remoteApi.audit(100).then((r) => setAudit(r)).catch((e) => setErr(String(e && e.message || e)));
        }, children: audit ? t("audit.hide") : t("audit.show") })
      ] }),
      audit ? audit.auditEnabled === false ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("audit.disabled") }) : audit.lines && audit.lines.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-audit", children: audit.lines.join("\n") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dshr-caption", children: t("audit.empty") }) : null
    ] })
  ] });
}

// plugin-src/client/RemoteFlowPane.jsx
var React3 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
function RemoteFlowPane({ open, active, busy, onPicked, onCancel, onError, t }) {
  const [machines, setMachines] = React3.useState(null);
  const [machineId, setMachineId] = React3.useState("");
  const [connected, setConnected] = React3.useState(false);
  const [path, setPath] = React3.useState("");
  const [items, setItems] = React3.useState(null);
  const [platform, setPlatform] = React3.useState("");
  const [loading, setLoading] = React3.useState(false);
  const [loadingMachines, setLoadingMachines] = React3.useState(false);
  const [choosing, setChoosing] = React3.useState(false);
  const [err, setErr] = React3.useState("");
  const [mkdirOpen, setMkdirOpen] = React3.useState(false);
  const [mkdirName, setMkdirName] = React3.useState("");
  const loadedOnce = React3.useRef(false);
  const list = React3.useCallback((dir) => {
    setLoading(true);
    setErr("");
    remoteApi.ls(dir).then((res) => {
      setPlatform(res && res.platform === "windows" ? "windows" : "posix");
      setPath(res && res.path !== void 0 && res.path !== "" ? res.path : dir);
      const entries = Array.isArray(res && res.items) ? res.items : [];
      entries.sort((a, b) => {
        const ad = a.type === "dir" || a.drive ? 0 : 1;
        const bd = b.type === "dir" || b.drive ? 0 : 1;
        return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name));
      });
      setItems(entries);
      setConnected(true);
    }).catch((e) => {
      setConnected(false);
      setItems(null);
      setErr(t("picker.listFail", { error: String(e && e.message || e) }));
    }).finally(() => setLoading(false));
  }, [t]);
  const loadMachines = React3.useCallback(() => {
    setLoadingMachines(true);
    setErr("");
    remoteApi.machines().then((r) => {
      const list0 = r.machines || [];
      setMachines(list0);
      const initial = r.currentId || list0[0] && list0[0].id || "";
      setMachineId(initial);
      if (initial) {
        setLoading(true);
        return remoteApi.setCurrent(initial).then(() => list(""));
      }
    }).catch((e) => {
      setLoading(false);
      setErr(t("picker.loadFail", { error: String(e && e.message || e) }));
    }).finally(() => setLoadingMachines(false));
  }, [list, t]);
  React3.useEffect(() => {
    if (!open || !active || loadedOnce.current) return;
    loadedOnce.current = true;
    loadMachines();
  }, [open, active, loadMachines]);
  const selectMachine = (id) => {
    if (!id || id === machineId && items !== null) return;
    setMachineId(id);
    setItems(null);
    setPath("");
    setErr("");
    setConnected(false);
    setLoading(true);
    remoteApi.setCurrent(id).then(() => list("")).catch((e) => {
      setLoading(false);
      setErr(t("picker.listFail", { error: String(e && e.message || e) }));
    });
  };
  const enterDir = (it) => {
    if (busy || loading) return;
    list(it.path);
  };
  const goUp = () => {
    if (loading) return;
    const parent = parentRemotePath(path);
    list(parent || "");
  };
  const goHome = () => {
    if (loading) return;
    setLoading(true);
    setErr("");
    remoteApi.remoteHome().then((r) => {
      if (r && r.home) list(r.home);
      else {
        setErr(r && (r.hint || r.error) || "");
        setLoading(false);
      }
    }).catch((e) => {
      setErr(String(e && e.message || e));
      setLoading(false);
    });
  };
  const choose = () => {
    const target = String(path || "").trim();
    if (!target || busy || choosing) return;
    setChoosing(true);
    setErr("");
    remoteApi.pickWorkspace(target).then((res) => {
      if (res && res.localMirror) onPicked(res.localMirror);
      else {
        setErr(res && res.error || "");
        setChoosing(false);
      }
    }).catch((e) => {
      const text = String(e && e.message || e);
      setErr(text);
      if (typeof onError === "function") onError(text);
      setChoosing(false);
    });
  };
  const confirmMkdir = () => {
    const name2 = mkdirName.trim();
    if (!name2) return;
    const base = path || "/";
    const sep = base.includes("\\") ? "\\" : "/";
    const full = base === "/" ? "/" + name2 : base.replace(/[\\/]+$/, "") + sep + name2;
    setMkdirOpen(false);
    setMkdirName("");
    remoteApi.fs("mkdir", { path: full }).then(() => list(base)).catch((e) => setErr(String(e && e.message || e)));
  };
  const crumbs = remoteCrumbs(path);
  const machineOptions = (machines || []).map((m) => ({ id: m.id, label: `${m.name || m.host} (${m.username}@${m.host}:${m.port})` }));
  const rootLabel = platform === "windows" ? t("picker.rootPc") : "/";
  const pending = busy || loading || loadingMachines || choosing;
  const unavailable = pending || !machineId;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-flow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-flowContent", children: machines === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-flowStatus", children: err ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-error", role: "alert", children: err }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", onClick: loadMachines, disabled: pending, children: t("explorer.retry") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-caption", role: "status", children: t("picker.loading") }) }) : machines.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-emptyState", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("picker.machineEmpty") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshr-caption", children: t("picker.machineEmptyHint") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshr-formLabel", style: { textAlign: "left" }, children: t("picker.machine") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives3.SettingsSelect,
          {
            variant: "block",
            className: "dshr-grow",
            value: machineId,
            options: machineOptions,
            onChange: selectMachine,
            disabled: pending,
            "aria-label": t("picker.machine")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.StateDot, { state: connected ? "done" : loading ? "ongoing" : "idle" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives3.Input,
          {
            value: path,
            onChange: (e) => {
              setPath(e.target.value);
              setErr("");
            },
            placeholder: t("picker.pathPlaceholder"),
            disabled: unavailable,
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                list(path);
              }
            },
            className: "dshr-grow dshr-mono",
            "aria-label": t("picker.pathPlaceholder")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshr-iconBtn", title: t("picker.home"), "aria-label": t("picker.home"), onClick: goHome, disabled: unavailable, children: "~" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshr-iconBtn", title: t("picker.up"), "aria-label": t("picker.up"), onClick: goUp, disabled: unavailable || !path, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconChevronUpOutline14, {}) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshr-iconBtn", title: t("picker.refresh"), "aria-label": t("picker.refresh"), onClick: () => list(path), disabled: unavailable, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconRefreshOutline16, {}) })
      ] }),
      path ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-crumbs", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dshr-crumb", disabled: unavailable, onClick: () => list(""), children: rootLabel }),
        crumbs.parts && crumbs.parts.map((c, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(React3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: crumbs.sep === "\\" ? "\\" : "\u203A" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", disabled: unavailable, className: "dshr-crumb" + (i === crumbs.parts.length - 1 ? " dshr-crumbLast" : ""), onClick: () => list(c.path), children: c.name })
        ] }, c.path))
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-list", children: [
        loading && items === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-listEmpty", children: t("picker.loading") }) : null,
        !loading && items === null && err ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-flowStatus", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-error", role: "alert", children: err }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", onClick: () => selectMachine(machineId), disabled: unavailable, children: t("explorer.retry") })
        ] }) : null,
        items !== null && items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-listEmpty", children: t("picker.noDirs") }) : null,
        (items || []).map((it) => {
          const isDir = it.type === "dir" || !!it.drive;
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: "dshr-listItem",
              "data-kind": isDir ? "dir" : "file",
              onClick: () => {
                if (isDir) enterDir(it);
              },
              disabled: !isDir || unavailable,
              title: it.path || it.name,
              children: [
                isDir ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconFolderClose16, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.FileTypeIcon, { path: it.name, size: 14 }),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dshr-treeName", children: it.name })
              ]
            },
            it.path || it.name
          );
        })
      ] }),
      err && items !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-error", children: err }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dshr-caption", children: t("picker.mirrorHint") })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-flowFooter", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconPlusOutline16, { size: 14 }), onClick: () => {
        setMkdirName("");
        setMkdirOpen(true);
      }, disabled: unavailable || !path || !connected, children: t("picker.mkdir") }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dshr-flowActions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", onClick: onCancel, disabled: busy || choosing, children: t("form.cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", onClick: choose, disabled: unavailable || !path || !connected, children: choosing ? t("picker.choosing") : t("picker.choose") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      import_dsh_client_ui_primitives3.Modal,
      {
        open: mkdirOpen,
        onClose: () => setMkdirOpen(false),
        title: t("picker.mkdir"),
        closeLabel: t("common.close"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(React3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", onClick: () => setMkdirOpen(false), children: t("form.cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "primary", size: "sm", onClick: confirmMkdir, disabled: !mkdirName.trim(), children: t("picker.mkdir") })
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives3.Input,
          {
            value: mkdirName,
            onChange: (e) => setMkdirName(e.target.value),
            placeholder: t("picker.mkdirName"),
            autoFocus: true,
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmMkdir();
              }
            }
          }
        )
      }
    )
  ] });
}

// plugin-src/client/RemoteExplorerBody.jsx
var React4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
function RemoteExplorerBody({ useTabInfo, sessionId, useSessions, t }) {
  const info = useTabInfo();
  const cwd = useSessions((s) => s.byId && s.byId[sessionId] && s.byId[sessionId].cwd || "");
  const [root, setRoot] = React4.useState(null);
  const [mirrorDir, setMirrorDir] = React4.useState("");
  const [expanded, setExpanded] = React4.useState(() => /* @__PURE__ */ new Set());
  const [data, setData] = React4.useState({});
  const [err, setErr] = React4.useState("");
  const [menu, setMenu] = React4.useState(null);
  const [namePrompt, setNamePrompt] = React4.useState(null);
  const [nameDraft, setNameDraft] = React4.useState("");
  const [confirmDel, setConfirmDel] = React4.useState(null);
  const [copied, setCopied] = React4.useState("");
  const dataRef = React4.useRef(data);
  dataRef.current = data;
  const visible = info.tab.visible;
  const storeLevel = React4.useCallback((dir, level) => {
    setData((prev) => ({ ...prev, [dir]: level }));
  }, []);
  const loadDir = React4.useCallback((dir) => {
    const existing = dataRef.current[dir];
    if (existing && existing.loading) return;
    storeLevel(dir, { ...existing, loading: true });
    remoteApi.ls(dir, sessionId).then((res) => {
      const items = Array.isArray(res && res.items) ? res.items.slice() : [];
      items.sort((a, b) => {
        const ad = a.type === "dir" ? 0 : 1;
        const bd = b.type === "dir" ? 0 : 1;
        return ad !== bd ? ad - bd : String(a.name).localeCompare(String(b.name));
      });
      storeLevel(dir, { entries: items, missing: !!(res && res.missing) });
    }).catch((e) => {
      const prev = dataRef.current[dir];
      storeLevel(dir, prev && prev.entries ? { ...prev, softError: String(e && e.message || e) } : { error: String(e && e.message || e) });
    });
  }, [sessionId, storeLevel]);
  React4.useEffect(() => {
    let cancelled = false;
    setRoot(null);
    setData({});
    setExpanded(/* @__PURE__ */ new Set());
    setErr("");
    remoteApi.resolveMirror(cwd, sessionId).then((r) => {
      if (cancelled) return;
      const remotePath = r && r.remotePath || "";
      setRoot(remotePath);
      setMirrorDir(r && r.mirrorDir || "");
      if (remotePath) {
        setExpanded(/* @__PURE__ */ new Set([remotePath]));
        loadDir(remotePath);
      }
    }).catch((e) => {
      if (!cancelled) setErr(String(e && e.message || e));
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, sessionId, loadDir]);
  React4.useEffect(() => {
    if (visible && root) loadDir(root);
  }, [visible, root, loadDir]);
  const toggleDir = (dir) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        loadDir(dir);
      }
      return next;
    });
  };
  const openFile = (p) => {
    info.tab.actions.openResource(remoteFileAddress(sessionId, p));
  };
  const doFs = (op, payload) => {
    setErr("");
    return remoteApi.fs(op, payload, sessionId).then(() => {
      if (root) loadDir(parentRemotePath(payload.path || root) || root);
    }).catch((e) => setErr(String(e && e.message || e)));
  };
  const copyPath = (text, key) => {
    try {
      navigator.clipboard && navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => c === key ? "" : c), 1200);
    } catch {
    }
  };
  const relPath = (p) => root && p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]+/, "") : p;
  const confirmName = () => {
    const name2 = nameDraft.trim();
    if (!name2 || !namePrompt) return;
    const { kind, path: target } = namePrompt;
    setNamePrompt(null);
    if (kind === "rename") {
      const parent = parentRemotePath(target) || root || "/";
      const sep = parent.includes("\\") ? "\\" : "/";
      const dest = parent === "/" ? "/" + name2 : parent.replace(/[\\/]+$/, "") + sep + name2;
      doFs("rename", { path: target, dest });
    } else if (kind === "mkdir") {
      const sep = target.includes("\\") ? "\\" : "/";
      const full = target === "/" ? "/" + name2 : target.replace(/[\\/]+$/, "") + sep + name2;
      doFs("mkdir", { path: full });
    }
  };
  const menuItems = menu ? [
    { id: "open", label: menu.item.type === "dir" ? t("explorer.menuExpand") : t("explorer.menuOpen") },
    { id: "download", label: t("explorer.menuDownload") },
    { id: "copy-rel", label: t("explorer.menuCopyRel") },
    { id: "copy-abs", label: t("explorer.menuCopyAbs") },
    { type: "separator", id: "sep" },
    { id: "rename", label: t("explorer.menuRename") },
    { id: "mkdir", label: t("explorer.menuMkdir") },
    { type: "separator", id: "sep2" },
    { id: "delete", label: menu.item.type === "dir" ? t("explorer.menuDeleteDir") : t("explorer.menuDelete"), danger: true }
  ] : [];
  const onMenuSelect = (id) => {
    const it = menu && menu.item;
    if (!it) return;
    setMenu(null);
    if (id === "open") {
      if (it.type === "dir") toggleDir(it.path);
      else openFile(it.path);
    } else if (id === "download") void doFs("download", { path: it.path });
    else if (id === "copy-rel") copyPath(relPath(it.path), it.path);
    else if (id === "copy-abs") copyPath(it.path, it.path);
    else if (id === "rename") {
      setNamePrompt({ kind: "rename", path: it.path, name: it.name });
      setNameDraft(it.name);
    } else if (id === "mkdir") {
      const base = it.type === "dir" ? it.path : parentRemotePath(it.path) || root || "/";
      setNamePrompt({ kind: "mkdir", path: base, name: "" });
      setNameDraft("");
    } else if (id === "delete") {
      setConfirmDel({ path: it.path, dir: it.type === "dir" });
    }
  };
  const renderRows = (dir, depth) => {
    const level = data[dir];
    if (!level || !expanded.has(dir)) return null;
    if (level.loading && !level.entries) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dshr-listEmpty", style: { paddingLeft: 8 + depth * 14 }, children: t("explorer.loading") }, dir + ":loading");
    }
    if (level.error) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dshr-error", style: { padding: "4px 8px", paddingLeft: 8 + depth * 14 }, children: [
        level.error,
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => loadDir(dir), children: t("explorer.retry") })
      ] }, dir + ":err");
    }
    return (level.entries || []).map((it) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(React4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "button",
        {
          type: "button",
          className: "dshr-treeRow",
          "data-kind": it.type === "dir" ? "dir" : "file",
          style: { paddingLeft: 8 + depth * 14 },
          title: it.path,
          onClick: () => {
            if (it.type === "dir") toggleDir(it.path);
            else openFile(it.path);
          },
          onContextMenu: (e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, item: it });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-treeToggle", children: it.type === "dir" ? expanded.has(it.path) ? "\u25BE" : "\u25B8" : "" }),
            it.type === "dir" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.FileTypeIcon, { kind: "folder", size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.FileTypeIcon, { path: it.name, size: 14 }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-treeName", children: it.name }),
            copied === it.path ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-treeBadge", children: t("explorer.copied") }) : null
          ]
        }
      ),
      it.type === "dir" ? renderRows(it.path, depth + 1) : null
    ] }, it.path));
  };
  if (root === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dshr-listEmpty", children: t("explorer.loading") });
  }
  if (root === "") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dshr-emptyState", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("explorer.empty") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-caption", children: t("explorer.emptyHint") })
    ] });
  }
  const rootLevel = data[root];
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dshr-tree", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dshr-row", style: { padding: "4px 6px", borderBottom: "1px solid var(--dsw-alias-border-l2)", marginBottom: 4 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.StateDot, { state: rootLevel && rootLevel.entries ? "done" : "ongoing", size: 8 }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-mono dshr-ellipsis dshr-secondary", style: { fontSize: 12 }, title: mirrorDir ? `${root}
${mirrorDir}` : root, children: root }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "dshr-iconBtn", title: t("picker.refresh"), "aria-label": t("picker.refresh"), onClick: () => {
        setData({});
        loadDir(root);
      }, children: "\u27F3" })
    ] }),
    err ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dshr-error", style: { padding: "4px 6px" }, children: err }) : null,
    rootLevel && rootLevel.missing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dshr-caption", style: { padding: "4px 6px" }, children: t("explorer.missing") }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "button",
      {
        type: "button",
        className: "dshr-treeRow",
        style: { paddingLeft: 8 },
        onClick: () => toggleDir(root),
        onContextMenu: (e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, item: { type: "dir", path: root, name: root } });
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-treeToggle", children: expanded.has(root) ? "\u25BE" : "\u25B8" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.FileTypeIcon, { kind: "folder", size: 14 }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dshr-treeName", style: { fontWeight: 600 }, children: t("explorer.root") })
        ]
      }
    ),
    expanded.has(root) ? renderRows(root, 1) : null,
    rootLevel && rootLevel.entries && rootLevel.entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dshr-listEmpty", children: t("picker.empty") }) : null,
    menu ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      import_dsh_client_ui_primitives4.Menu,
      {
        open: true,
        anchor: null,
        items: menuItems,
        onClose: () => setMenu(null),
        onSelect: onMenuSelect,
        getAnchorRect: () => new DOMRect(menu.x, menu.y, 0, 0),
        portal: true
      }
    ) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      import_dsh_client_ui_primitives4.Modal,
      {
        open: !!namePrompt,
        onClose: () => setNamePrompt(null),
        title: namePrompt && namePrompt.kind === "rename" ? t("explorer.menuRename") : t("explorer.menuMkdir"),
        closeLabel: t("common.close"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(React4.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => setNamePrompt(null), children: t("form.cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "primary", size: "sm", onClick: confirmName, disabled: !nameDraft.trim(), children: t("form.save") })
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          import_dsh_client_ui_primitives4.Input,
          {
            value: nameDraft,
            onChange: (e) => setNameDraft(e.target.value),
            placeholder: t("explorer.newName"),
            autoFocus: true,
            onKeyDown: (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmName();
              }
            }
          }
        )
      }
    )
  ] });
}

// plugin-src/client/RemoteExplorerTitle.jsx
var React5 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime5 = require("react/jsx-runtime");
function RemoteExplorerTitle({ useTabInfo }) {
  const { tab } = useTabInfo();
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(React5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.FileTypeIcon, { kind: "folder", size: 16 }),
    tab.title
  ] });
}

// plugin-src/client/RemoteFileBody.jsx
var React6 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime6 = require("react/jsx-runtime");
var MAX_BYTES = 256 * 1024;
function RemoteFileBody({ useTabInfo, t }) {
  const info = useTabInfo();
  const target = React6.useMemo(() => {
    try {
      return remoteFileTarget(info.tab.navigation.address);
    } catch {
      return { sessionId: "", path: "" };
    }
  }, [info.tab.navigation.address]);
  const { sessionId, path } = target;
  const [data, setData] = React6.useState(null);
  const [err, setErr] = React6.useState("");
  const [notice, setNotice] = React6.useState("");
  const [loading, setLoading] = React6.useState(true);
  const [edit, setEdit] = React6.useState(false);
  const [draft, setDraft] = React6.useState("");
  const [saving, setSaving] = React6.useState(false);
  const originalText = (data && data.content != null ? String(data.content) : "").replace(/\n…\[truncated:.*$/, "");
  const dirty = edit && draft !== originalText;
  const load = React6.useCallback(() => {
    if (!path) {
      setLoading(false);
      return void 0;
    }
    let cancelled = false;
    setLoading(true);
    setErr("");
    setNotice("");
    setData(null);
    setEdit(false);
    remoteApi.read(path, MAX_BYTES, sessionId).then((d) => {
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    }).catch((e) => {
      if (!cancelled) {
        setErr(t("file.readFail", { msg: String(e && e.message || e) }));
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [path, sessionId, t]);
  React6.useEffect(load, [load]);
  const startEdit = () => {
    if (!data || data.binary) return;
    setDraft(originalText);
    setEdit(true);
    setErr("");
  };
  const save = () => {
    if (saving) return;
    setSaving(true);
    setErr("");
    remoteApi.write(path, draft, data && data.mtime, sessionId).then((r) => {
      if (r.status === 409) {
        setErr(r.data && r.data.error || t("file.conflict"));
        return;
      }
      if (r.status >= 400) throw new Error(r.data && (r.data.error || r.data.message) || "HTTP " + r.status);
      setEdit(false);
      load();
    }).catch((e) => setErr(String(e && e.message || e))).finally(() => setSaving(false));
  };
  const download = () => {
    setSaving(true);
    setErr("");
    setNotice("");
    remoteApi.fs("download", { path }, sessionId).then((r) => setNotice(t("file.downloaded", { path: r && r.local ? t("file.downloadedAt", { path: r.local }) : "" }))).catch((e) => setErr(String(e && e.message || e))).finally(() => setSaving(false));
  };
  const baseName = path.split(/[\\/]/).pop() || path;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dshr-editor", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dshr-editorHead", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.FileTypeIcon, { path: baseName, size: 14 }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dshr-mono dshr-ellipsis dshr-secondary", title: path, children: path }),
      dirty ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Tag, { tone: "outline", children: t("file.dirty") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dshr-caption", style: { flexShrink: 0 }, children: edit ? t("file.editing") : t("file.readonly") }),
      edit ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(React6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "primary", size: "sm", onClick: save, disabled: saving || !dirty, title: t("file.saveHint"), children: saving ? t("file.saving") : t("file.saveToRemote") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", onClick: () => {
          setEdit(false);
          setErr("");
        }, children: t("file.cancel") })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(React6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", onClick: startEdit, disabled: !data || !!data.binary, children: t("file.edit") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", onClick: download, disabled: saving, children: t("file.download") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dshr-editorBody", children: [
      err ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dshr-error", style: { padding: "8px 12px", flexShrink: 0 }, children: err }) : null,
      notice ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dshr-ok", style: { padding: "8px 12px", flexShrink: 0 }, children: notice }) : null,
      loading ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dshr-muted", style: { padding: 12, fontSize: 13 }, children: t("file.loading") }) : data && data.binary ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dshr-muted", style: { padding: 12, fontSize: 13 }, children: t("file.binary", { size: data.size != null ? `${data.size} bytes` : t("file.unknownSize") }) }) : edit ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "textarea",
        {
          className: "dshr-editorText",
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (!saving && dirty) save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setEdit(false);
              setErr("");
            }
          },
          spellCheck: false
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dshr-editorView", children: [
        data && data.content != null ? data.content : t("file.empty"),
        data && data.truncated ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dshr-caption dshr-warn", style: { marginTop: 8 }, children: t("file.truncated") }) : null
      ] })
    ] })
  ] });
}

// plugin-src/client/RemoteFileTitle.jsx
var React7 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime7 = require("react/jsx-runtime");
function RemoteFileTitle({ useTabInfo }) {
  const { tab } = useTabInfo();
  let name2 = "";
  try {
    name2 = remoteFileTarget(tab.navigation.address).path.split(/[\\/]/).pop() || "";
  } catch {
  }
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(React7.Fragment, { children: [
    name2 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.FileTypeIcon, { path: name2, size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.FileTypeIcon, { kind: "other", size: 16 }),
    tab.title
  ] });
}

// plugin-src/client/index.js
var name = "dsh-remote";
var inject = ["slots", "locale"];
var REMOTE_EXPLORER_ID = "dsh-remote/explorer";
var REMOTE_FILE_ID = "dsh-remote/file";
var REMOTE_FLOW_SLOTS = [
  "conversation.hero.workspace.directoryFlow.remote",
  "sidebar.workspaces.directoryFlow.remote"
];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-remote: dictionaries");
  ctx.effect(installRemoteStyles, "dsh-remote: styles");
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "remote-workspace",
    order: 45,
    label: () => t("settings.nav"),
    locale: NS
  }, RemoteSettingsSection)), "dsh-remote: settings section");
  for (const key of REMOTE_FLOW_SLOTS) {
    ctx.effect(() => ctx.slots.inject(key, () => ctx.slots.register(
      { name: key, locale: NS },
      RemoteFlowPane
    )), "dsh-remote: remote flow " + key);
  }
  ctx.inject(["sidebarRightTabs"], (inner) => {
    const tabs = inner.get("sidebarRightTabs");
    const slots = inner.get("slots");
    inner.effect(() => tabs.register({
      id: REMOTE_EXPLORER_ID,
      kind: REMOTE_EXPLORER_ID,
      title: () => t("explorer.tabTitle"),
      guide: [{ id: "remote", order: 55, title: () => t("explorer.tabTitle") }]
    }), "dsh-remote: explorer tab type");
    inner.effect(() => tabs.register({
      id: REMOTE_FILE_ID,
      kind: REMOTE_FILE_ID,
      patterns: ["dsh-resource://dsh-remote/**"],
      title: (address) => {
        try {
          return remoteFileTarget(address).path.split(/[\\/]/).pop() || t("explorer.tabTitle");
        } catch {
          return t("explorer.tabTitle");
        }
      }
    }), "dsh-remote: file tab type");
    inner.effect(() => slots.inject("sidebar.right.pane.tab", () => {
      const disposers = [
        slots.register({ name: "sidebar.right.pane.tab", key: REMOTE_EXPLORER_ID, locale: NS }, RemoteExplorerBody),
        slots.register({ name: "sidebar.right.pane.tab", key: REMOTE_FILE_ID, locale: NS }, RemoteFileBody)
      ];
      return () => disposers.forEach((dispose) => dispose());
    }), "dsh-remote: sidebar tab bodies");
    inner.effect(() => slots.inject("sidebar.right.pane.tab.title", () => {
      const disposers = [
        slots.register({ name: "sidebar.right.pane.tab.title", key: REMOTE_EXPLORER_ID }, RemoteExplorerTitle),
        slots.register({ name: "sidebar.right.pane.tab.title", key: REMOTE_FILE_ID }, RemoteFileTitle)
      ];
      return () => disposers.forEach((dispose) => dispose());
    }), "dsh-remote: sidebar tab titles");
  });
}

    return module.exports;
  }
});
