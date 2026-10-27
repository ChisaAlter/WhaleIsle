// dsh-usage-panel · Client bundle (web plugin `./client` export)
// Built from src/client via esbuild + scripts/wrap-client.mjs. Registers the
// settings page "用量统计 / Usage stats" (settings.section) with KPI cards, activity
// heatmap, stacked daily bars, model donut, session ranking, provider
// breakdown and CSV/JSON export. Data arrives over the package's own RPC
// channel /usage-stats (loopback authority).
window.__ModuleLoader__.load({
  id: 'dsh-usage-panel',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
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
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_react11 = require("react");
    var uiPrimitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);

    // src/client/locales.ts
    var NS = "usage-panel";
    var zhCN = {
      "nav.label": "\u7528\u91CF\u4E0E\u8D39\u7528",
      "nav.subtitle": "\u53EA\u8BFB\u91CD\u7B97\u4F1A\u8BDD\u65E5\u5FD7 \xB7 \u6C38\u4E0D\u5199\u56DE",
      "kpi.total": "Token \u603B\u7528\u91CF",
      "kpi.total.detail": "\u8F93\u5165 {input} \xB7 \u8F93\u51FA {output} \xB7 \u7F13\u5B58\u8BFB {cacheRead}",
      "kpi.sessions": "\u603B\u4F1A\u8BDD\u6570\u91CF",
      "kpi.sessions.detail": "\u603B\u4F1A\u8BDD {total} \xB7 \u6709\u7528\u91CF\u4F1A\u8BDD\uFF1A\u4E3B {main} \xB7 \u5B50\u4EE3\u7406 {subagent}",
      "kpi.topModel": "\u6700\u5E38\u7528\u6A21\u578B",
      "kpi.topModel.detail": "\u5360\u6BD4 {pct}%",
      "kpi.hitRate": "\u7F13\u5B58\u547D\u4E2D\u7387",
      "kpi.hitRate.detail": "\u8BFB {read} \xB7 \u5199 {write}",
      "kpi.hitRate.none": "\u6682\u65E0\u7F13\u5B58\u6570\u636E",
      "kpi.cost": "\u8D39\u7528\u5408\u8BA1(\u4F30\u7B97)",
      "kpi.cost.detail": "\u5CF0\u6BB5 {peak} \xB7 \u8C37\u6BB5 {idle}",
      "kpi.cost.none": "\u6682\u65E0\u5DF2\u5B9A\u4EF7\u6A21\u578B",
      "sessions.cost.none": "\u8BE5\u4F1A\u8BDD\u6A21\u578B\u672A\u5B9A\u4EF7",
      "heat.title": "\u6D3B\u8DC3\u70ED\u529B\u56FE",
      "heat.sub.fallback": "\u6700\u8FD1 182 \u5929 \xB7 UTC",
      "heat.window": "{tokens} Tokens \xB7 \u6D3B\u8DC3 {active} \u5929",
      "heat.range": "{range}\uFF1A{tokens} Tokens \xB7 \u6D3B\u8DC3 {active}/{total} \u5929",
      "heat.clear": "\u6E05\u9664\u9009\u62E9",
      "heat.hint": "\u5355\u51FB\u9009\u4E2D\u65E5\u671F\uFF0CShift+\u5355\u51FB\u6269\u5C55\u8303\u56F4",
      "heat.less": "\u5C11",
      "heat.more": "\u591A",
      "heat.day": "{date} \xB7 {tokens} Tokens",
      "heat.cost": "\u5F53\u65E5\u8D39\u7528\u5408\u8BA1",
      "heat.costNone": "\u672A\u5B9A\u4EF7",
      "bar.title": "\u6BCF\u65E5 Token \u7528\u91CF",
      "bar.sub": "\u6309\u6A21\u578B\u5806\u53E0",
      "bar.day": "{date} \xB7 \u5171 {tokens} Tokens",
      "donut.title": "\u6A21\u578B\u7528\u91CF",
      "donut.model": "\u6A21\u578B",
      "donut.tokens": "\u7528\u91CF",
      "donut.cap": "Token \u603B\u7528\u91CF",
      "donut.other": "\u5176\u4ED6",
      "donut.share": "\u5360\u6BD4",
      "donut.hitRate": "\u547D\u4E2D\u7387",
      "sessions.title": "\u4F1A\u8BDD\u7528\u91CF\u6392\u884C",
      "sessions.sub": "\u6309\u5168\u90E8\u5386\u53F2\u7528\u91CF",
      "sessions.untitled": "\u672A\u547D\u540D\u4F1A\u8BDD",
      "sessions.main": "\u4E3B\u4F1A\u8BDD",
      "sessions.subagent": "\u5B50\u4EE3\u7406",
      "sessions.tokens": "{tokens} Tokens",
      "sessions.lastActive": "\u6700\u8FD1\u6D3B\u8DC3 {date}",
      "sessions.hSession": "\u4F1A\u8BDD",
      "sessions.hType": "\u7C7B\u578B",
      "sessions.hActive": "\u6700\u8FD1\u6D3B\u8DC3",
      "sessions.hCost": "\u8D39\u7528",
      "sessions.hTokens": "Token \u7528\u91CF",
      "sessions.more": "\u663E\u793A\u66F4\u591A\u2026",
      "sessions.moreLoading": "\u52A0\u8F7D\u4E2D\u2026",
      "sort.by": "\u6309",
      "sort.tokens": "Token \u6392\u5E8F",
      "sort.cost": "\u8D39\u7528\u6392\u5E8F",
      "projects.title": "\u9879\u76EE\u7528\u91CF\u6392\u884C",
      "projects.sub": "\u6309\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u805A\u5408",
      "projects.hProject": "\u9879\u76EE",
      "projects.hCost": "\u8D39\u7528\u5408\u8BA1",
      "projects.hTokens": "Token \u7528\u91CF",
      "projects.empty": "\u6682\u65E0\u9879\u76EE\u7528\u91CF\u6570\u636E",
      "projects.loading": "\u6B63\u5728\u52A0\u8F7D\u9879\u76EE\u7528\u91CF\u2026",
      "providers.title": "\u670D\u52A1\u5546\u7528\u91CF",
      "export.button": "\u5BFC\u51FA",
      "export.json": "\u5BFC\u51FA JSON",
      "export.daily": "\u5BFC\u51FA\u6BCF\u65E5 CSV",
      "export.models": "\u5BFC\u51FA\u6A21\u578B CSV",
      "export.file.daily": "dsh-usage-panel-daily.csv",
      "export.file.models": "dsh-usage-panel-models.csv",
      "export.file.json": "dsh-usage-panel-overview.json",
      "export.failed": "\u5BFC\u51FA\u5931\u8D25\uFF1A{msg}",
      "refresh.button": "\u5237\u65B0",
      "refresh.loading": "\u5237\u65B0\u4E2D\u2026",
      "refresh.title": "\u91CD\u65B0\u62C9\u53D6\u6700\u65B0\u7EDF\u8BA1",
      "status.loading": "\u6B63\u5728\u7EDF\u8BA1\u4F1A\u8BDD\u65E5\u5FD7\u2026",
      "status.loading.hint": "\u9996\u6B21\u6253\u5F00\u6216\u5237\u65B0\u65F6\u8BFB\u53D6\u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u5386\u53F2\u8F83\u591A\u65F6\u53EF\u80FD\u9700\u8981\u4E00\u4E9B\u65F6\u95F4",
      "status.fresh": "\u6570\u636E\u66F4\u65B0\u4E8E {time} \xB7 UTC",
      "status.stale": "\u6570\u636E\u66F4\u65B0\u4E8E {time} \xB7 \u540E\u53F0\u66F4\u65B0\u4E2D\u2026",
      "status.fallback": "\u663E\u793A\u7F13\u5B58\u6570\u636E\uFF08\u66F4\u65B0\u5931\u8D25\u4E8E {time}\uFF09",
      "status.error": "\u52A0\u8F7D\u5931\u8D25\uFF1A{msg}",
      "status.repair": "\u4FEE\u590D",
      "status.repairLoading": "\u4FEE\u590D\u4E2D\u2026",
      "status.repairHint": "{count} \u4E2A\u4F1A\u8BDD\u65E5\u5FD7\u8BFB\u53D6\u5931\u8D25",
      "status.repairDone": "\u5DF2\u4FEE\u590D\u5E76\u6062\u590D {count} \u6761\u4E8B\u4EF6\uFF08\u539F\u4EF6\u5DF2\u5907\u4EFD\uFF09",
      "status.repairRefreshFailed": "\u5DF2\u4FEE\u590D\u5E76\u6062\u590D {count} \u6761\u4E8B\u4EF6\uFF08\u539F\u4EF6\u5DF2\u5907\u4EFD\uFF09\uFF1B\u7EDF\u8BA1\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5",
      "status.repairStill": "\u4FEE\u590D\u5DF2\u751F\u6548(\u6587\u4EF6\u5DF2\u91CD\u5199);\u82E5\u63D0\u793A\u4ECD\u663E\u793A,\u8BF7\u91CD\u542F dsh \u6E05\u9664\u5BBF\u4E3B\u5185\u5B58\u72B6\u6001",
      "status.repairFailed": "\u4FEE\u590D\u5931\u8D25\uFF1A{msg}",
      "source.magpie": "\u603B\u8BA1\u53E3\u5F84\uFF1AMagpie \u7F51\u5173\u7528\u91CF\uFF08{calls} \u6B21\u8C03\u7528 \xB7 {from} \u2013 {to} UTC\uFF09\xB7 \u8F93\u5165+\u8F93\u51FA",
      "source.logs": "\u603B\u8BA1\u53E3\u5F84\uFF1A\u4F1A\u8BDD\u65E5\u5FD7\uFF08\u8F93\u5165+\u8F93\u51FA\uFF0Cfork \u7EE7\u627F\u524D\u7F00\u5DF2\u53BB\u91CD\uFF09",
      "empty.title": "\u6682\u65E0\u7EDF\u8BA1\u6570\u636E",
      "empty.hint": "\u5F00\u59CB\u4F7F\u7528 DeepSeek Harness \u540E\uFF0C\u8FD9\u91CC\u4F1A\u5C55\u793A Token \u6D88\u8017\u60C5\u51B5",
      "error.title": "\u7EDF\u8BA1\u9762\u677F\u5D29\u6E83\u4E86",
      "error.reset": "\u6E05\u7A7A\u7F13\u5B58\u5E76\u91CD\u8BD5",
      "error.detail": "\u9519\u8BEF\u4FE1\u606F\uFF1A{msg}",
      "unit.tokens": "{n} Tokens",
      "date.today": "\u4ECA\u5929",
      "strip.estimate": "\u4F30\u7B97\u8D39\u7528\uFF0C\u975E\u8D26\u5355",
      "billing.button": "\u8BBE\u7F6E",
      "billing.title": "\u8BA1\u8D39\u8BBE\u7F6E",
      "billing.loading": "\u6B63\u5728\u52A0\u8F7D\u8BA1\u8D39\u8BBE\u7F6E\u2026",
      "billing.close": "\u5173\u95ED",
      "billing.save": "\u4FDD\u5B58",
      "billing.saving": "\u4FDD\u5B58\u4E2D\u2026",
      "billing.idleToggleNote": "\u5F00\u542F\uFF1A\u9AD8\u5CF0\u4E0E\u7A7A\u95F2\u4E24\u884C\u5206\u522B\u8BA1\u4EF7;\u5173\u95ED\uFF1A\u53EA\u586B\u4E00\u4E2A\u4EF7\u683C\uFF0C\u4E24\u65F6\u6BB5\u90FD\u6309\u5B83\u8BA1\u8D39",
      // Inserted next to the switch note it describes (peak row + single price row).
      "billing.periodSingle": "\u4EF7\u683C",
      "billing.peakValleyLabel": "\u5CF0\u8C37\u8BA1\u4EF7\uFF08\u6309\u9AD8\u5CF0/\u8C37\u6BB5\u5206\u522B\u8BA1\u8D39\uFF09",
      "billing.peakHint": "\u5355\u4F4D\uFF1A\xA5 / \u767E\u4E07 tokens\uFF1B\u7A7A\u95F2\u4EF7\u9ED8\u8BA4 = \u9AD8\u5CF0\u4EF7\u7684\u4E00\u534A",
      // With 峰谷计价 OFF the entered price is written into BOTH columns, so the
      // note may state plainly that both periods bill it.
      "billing.flatHint": "\u5CF0\u8C37\u8BA1\u4EF7\u5DF2\u5173\u95ED\uFF1A\u4E24\u65F6\u6BB5\u5747\u6309\u6240\u586B\u4EF7\u683C\u8BA1\u8D39\uFF08\u4FDD\u5B58\u540E\u9AD8\u5CF0\u4E0E\u7A7A\u95F2\u4E24\u5217\u540C\u4EF7\uFF09",
      "billing.modelsNone": "\u6682\u65E0\u53EF\u7528\u6A21\u578B\uFF08provider \u76EE\u5F55\u4E3A\u7A7A\uFF09",
      "billing.modelsTitle": "\u6A21\u578B\u9009\u62E9",
      "billing.providerLabel": "\u4F9B\u5E94\u5546",
      "billing.modelLabel": "\u6A21\u578B",
      "billing.commit": "\u6DFB\u52A0/\u66F4\u65B0",
      "billing.updated": "\u5DF2\u66F4\u65B0\uFF1A{model}",
      "billing.configuredTitle": "\u5DF2\u914D\u7F6E\u4EF7\u683C",
      "billing.badgeOfficial": "\u5B98\u65B9",
      "billing.badgeCustom": "\u81EA\u5B9A\u4E49",
      "billing.edit": "\u7F16\u8F91",
      "billing.remove": "\u5220\u9664",
      "billing.err.pickModel": "\u8BF7\u5148\u9009\u62E9\u6A21\u578B",
      "billing.filterPlaceholder": "\u641C\u7D22\u6A21\u578B\u2026",
      "billing.filterNone": "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B",
      "billing.editorTitle": "\u4EF7\u683C\u8F93\u5165",
      "billing.defaultHint": "\u9ED8\u8BA4\u91C7\u7528\u5B98\u65B9\u4EF7\u683C\uFF1B\u5982\u4E0E\u5B9E\u9645\u4E0D\u7B26\u53EF\u4FEE\u6539\u540E\u4FDD\u5B58\uFF08\u5C06\u8986\u76D6\u4E3A\u81EA\u5B9A\u4E49\u4EF7\uFF09",
      "billing.unknownHint": "\u8BE5\u6A21\u578B\u65E0\u5B98\u65B9\u4EF7\uFF0C\u8BF7\u81EA\u884C\u8BBE\u7F6E\u4EF7\u683C\uFF08\u4FDD\u5B58\u540E\u6309\u6B64\u4EF7\u8BA1\u8D39\uFF09",
      "billing.editorEmpty": "\u5148\u4ECE\u4E0A\u65B9\u9009\u62E9\u8981\u8BBE\u7F6E\u4EF7\u683C\u7684\u6A21\u578B",
      "billing.hit": "\u7F13\u5B58\u547D\u4E2D",
      "billing.miss": "\u672A\u547D\u4E2D",
      "billing.out": "\u8F93\u51FA",
      "billing.flat": "\u8BE5\u6A21\u578B\u5173\u95ED\u5CF0\u8C37\u8BA1\u4EF7",
      "billing.flatShort": "\u5173\u95ED\u5CF0\u8C37",
      "billing.idle": "\u663E\u5F0F\u7A7A\u95F2\u4EF7",
      "billing.idleShort": "\u7A7A\u95F2\u4EF7",
      "billing.idleToggle": "\u5CF0\u8C37\u8BA1\u4EF7",
      "billing.periodPeak": "\u9AD8\u5CF0\u4EF7\u683C",
      "billing.periodIdle": "\u7A7A\u95F2\u4EF7\u683C",
      "billing.addModel": "\u6DFB\u52A0",
      "billing.addModelPlaceholder": "\u624B\u52A8\u8F93\u5165\u6A21\u578B ID",
      "billing.saveError": "\u4FDD\u5B58\u5931\u8D25\uFF1A{msg}",
      "billing.loadError": "\u8BBE\u7F6E\u52A0\u8F7D\u5931\u8D25\uFF1A{msg}",
      "billing.retry": "\u91CD\u8BD5",
      "billing.err.invalidPrice": "\u300C{key}\u300D\u4EF7\u683C\u65E0\u6548\uFF1A\u4E09\u4E2A\u4EF7\u683C\u90FD\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57",
      "billing.err.invalidIdle": "\u300C{key}\u300D\u7A7A\u95F2\u4EF7\u65E0\u6548\uFF1A\u4E09\u4E2A\u4EF7\u683C\u90FD\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57",
      "billing.err.invalidSingle": "\u300C{key}\u300D\u4EF7\u683C\u65E0\u6548\uFF1A\u4E09\u4E2A\u4EF7\u683C\u90FD\u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57"
    };
    var enUS = {
      "nav.label": "Usage & costs",
      "nav.subtitle": "Read-only session log stats \xB7 never writes back",
      "kpi.total": "Total tokens",
      "kpi.total.detail": "In {input} \xB7 Out {output} \xB7 Cache read {cacheRead}",
      "kpi.sessions": "Sessions",
      "kpi.sessions.detail": "Total {total} \xB7 with usage: main {main} \xB7 subagent {subagent}",
      "kpi.topModel": "Top model",
      "kpi.topModel.detail": "Share {pct}%",
      "kpi.hitRate": "Cache hit rate",
      "kpi.hitRate.detail": "Read {read} \xB7 Write {write}",
      "kpi.hitRate.none": "No cache data yet",
      "kpi.cost": "Estimated cost",
      "kpi.cost.detail": "Peak {peak} \xB7 Off-peak {idle}",
      "kpi.cost.none": "No priced models yet",
      "sessions.cost.none": "This session has unpriced models",
      "heat.title": "Activity heatmap",
      "heat.sub.fallback": "Last 182 days \xB7 UTC",
      "heat.window": "{tokens} tokens \xB7 {active} active days",
      "heat.range": "{range}: {tokens} tokens \xB7 {active}/{total} active days",
      "heat.clear": "Clear selection",
      "heat.hint": "Click a day \xB7 Shift+click for a range",
      "heat.less": "Less",
      "heat.more": "More",
      "heat.day": "{date} \xB7 {tokens} tokens",
      "heat.cost": "Day cost",
      "heat.costNone": "Not priced",
      "bar.title": "Daily token usage",
      "bar.sub": "Stacked by model",
      "bar.day": "{date} \xB7 {tokens} tokens total",
      "donut.title": "Model usage",
      "donut.model": "Model",
      "donut.tokens": "Tokens",
      "donut.cap": "Total tokens",
      "donut.other": "Other",
      "donut.share": "Share",
      "donut.hitRate": "Hit rate",
      "sessions.title": "Top sessions",
      "sessions.sub": "By all-time usage",
      "sessions.untitled": "Untitled session",
      "sessions.main": "Main",
      "sessions.subagent": "Subagent",
      "sessions.tokens": "{tokens} tokens",
      "sessions.lastActive": "Active {date}",
      "sessions.hSession": "Session",
      "sessions.hType": "Type",
      "sessions.hActive": "Last active",
      "sessions.hCost": "Cost",
      "sessions.hTokens": "Tokens",
      "sessions.more": "Show more\u2026",
      "sessions.moreLoading": "Loading\u2026",
      "sort.by": "Sort by",
      "sort.tokens": "Tokens",
      "sort.cost": "Cost",
      "projects.title": "Project usage",
      "projects.sub": "Grouped by session working directory",
      "projects.hProject": "Project",
      "projects.hCost": "Cost",
      "projects.hTokens": "Tokens",
      "projects.empty": "No project usage yet",
      "projects.loading": "Loading project usage\u2026",
      "providers.title": "Providers",
      "export.button": "Export",
      "export.json": "Export JSON",
      "export.daily": "Export daily CSV",
      "export.models": "Export model CSV",
      "export.file.daily": "dsh-usage-panel-daily.csv",
      "export.file.models": "dsh-usage-panel-models.csv",
      "export.file.json": "dsh-usage-panel-overview.json",
      "export.failed": "Export failed: {msg}",
      "refresh.button": "Refresh",
      "refresh.loading": "Refreshing\u2026",
      "refresh.title": "Fetch the latest statistics",
      "status.loading": "Scanning session logs\u2026",
      "status.loading.hint": "Opening or refreshing reads session logs; a large history can take some time",
      "status.fresh": "Updated at {time} \xB7 UTC",
      "status.stale": "Updated at {time} \xB7 refreshing in background\u2026",
      "status.fallback": "Showing cached data (last refresh failed at {time})",
      "status.error": "Failed to load: {msg}",
      "status.repair": "Repair",
      "status.repairLoading": "Repairing\u2026",
      "status.repairHint": "{count} session log(s) failed to read",
      "status.repairDone": "Repaired and restored {count} events (original backed up)",
      "status.repairRefreshFailed": "Repaired and restored {count} events (original backed up); statistics failed to refresh. Please refresh again.",
      "status.repairStill": "Repair is durable; if the hint persists, restart dsh to clear host in-memory state",
      "status.repairFailed": "Repair failed: {msg}",
      "source.magpie": "Totals: Magpie gateway ledger ({calls} calls \xB7 {from} \u2013 {to} UTC) \xB7 input + output",
      "source.logs": "Totals: session logs (input + output, fork prefix excluded)",
      "empty.title": "No statistics yet",
      "empty.hint": "Start using DeepSeek Harness and token usage will show up here",
      "error.title": "The usage panel crashed",
      "error.reset": "Clear cache and retry",
      "error.detail": "Error: {msg}",
      "unit.tokens": "{n} tokens",
      "date.today": "Today",
      "strip.estimate": "Estimate, not a bill",
      "billing.button": "Settings",
      "billing.title": "Billing settings",
      "billing.loading": "Loading billing settings\u2026",
      "billing.close": "Close",
      "billing.save": "Save",
      "billing.saving": "Saving\u2026",
      "billing.idleToggleNote": "On: peak and off-peak rows bill separately; off: one price bills both periods",
      // Inserted next to the switch note it describes (peak row + single price row).
      "billing.periodSingle": "Price",
      "billing.peakValleyLabel": "Peak/valley pricing (period-based billing)",
      "billing.peakHint": "Unit: CNY / million tokens; off-peak defaults to half of the peak price",
      // With 峰谷计价 OFF the entered price is written into BOTH columns, so the
      // note may state plainly that both periods bill it.
      "billing.flatHint": "Peak/valley pricing off: both periods bill the entered price (peak and off-peak columns are saved equal)",
      "billing.modelsNone": "No models available (empty provider directory)",
      "billing.modelsTitle": "Model selection",
      "billing.providerLabel": "Provider",
      "billing.modelLabel": "Model",
      "billing.commit": "Add / update",
      "billing.updated": "Updated: {model}",
      "billing.configuredTitle": "Configured prices",
      "billing.badgeOfficial": "Official",
      "billing.badgeCustom": "Custom",
      "billing.edit": "Edit",
      "billing.remove": "Remove",
      "billing.err.pickModel": "Pick a model first",
      "billing.filterPlaceholder": "Filter models\u2026",
      "billing.filterNone": "No matching models",
      "billing.editorTitle": "Price editor",
      "billing.defaultHint": "Defaults to the official price; edit and save to override",
      "billing.unknownHint": "No official price for this model \u2014 set your own (saved as custom)",
      "billing.editorEmpty": "Pick a model above to set its price",
      "billing.hit": "Cache hit",
      "billing.miss": "Cache miss",
      "billing.out": "Output",
      "billing.flat": "Disable peak/valley for this model",
      "billing.flatShort": "Flat",
      "billing.idleToggle": "Peak/valley",
      "billing.periodPeak": "Peak prices",
      "billing.periodIdle": "Off-peak prices",
      "billing.idle": "Explicit off-peak price",
      "billing.idleShort": "Off-peak",
      "billing.addModel": "Add",
      "billing.addModelPlaceholder": "Type a model id",
      "billing.saveError": "Save failed: {msg}",
      "billing.loadError": "Settings failed to load: {msg}",
      "billing.retry": "Retry",
      "billing.err.invalidPrice": 'Invalid price for "{key}": all three prices must be non-negative numbers',
      "billing.err.invalidIdle": 'Invalid off-peak price for "{key}": all three prices must be non-negative numbers',
      "billing.err.invalidSingle": 'Invalid price for "{key}": all three prices must be non-negative numbers'
    };
    function interpolate(text, params) {
      if (!params) return text;
      return text.replace(/\{(\w+)\}/g, (_, name) => {
        const v = params[name];
        return v === void 0 ? "{" + name + "}" : String(v);
      });
    }
    var DICTS = { "zh-CN": zhCN, "en-US": enUS };
    function lookup(locale, key) {
      const dict = DICTS[locale];
      if (dict && dict[key]) return dict[key];
      return DICTS["zh-CN"][key] || key;
    }
    function createI18n(runtime) {
      if (!runtime) {
        return {
          t: (key, params) => interpolate(lookup("zh-CN", key), params),
          locale: "zh-CN",
          subscribe: () => () => {
          },
          getSnapshot: () => "zh-CN",
          update: () => {
          },
          dispose: () => {
          }
        };
      }
      const rt = runtime;
      const listeners2 = /* @__PURE__ */ new Set();
      let active = normalizeLocale(rt.getSnapshot().active);
      try {
        rt.register(NS, { zh: zhCN, en: enUS });
      } catch {
      }
      const translated = rt.bind(NS);
      const resolve = (key, params) => {
        let text;
        try {
          text = translated(key);
        } catch {
          text = void 0;
        }
        if (!text || text === key) text = lookup(active, key);
        return interpolate(text, params);
      };
      function update() {
        const next = normalizeLocale(rt.getSnapshot().active);
        if (next !== active) {
          active = next;
          for (const cb of listeners2) cb();
        }
      }
      const disposeRuntimeSub = rt.subscribe ? rt.subscribe(update) : null;
      return {
        t: resolve,
        // Getter: `locale` must track switches (the field itself would be a
        // creation-time snapshot).
        get locale() {
          return active;
        },
        subscribe: (cb) => {
          listeners2.add(cb);
          return () => listeners2.delete(cb);
        },
        getSnapshot: () => active,
        update,
        dispose: () => {
          if (disposeRuntimeSub) disposeRuntimeSub();
        }
      };
    }
    function normalizeLocale(id) {
      return id && id.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
    }

    // src/client/styles.ts
    var STYLE_ID = "dsh-usage-panel/styles";
    var CSS = [
      ".dsw-ust-root{position:relative;display:flex;flex-direction:column;gap:16px;padding:16px 20px 28px;min-width:0;container-type:inline-size}",
      ".dsw-ust-tooltip{position:fixed;left:0;top:0;transform:translate(-50%,-110%);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);padding:8px 12px;border-radius:8px;font-size:12px;line-height:18px;white-space:nowrap;pointer-events:none;box-shadow:var(--dsw-shadow-lv2);opacity:0;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);z-index:9999}",
      ".dsw-ust-tooltip.show{opacity:1}",
      ".dsw-ust-tooltip-title{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px;white-space:nowrap}",
      ".dsw-ust-tooltip-row{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".dsw-ust-tooltip-row i{width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block}",
      ".dsw-ust-tooltip-row .dsw-ust-tooltip-label{flex:1;color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-tooltip-row .dsw-ust-tooltip-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
      ".dsw-ust-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
      ".dsw-ust-settings{display:flex;flex-direction:column;margin-top:8px}",
      ".dsw-ust-head h2{margin:0;font-size:16px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-head-title{display:flex;align-items:flex-start;gap:8px;min-width:0}",
      ".dsw-ust-page-icon{flex-shrink:0;margin-top:4px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-sub{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-source{margin-top:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);opacity:.85}",
      ".dsw-ust-repair{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}",
      ".dsw-ust-repair-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".dsw-ust-repair-hint{white-space:nowrap}",
      ".dsw-ust-repair .dsw-ust-more{height:18px;margin:0;padding:0 4px}",
      ".dsw-ust-repair-msg{color:var(--dsw-alias-label-secondary);max-width:560px;line-height:18px}",
      ".dsw-ust-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}",
      ".dsw-ust-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:16px;min-width:0}",
      ".dsw-ust-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}",
      ".dsw-ust-card h3{margin:0 0 12px;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-card-head h3{margin:0}",
      ".dsw-ust-card-title{display:flex;align-items:baseline;gap:8px;min-width:0}",
      ".dsw-ust-card-sub{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}",
      ".dsw-ust-kpi:nth-child(-n+2){grid-column:span 3}",
      ".dsw-ust-kpi:nth-child(n+3){grid-column:span 2}",
      "@container (max-width:460px){.dsw-ust-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.dsw-ust-kpi:nth-child(n){grid-column:span 1}}",
      "@container (max-width:320px){.dsw-ust-kpis{grid-template-columns:minmax(0,1fr)}}",
      ".dsw-ust-kpi{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 16px;min-width:0}",
      ".dsw-ust-kpi .l{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-kpi .v{margin-top:8px;font-size:16px;line-height:24px;font-weight:700;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;word-break:break-all}",
      ".dsw-ust-kpi .v-sm{font-size:14px;line-height:22px}",
      ".dsw-ust-kpi .d{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-range{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;flex-shrink:0}",
      ".dsw-ust-range button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:4px 12px;cursor:pointer}",
      ".dsw-ust-range button:hover{color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-range button.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}",
      ".dsw-ust-chart{width:100%;height:auto;display:block}",
      ".dsw-ust-axis{fill:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}",
      ".dsw-ust-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px}",
      ".dsw-ust-legend-item{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-legend-item i{width:8px;height:8px;border-radius:4px;display:inline-block}",
      ".dsw-ust-models{display:flex;gap:16px;align-items:center;flex-wrap:wrap}",
      ".dsw-ust-donut{flex-shrink:0}",
      ".dsw-ust-donut-seg{cursor:pointer}",
      ".dsw-ust-donut-total{fill:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;font-family:inherit}",
      ".dsw-ust-donut-cap{fill:var(--dsw-alias-label-secondary);font-size:12px;font-family:inherit}",
      ".dsw-ust-mlist{flex:1 1 192px;min-width:168px}",
      ".dsw-ust-mhead{display:flex;align-items:center;gap:8px;padding:0 4px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-mhead .h-model{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsw-ust-mhead .h-share{width:52px;text-align:right}",
      ".dsw-ust-mhead .h-rate{width:56px;text-align:right}",
      ".dsw-ust-mrate{width:56px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}",
      ".dsw-ust-mrow{display:flex;align-items:center;gap:8px;padding:8px 4px;font-size:12px;line-height:18px;min-width:0}",
      ".dsw-ust-mrow+.dsw-ust-mrow{border-top:1px solid var(--dsw-alias-border-l1)}",
      ".dsw-ust-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}",
      ".dsw-ust-mname{flex:1;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
      ".dsw-ust-mtokens{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
      ".dsw-ust-mpct{width:52px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".dsw-ust-empty{background:var(--dsw-alias-bg-layer-1);border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;padding:32px 20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
      ".dsw-ust-empty-title{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px}",
      ".dsw-ust-heat-card{overflow:hidden}",
      ".dsw-ust-graph-wrap{overflow-x:auto;padding-bottom:2px}",
      '.dsw-ust-graph{display:inline-grid;grid-template-areas:"corner months" "weekdays cells";grid-template-columns:auto auto;column-gap:6px;row-gap:4px;min-width:max-content}',
      ".dsw-ust-graph-months{grid-area:months;display:grid;column-gap:3px;height:16px;overflow:visible}",
      ".dsw-ust-graph-months>span{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
      ".dsw-ust-graph-weekdays{grid-area:weekdays;display:grid;grid-template-rows:repeat(7,12px);row-gap:3px;width:20px}",
      ".dsw-ust-graph-weekdays>span{font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);overflow:hidden;white-space:nowrap}",
      ".dsw-ust-graph-cells{grid-area:cells;display:grid;grid-template-rows:repeat(7,12px);grid-auto-columns:12px;grid-auto-flow:column;gap:3px}",
      ".dsw-ust-graph-day,.dsw-ust-graph-pad{width:12px;height:12px;border-radius:3px}",
      ".dsw-ust-graph-day{display:block;padding:0;border:0;cursor:pointer;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out)}",
      ".dsw-ust-graph-pad{display:block;visibility:hidden}",
      ".dsw-ust-graph-day.is-outside{opacity:.3}",
      ".dsw-ust-graph-day:hover,.dsw-ust-graph-day:focus-visible{opacity:1;outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
      ".dsw-ust-graph-day[aria-pressed=true]{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}",
      ".dsw-ust-graph-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;min-height:24px}",
      ".dsw-ust-graph-summary{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".dsw-ust-graph-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-h0{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent)}",
      // Levels mix the brand accent over the card surface so the ramp stays
      // monotonic in BOTH themes — static deepseek-100..600 reads inverted on
      // dark (level 1 near-white, level 4 darker than 3).
      ".dsw-ust-h1{background:color-mix(in srgb, var(--dsw-static-deepseek-500) 26%, var(--dsw-alias-bg-layer-1))}",
      ".dsw-ust-h2{background:color-mix(in srgb, var(--dsw-static-deepseek-500) 48%, var(--dsw-alias-bg-layer-1))}",
      ".dsw-ust-h3{background:color-mix(in srgb, var(--dsw-static-deepseek-500) 74%, var(--dsw-alias-bg-layer-1))}",
      ".dsw-ust-h4{background:var(--dsw-static-deepseek-500)}",
      ".dsw-ust-heat-legend{display:flex;align-items:center;gap:4px;margin-left:auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);flex-shrink:0}",
      ".dsw-ust-heat-swatch{width:12px;height:12px;border-radius:3px;display:inline-block}",
      ".dsw-ust-bar-seg{transform-origin:bottom;transform-box:fill-box;animation:dsw-ust-bar-grow .9s cubic-bezier(.16,1,.3,1) both}",
      ".dsw-ust-donut-seg{transform-box:fill-box;transform-origin:center;animation:dsw-ust-donut-spin .9s cubic-bezier(.16,1,.3,1) both}",
      "@keyframes dsw-ust-bar-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}",
      "@keyframes dsw-ust-donut-spin{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}",
      "@media (prefers-reduced-motion:reduce){.dsw-ust-bar-seg,.dsw-ust-donut-seg{animation:none}}",
      ".dsw-ust-srow{display:flex;align-items:center;gap:12px;padding:8px 4px;font-size:12px;line-height:18px;min-width:0}",
      ".dsw-ust-srow+.dsw-ust-srow{border-top:1px solid var(--dsw-alias-border-l1)}",
      ".dsw-ust-table-head{display:flex;align-items:center;gap:12px;padding:4px 4px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-sort{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-sort select{padding:2px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}",
      "button.dsw-ust-more{display:block;height:22px;margin:10px auto 0;border:none;background:transparent;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px;cursor:pointer;padding:2px 8px}",
      ".dsw-ust-more:disabled{opacity:0.5;cursor:default}",
      // Rank-column widths shared by the session/project tables (fixed header).
      ".dsw-ust-th-rank{width:20px;flex-shrink:0}",
      ".dsw-ust-th-session{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
      ".dsw-ust-th-cost{width:88px;text-align:right;flex-shrink:0}",
      ".dsw-ust-th-tokens{width:80px;text-align:right;flex-shrink:0}",
      ".dsw-ust-th-type{width:64px;flex-shrink:0}",
      ".dsw-ust-th-date{width:96px;flex-shrink:0}",
      ".dsw-ust-table-head .dsw-ust-th-rank,.dsw-ust-table-head .dsw-ust-th-session,.dsw-ust-table-head .dsw-ust-th-type,.dsw-ust-table-head .dsw-ust-th-date,.dsw-ust-table-head .dsw-ust-th-cost,.dsw-ust-table-head .dsw-ust-th-tokens{color:var(--dsw-alias-label-tertiary)}",
      // Align the session/project row cells with the shared header widths.
      ".dsw-ust-srow .dsw-ust-srank{width:20px}",
      ".dsw-ust-srow .dsw-ust-sname{flex:1}",
      ".dsw-ust-srow .dsw-ust-stag{width:64px}",
      ".dsw-ust-srow .dsw-ust-smeta{width:96px}",
      ".dsw-ust-srow .dsw-ust-scost{width:88px;text-align:right}",
      ".dsw-ust-srow .dsw-ust-stokens{width:80px;text-align:right}",
      ".dsw-ust-srank{width:20px;flex-shrink:0;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px}",
      ".dsw-ust-sname{flex:1;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
      ".dsw-ust-smeta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex-shrink:0}",
      ".dsw-ust-stag{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 8px;flex-shrink:0}",
      ".dsw-ust-stag.sub{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)}",
      ".dsw-ust-stokens{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}",
      ".dsw-ust-scost{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}",
      ".dsw-ust-scost.is-unpriced{color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-prow{display:flex;align-items:center;gap:12px;padding:8px 4px;font-size:12px;line-height:18px;min-width:0}",
      ".dsw-ust-prow+.dsw-ust-prow{border-top:1px solid var(--dsw-alias-border-l1)}",
      ".dsw-ust-pbar{flex:1;height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;min-width:60px}",
      ".dsw-ust-pbar i{display:block;height:100%;border-radius:4px;background:var(--dsw-static-deepseek-500)}",
      ".dsw-ust-pname{width:140px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}",
      ".dsw-ust-ptokens{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}",
      // Billing settings modal content.
      // The official Modal card is 380px wide with overflow:hidden and no content
      // scroll — widen the card and make the content column scroll so the form is
      // never clipped (real issue: the select form was cut off on both axes).
      ".dsw-ust-modal{width:min(620px,calc(100vw - 48px))}",
      ".dsw-ust-modal-content{max-height:calc(100vh - 180px);overflow-y:auto}",
      ".dsw-ust-bill-loading{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;padding:8px 0}",
      ".dsw-ust-bill{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0}",
      ".dsw-ust-bill-switch-inline input{accent-color:var(--dsw-static-deepseek-500)}",
      // Model-level 峰谷计价 toggle: inline in the pick row, right-aligned, no note.
      ".dsw-ust-bill-switch-inline{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto;flex-shrink:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}",
      // The model-area 峰谷计价 toggle: right-aligned inside the pick row, text first.
      ".dsw-ust-bill-pick .dsw-ust-bill-idle{margin-left:auto;width:auto;flex-shrink:0}",
      ".dsw-ust-bill-tip{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-bill-none{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}",
      ".dsw-ust-bill-section{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
      ".dsw-ust-bill-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".dsw-ust-bill-section-head h4{margin:0;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-bill-pick{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;width:100%}",
      ".dsw-ust-bill-select{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);flex:1 1 160px;min-width:120px}",
      ".dsw-ust-bill-select select{padding:3px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;width:100%;min-width:0}",
      "button.dsw-ust-bill-commit{height:26px;margin-left:auto;flex-shrink:0;border:1px solid var(--dsw-static-deepseek-500);background:color-mix(in srgb, var(--dsw-static-deepseek-500) 12%, transparent);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12px;line-height:18px;padding:3px 12px;cursor:pointer;font-weight:600}",
      ".dsw-ust-bill-commit:disabled{opacity:0.45;cursor:default}",
      ".dsw-ust-bill-commit-row{display:flex;justify-content:flex-end;margin-top:2px}",
      ".dsw-ust-bill-prices{display:grid;grid-template-columns:56px repeat(3,minmax(120px,1fr));gap:10px;align-items:center;max-width:520px}",
      ".dsw-ust-bill-prices.is-idle{padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l2)}",
      ".dsw-ust-bill-period{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-bill-period.is-peak{color:var(--dsw-alias-state-error-primary)}",
      ".dsw-ust-bill-period.is-idle{color:var(--dsw-alias-state-success-primary)}",
      ".dsw-ust-bill-default-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-bill-editor-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
      ".dsw-ust-bill-configured{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;padding-right:4px}",
      ".dsw-ust-bill-configured-row{display:flex;align-items:center;gap:12px;padding:4px 2px;font-size:12px;line-height:18px}",
      ".dsw-ust-bill-configured-row+.dsw-ust-bill-configured-row{border-top:1px solid var(--dsw-alias-border-l1)}",
      ".dsw-ust-bill-configured-model{flex:1;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
      ".dsw-ust-bill-configured-badge{flex-shrink:0;font-size:12px;line-height:18px;border-radius:4px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2)}",
      ".dsw-ust-bill-configured-badge.is-official{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent)}",
      ".dsw-ust-bill-configured-badge.is-custom{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent)}",
      ".dsw-ust-bill-configured-values{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".dsw-ust-bill-link{border:none;background:transparent;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px;padding:2px 4px;cursor:pointer}",
      ".dsw-ust-bill-link.danger{color:var(--dsw-alias-state-error-primary)}",
      ".dsw-ust-bill-input{display:flex;align-items:center;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
      ".dsw-ust-bill-input input{width:72px;padding:2px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
      ".dsw-ust-bill-input input.is-bad{border-color:var(--dsw-alias-state-error-primary)}",
      ".dsw-ust-bill-idle{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".dsw-ust-bill-idle-inputs{display:inline-flex;gap:6px;align-items:center}",
      ".dsw-ust-bill-flat{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}",
      ".dsw-ust-bill-add{display:flex;align-items:center;gap:6px;margin-top:2px}",
      ".dsw-ust-bill-add input{flex:1;min-width:120px;padding:2px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}",
      ".dsw-ust-bill-add button{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:4px;font-size:12px;line-height:18px;padding:2px 10px;cursor:pointer}",
      ".dsw-ust-bill-add button:hover{color:var(--dsw-alias-label-primary)}",
      ".dsw-ust-bill-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}",
      ".dsw-ust-bill-error.is-ok{color:var(--dsw-alias-state-success-primary)}",
      ".dsw-ust-bill-footer{display:flex;justify-content:flex-end;gap:8px}",
      ".dsw-ust-bill-cancel{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:12px;line-height:18px;padding:4px 12px;cursor:pointer}",
      ".dsw-ust-bill-cancel:disabled{opacity:0.5;cursor:default}",
      "button.dsw-ust-bill-save{height:26px;border:none;background:var(--dsw-static-deepseek-500);color:#fff;border-radius:6px;font-size:12px;line-height:18px;padding:4px 12px;cursor:pointer;font-weight:600}",
      ".dsw-ust-bill-save:disabled{opacity:0.5;cursor:default}"
    ].join("\n");

    // src/client/StatsSection.tsx
    var import_react9 = require("react");

    // src/shared/usage.ts
    function dayKeyUTC(ts) {
      const d = new Date(ts);
      return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    }
    function parseDayKeyUTC(key) {
      const p = key.split("-");
      return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    }
    function keyOfDateUTC(d) {
      return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    }
    function monthKeyUTC(dayKey) {
      return dayKey.slice(0, 7);
    }
    function graphWeeks(days) {
      const weeks = [];
      let week = new Array(7).fill(null);
      for (const day of days) {
        const row = (parseDayKeyUTC(day.date).getUTCDay() + 6) % 7;
        week[row] = day;
        if (row === 6) {
          weeks.push(week);
          week = new Array(7).fill(null);
        }
      }
      if (week.some((cell) => cell !== null)) weeks.push(week);
      return weeks;
    }
    function graphMonthLabels(weeks, minGap = 2) {
      const labels = [];
      let prevKey = "";
      for (let w = 0; w < weeks.length; w++) {
        const first = weeks[w].find((cell) => cell !== null);
        if (!first) continue;
        const key = monthKeyUTC(first.date);
        if (key === prevKey) continue;
        prevKey = key;
        labels.push({ week: w, monthKey: key });
      }
      if (labels.length > 1 && labels[1].week - labels[0].week < minGap) labels.shift();
      return labels;
    }
    function hitRate(b) {
      const denominator = b.input + b.cacheRead + b.cacheWrite;
      if (denominator <= 0) return null;
      return b.cacheRead / denominator;
    }
    function isUsageEmpty(overview) {
      return overview.allTime.sessionCount === 0 && overview.coverage.sessionsFailed === 0;
    }

    // src/shared/format.ts
    function fmtTokens(n, locale) {
      const v = Math.round(n || 0);
      if (locale === "zh-CN") {
        if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + " \u4EBF";
        if (v >= 1e5) return (v / 1e4).toFixed(1).replace(/\.0$/, "") + " \u4E07";
        return String(v);
      }
      if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
      return String(v);
    }
    function fmtCompact(n, locale) {
      const v = Math.round(n || 0);
      if (locale === "zh-CN") {
        if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, "") + "\u4EBF";
        if (v >= 1e4) return (v / 1e4).toFixed(0) + "\u4E07";
        return String(v);
      }
      if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
      return String(v);
    }
    function pctOf(v, total) {
      if (!total) return "0.0";
      return (v / total * 100).toFixed(1);
    }
    function niceCeil(v) {
      if (!(v > 0)) return 1;
      const p = Math.pow(10, Math.floor(Math.log10(v)));
      const d = v / p;
      const m = d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10;
      return m * p;
    }
    function quartileThresholds(nonzero) {
      const sorted = [...nonzero].sort((a, b) => a - b);
      const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : Infinity;
      return { q1: q(0.25), q2: q(0.5), q3: q(0.75) };
    }
    function heatLevel(total, q) {
      if (total <= 0) return 0;
      return total <= q.q1 ? 1 : total <= q.q2 ? 2 : total <= q.q3 ? 3 : 4;
    }
    function dateLabel(key) {
      const p = key.split("-");
      return p[1] + "/" + p[2];
    }
    function dateCN(key, locale) {
      const p = key.split("-");
      const m = Number(p[1]);
      const d = Number(p[2]);
      return locale === "zh-CN" ? m + "\u6708" + d + "\u65E5" : m + "/" + d;
    }
    var EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function monthShort(monthKey, locale) {
      const m = Number(monthKey.split("-")[1]);
      return locale === "zh-CN" ? m + "\u6708" : EN_MONTHS[m - 1];
    }
    function formatClock(ts, locale) {
      const d = new Date(ts);
      const h = String(d.getUTCHours()).padStart(2, "0");
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      return h + ":" + m + (locale === "zh-CN" ? "" : " UTC");
    }
    function pctFull(v) {
      return ((v || 0) * 100).toFixed(1);
    }

    // src/shared/contract.ts
    var RPC_CHANNEL = "/usage-stats";
    var RPC_BILLING_GET = "billing.get";
    var RPC_BILLING_SET = "billing.set";
    var RPC_BILLING_MODELS = "billing.models";
    var RPC_SESSIONS_MORE = "sessions.more";
    var RPC_PROJECTS_MORE = "projects.more";
    var RPC_REPAIR_SESSION = "repair.session";
    var OVERVIEW_VERSION = 5;

    // src/client/api.ts
    function withTimeout(source, ms, label) {
      source.catch(() => {
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(label + " timed out")), ms);
        source.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    }
    var TIMEOUTS = {
      overview: 6e4,
      billing: 8e3,
      page: 8e3,
      sessionCost: 8e3,
      repair: 3e4,
      models: 8e3
    };
    var CACHE_KEY = "dsh-usage-panel:overview:v" + OVERVIEW_VERSION;
    function loadCached() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isUsable(parsed)) return null;
        return parsed;
      } catch {
        return null;
      }
    }
    function saveCached(payload) {
      setTimeout(() => {
        try {
          const record = { version: OVERVIEW_VERSION, savedAt: Date.now(), payload };
          localStorage.setItem(CACHE_KEY, JSON.stringify(record));
        } catch {
        }
      }, 0);
    }
    function clearCached() {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
      }
    }
    function isUsable(value) {
      if (!value || typeof value !== "object") return false;
      const v = value;
      if (v.version !== OVERVIEW_VERSION) return false;
      const payload = v.payload;
      if (!payload || typeof payload !== "object") return false;
      if (typeof payload.updatedAt !== "number") return false;
      const totals = payload.totals;
      if (!totals || typeof totals.input !== "number" || typeof totals.total !== "number") return false;
      if (!Array.isArray(payload.days) || !Array.isArray(payload.byModel)) return false;
      const allTime = payload.allTime;
      if (!allTime || typeof allTime.sessionCount !== "number") return false;
      const coverage = payload.coverage;
      if (!coverage || typeof coverage.sessionsTotal !== "number") return false;
      if (typeof coverage.usageSessionsMain !== "number" || typeof coverage.usageSessionsSubagent !== "number") return false;
      if (!Array.isArray(payload.topSessions) || !Array.isArray(payload.providers)) return false;
      return true;
    }
    async function callOverview(rpc, force, onSuccess) {
      const source = rpc.call("/usage-stats", "overview", { force: !!force }).then((result) => {
        const res = result;
        if (res && res.ok) {
          onSuccess?.(res.value);
          return res.value;
        }
        const code = res && res.error ? res.error.code : "internal";
        const message = res && res.error ? res.error.message : "unknown error";
        const err = new Error(message);
        err.code = code;
        throw err;
      });
      return withTimeout(source, TIMEOUTS.overview, "overview");
    }
    async function callBillingGet(rpc) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_BILLING_GET, {}),
        TIMEOUTS.billing,
        "billing settings"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }
    async function callBillingSet(rpc, settings) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_BILLING_SET, settings),
        TIMEOUTS.billing,
        "billing settings"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }
    async function callBillingModels(rpc) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_BILLING_MODELS, {}),
        TIMEOUTS.models,
        "model directory"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }
    async function callSessionPage(rpc, offset, sort) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_SESSIONS_MORE, { offset, sort }),
        TIMEOUTS.page,
        "session page"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }
    async function callProjectPage(rpc, offset, sort) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_PROJECTS_MORE, { offset, sort }),
        TIMEOUTS.page,
        "project page"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }
    async function callRepairSession(rpc, sessionId) {
      const res = await withTimeout(
        rpc.call(RPC_CHANNEL, RPC_REPAIR_SESSION, { sessionId }),
        TIMEOUTS.repair,
        "session repair"
      );
      if (res && res.ok) return res.value;
      const err = new Error(res && res.error ? res.error.message : "unknown error");
      if (res && res.error) err.code = res.error.code;
      throw err;
    }

    // src/client/overview-requests.ts
    function createOverviewRequests() {
      let generation = 0;
      return {
        begin() {
          const request = ++generation;
          return () => generation === request;
        },
        invalidate() {
          generation += 1;
        }
      };
    }

    // src/client/hooks.ts
    var import_react = require("react");

    // src/client/billing-bus.ts
    var snapshot = null;
    var listeners = /* @__PURE__ */ new Set();
    function publishBilling(settings) {
      snapshot = settings;
      if (settings === null) return;
      for (const listener of listeners) listener(settings);
    }
    function currentBilling() {
      return snapshot;
    }
    function subscribeBilling(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    // src/client/hooks.ts
    var PALETTE = [
      "var(--dsw-static-deepseek-500)",
      "var(--dsw-alias-state-success-primary)",
      "var(--dsw-alias-state-warn-primary)",
      "var(--dsw-alias-state-error-primary)",
      "var(--dsw-static-deepseek-600)",
      "var(--dsw-static-deepseek-400)",
      "color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-alias-state-warn-primary))",
      "color-mix(in srgb, var(--dsw-alias-state-success-primary) 70%, var(--dsw-static-deepseek-500))",
      "color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, var(--dsw-static-deepseek-800))",
      "color-mix(in srgb, var(--dsw-static-deepseek-500) 50%, var(--dsw-alias-label-secondary))"
    ];
    function modelRows(byModel, otherLabel) {
      const rows = [];
      for (let i = 0; i < byModel.length && i < 5; i++) {
        const m = byModel[i];
        rows.push({
          model: m.model,
          total: m.total,
          color: PALETTE[i % PALETTE.length],
          rest: false,
          buckets: { input: m.input, output: m.output, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite }
        });
      }
      if (byModel.length > 5) {
        const rest = byModel.slice(5);
        rows.push({
          model: otherLabel,
          total: rest.reduce((s, m) => s + m.total, 0),
          color: null,
          rest: true,
          buckets: rest.reduce(
            (acc, m) => ({
              input: acc.input + m.input,
              output: acc.output + m.output,
              cacheRead: acc.cacheRead + m.cacheRead,
              cacheWrite: acc.cacheWrite + m.cacheWrite
            }),
            { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          )
        });
      }
      return rows;
    }
    function useCountUp(target, duration) {
      const [value, setValue] = (0, import_react.useState)(0);
      (0, import_react.useEffect)(() => {
        const start = performance.now();
        let raf = 0;
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(target * eased);
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
          if (raf) cancelAnimationFrame(raf);
        };
      }, [target, duration]);
      return value;
    }
    function useI18n(i18n) {
      const subscribe = (0, import_react.useCallback)((cb) => i18n.subscribe(cb), [i18n]);
      const active = (0, import_react.useSyncExternalStore)(subscribe, i18n.getSnapshot, i18n.getSnapshot);
      return active === i18n.locale ? i18n : { ...i18n, locale: active };
    }
    function useBillingSettings(rpc) {
      const [settings, setSettings] = (0, import_react.useState)(() => currentBilling());
      (0, import_react.useEffect)(() => {
        let disposed = false;
        const off = subscribeBilling((next) => setSettings(next));
        if (currentBilling() === null) {
          callBillingGet(rpc).then((value) => {
            if (disposed) return;
            publishBilling(value);
            setSettings(value);
          }).catch(() => {
          });
        }
        return () => {
          disposed = true;
          off();
        };
      }, [rpc]);
      return settings;
    }
    function useLatest(value) {
      const ref = (0, import_react.useRef)(value);
      ref.current = value;
      return ref;
    }

    // src/client/components/Tooltip.tsx
    var React = __toESM(require("react"), 1);
    function Tooltip({ tip }) {
      if (!tip) return null;
      return /* @__PURE__ */ React.createElement("div", { className: "dsw-ust-tooltip show", style: { left: tip.left, top: tip.top } }, /* @__PURE__ */ React.createElement("div", { className: "dsw-ust-tooltip-title" }, tip.title), tip.lines.map((l, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, className: "dsw-ust-tooltip-row" }, /* @__PURE__ */ React.createElement("i", { style: { background: l.color || "var(--dsw-alias-label-secondary)" } }), /* @__PURE__ */ React.createElement("span", { className: "dsw-ust-tooltip-label" }, l.label), /* @__PURE__ */ React.createElement("span", { className: "dsw-ust-tooltip-value" }, l.value))));
    }

    // src/shared/pricing.ts
    var DEEPSEEK_OFFICIAL_PRICES = [
      {
        model: "deepseek-v4-flash",
        price: {
          inputCacheHit: { idle: 0.05, peak: 0.1 },
          inputCacheMiss: { idle: 1.5, peak: 3 },
          output: { idle: 4.5, peak: 9 }
        }
      },
      {
        model: "deepseek-v4-pro",
        price: {
          inputCacheHit: { idle: 0.15, peak: 0.3 },
          inputCacheMiss: { idle: 4.5, peak: 9 },
          output: { idle: 13.5, peak: 27 }
        }
      },
      {
        model: "deepseek-v4-flash-vision-exp",
        price: {
          inputCacheHit: { idle: 0.05, peak: 0.1 },
          inputCacheMiss: { idle: 1.5, peak: 3 },
          output: { idle: 4.5, peak: 9 }
        }
      }
    ];
    function officialPriceFor(model) {
      const needle = model.toLowerCase();
      return DEEPSEEK_OFFICIAL_PRICES.find((entry) => entry.model.toLowerCase() === needle)?.price;
    }
    function compositePriceKey(provider, model) {
      return provider + "/" + model;
    }
    function resolveModelPrice(provider, model, customPrices) {
      if (model === null || model === void 0 || model === "") return null;
      const custom = lookupCustomPrice(provider, model, customPrices);
      if (custom !== void 0) {
        const peak = { inputCacheHit: custom.inputCacheHit, inputCacheMiss: custom.inputCacheMiss, output: custom.output };
        if (custom.flat === true) {
          return { peak, idle: peak, idleExplicit: true, flat: true, source: "custom" };
        }
        if (custom.idle !== void 0) {
          return { peak, idle: custom.idle, idleExplicit: true, flat: false, source: "custom" };
        }
        const half = (n) => n / 2;
        return {
          peak,
          idle: {
            inputCacheHit: half(peak.inputCacheHit),
            inputCacheMiss: half(peak.inputCacheMiss),
            output: half(peak.output)
          },
          idleExplicit: false,
          flat: false,
          source: "custom"
        };
      }
      const official = officialPriceFor(model);
      if (official === void 0) return null;
      return {
        peak: { inputCacheHit: official.inputCacheHit.peak, inputCacheMiss: official.inputCacheMiss.peak, output: official.output.peak },
        idle: { inputCacheHit: official.inputCacheHit.idle, inputCacheMiss: official.inputCacheMiss.idle, output: official.output.idle },
        idleExplicit: true,
        flat: false,
        source: "official"
      };
    }
    function lookupCustomPrice(provider, model, customPrices) {
      if (provider !== null && provider !== void 0) {
        const byProvider = customPrices[compositePriceKey(provider, model)];
        if (byProvider !== void 0) return byProvider;
      }
      return customPrices[model];
    }
    function formatCost(cents) {
      return "\xA5" + (Math.max(0, Math.round(cents)) / 100).toFixed(2);
    }
    function priceText(yuanPerMillion) {
      return String(Math.round(yuanPerMillion * 1e6) / 1e6);
    }

    // src/shared/cost.ts
    var MICRO_SCALE = 1e6;
    var CENTS_DIVISOR = 1e10;
    function microRate(yuanPerMillion) {
      return Math.round(yuanPerMillion * MICRO_SCALE);
    }
    function bucketMicro(b, hit, miss, out) {
      return b.missInputTokens * miss + b.cacheReadTokens * hit + b.outputTokens * out;
    }
    function periodCostCents(b, rate) {
      const micro = bucketMicro(b, microRate(rate.inputCacheHit), microRate(rate.inputCacheMiss), microRate(rate.output));
      return Math.round(micro / CENTS_DIVISOR);
    }
    function computeBilledCost(usage, price) {
      return periodCostCents(usage.peak, price.peak) + periodCostCents(usage.offPeak, price.idle);
    }
    function splitCostCents(buckets, price) {
      return {
        peak: periodCostCents(billedBucketsOf(buckets.peak), price.peak),
        offPeak: periodCostCents(billedBucketsOf(buckets.offPeak), price.idle)
      };
    }
    function billedBucketsOf(b) {
      return {
        missInputTokens: b.input + b.cacheWrite,
        cacheReadTokens: b.cacheRead,
        outputTokens: b.output
      };
    }
    function costCentsFor(buckets, provider, model, customPrices, peakValley = true) {
      const price = resolveModelPrice(provider, model, customPrices);
      if (price === null) return null;
      const effective = peakValley ? price : { ...price, idle: price.peak };
      return computeBilledCost(
        { peak: billedBucketsOf(buckets.peak), offPeak: billedBucketsOf(buckets.offPeak) },
        effective
      );
    }
    function sumCostCents(rows) {
      let any = false;
      let sum = 0;
      for (const cents of rows) {
        if (cents === null) continue;
        any = true;
        sum += cents;
      }
      return any ? sum : null;
    }
    function totalCostCents(rows, prices, peakValley) {
      return sumCostCents(rows.map((row) => costCentsFor(row.cost, row.provider, row.model, prices, peakValley)));
    }

    // src/client/components/KpiCards.tsx
    var React2 = __toESM(require("react"), 1);
    var import_react2 = require("react");
    function KpiCards({ overview, i18n, rpc }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const allTime = overview.allTime || { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, sessionCount: 0, byModel: [] };
      const totals = allTime.totals || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      const total = totals.total || 0;
      const top = allTime.byModel[0] || null;
      const rate = hitRate(totals);
      const coverage = overview.coverage;
      const billing = useBillingSettings(rpc);
      const pricedRows = billing === null ? [] : allTime.byModel.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled));
      const costTotal = billing === null ? null : sumCostCents(pricedRows);
      const split = (0, import_react2.useMemo)(() => {
        if (billing === null) return null;
        let peak = 0;
        let offPeak = 0;
        let any = false;
        for (const m of allTime.byModel) {
          const price = resolveModelPriceForSplit(m.provider, m.model, billing);
          if (price === null) continue;
          any = true;
          const parts = splitCostCents(m.cost, price);
          peak += parts.peak;
          offPeak += parts.offPeak;
        }
        return any ? { peak, offPeak } : null;
      }, [billing, allTime.byModel]);
      const animatedTotal = useCountUp(total, 900);
      const animatedInput = useCountUp(totals.input, 900);
      const animatedOutput = useCountUp(totals.output, 900);
      const animatedCacheRead = useCountUp(totals.cacheRead, 900);
      const animatedSessions = useCountUp(allTime.sessionCount, 900);
      const animatedRate = useCountUp(rate === null ? 0 : rate * 100, 900);
      const animatedCost = useCountUp(costTotal === null ? 0 : costTotal, 900);
      const costValue = costTotal === null ? "\u2014" : formatCost(animatedCost);
      const costDetail = split === null ? t("kpi.cost.none") : t("kpi.cost.detail", { peak: formatCost(split.peak), idle: formatCost(split.offPeak) });
      return /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpis" }, /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpi" }, /* @__PURE__ */ React2.createElement("div", { className: "l" }, t("kpi.total")), /* @__PURE__ */ React2.createElement("div", { className: "v" }, fmtTokens(animatedTotal, locale)), /* @__PURE__ */ React2.createElement("div", { className: "d" }, t("kpi.total.detail", {
        input: fmtTokens(animatedInput, locale),
        output: fmtTokens(animatedOutput, locale),
        cacheRead: fmtTokens(animatedCacheRead, locale)
      }))), /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpi" }, /* @__PURE__ */ React2.createElement("div", { className: "l" }, t("kpi.cost")), /* @__PURE__ */ React2.createElement("div", { className: "v v-sm", title: t("strip.estimate") }, costValue), /* @__PURE__ */ React2.createElement("div", { className: "d" }, costDetail)), /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpi" }, /* @__PURE__ */ React2.createElement("div", { className: "l" }, t("kpi.sessions")), /* @__PURE__ */ React2.createElement("div", { className: "v" }, String(Math.round(animatedSessions))), /* @__PURE__ */ React2.createElement("div", { className: "d" }, t("kpi.sessions.detail", {
        total: coverage.sessionsTotal,
        main: coverage.usageSessionsMain,
        subagent: coverage.usageSessionsSubagent
      }))), /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpi" }, /* @__PURE__ */ React2.createElement("div", { className: "l" }, t("kpi.topModel")), /* @__PURE__ */ React2.createElement("div", { className: "v v-sm" }, top ? top.model : "\u2014"), /* @__PURE__ */ React2.createElement("div", { className: "d" }, top ? t("kpi.topModel.detail", { pct: pctOf(top.total, total) }) : "")), /* @__PURE__ */ React2.createElement("div", { className: "dsw-ust-kpi" }, /* @__PURE__ */ React2.createElement("div", { className: "l" }, t("kpi.hitRate")), /* @__PURE__ */ React2.createElement("div", { className: "v v-sm" }, rate === null ? "\u2014" : pctFull(animatedRate / 100) + "%"), /* @__PURE__ */ React2.createElement("div", { className: "d" }, rate === null ? t("kpi.hitRate.none") : t("kpi.hitRate.detail", { read: fmtTokens(totals.cacheRead, locale), write: fmtTokens(totals.cacheWrite, locale) }))));
    }
    function resolveModelPriceForSplit(provider, model, billing) {
      const price = resolveModelPrice(provider, model, billing.prices);
      if (price === null) return null;
      return billing.peakValleyEnabled ? price : { ...price, idle: price.peak };
    }

    // src/client/components/Heatmap.tsx
    var import_react3 = require("react");
    var UiPrimitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
    var React3 = __toESM(require("react"), 1);
    var { Button } = UiPrimitives;
    function Heatmap({ days, i18n, onTip, prices, peakValley = true, modelProviders = {} }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const minDate = days[0]?.date ?? "";
      const maxDate = days[days.length - 1]?.date ?? "";
      const weeks = (0, import_react3.useMemo)(() => graphWeeks(days), [days]);
      const monthLabels = (0, import_react3.useMemo)(() => graphMonthLabels(weeks), [weeks]);
      const q = (0, import_react3.useMemo)(
        () => quartileThresholds(days.filter((day) => day.total > 0).map((day) => day.total)),
        [days]
      );
      const [pickedStart, setPickedStart] = (0, import_react3.useState)(null);
      const [pickedEnd, setPickedEnd] = (0, import_react3.useState)(null);
      const [focusKey, setFocusKey] = (0, import_react3.useState)(null);
      const gridRef = (0, import_react3.useRef)(null);
      const hasRange = pickedStart !== null && pickedEnd !== null && pickedEnd >= minDate;
      const start = hasRange ? pickedStart : minDate;
      const end = hasRange ? pickedEnd : maxDate;
      const selected = days.filter((day) => day.date >= start && day.date <= end);
      const selectedTotal = selected.reduce((sum, day) => sum + day.total, 0);
      const activeDays = selected.filter((day) => day.total > 0).length;
      const showTip = (element, rec) => {
        const rect = element.getBoundingClientRect();
        const lines = [];
        if (prices !== void 0) {
          const rows = Object.keys(rec.modelCosts).map((model) => ({
            model,
            provider: modelProviders[model] ?? "unknown",
            cost: rec.modelCosts[model]
          }));
          const cents = totalCostCents(rows, prices, peakValley);
          lines.push({
            label: t("heat.cost"),
            value: cents === null ? t("heat.costNone") : formatCost(cents),
            color: cents === null ? "var(--dsw-alias-label-tertiary)" : "var(--dsw-alias-state-success-primary)"
          });
        }
        onTip({
          left: rect.left + rect.width / 2,
          top: rect.top - 6,
          title: t("heat.day", { date: dateCN(rec.date, locale), tokens: fmtTokens(rec.total, locale) }),
          lines
        });
      };
      const pick = (key, extend) => {
        if (extend && pickedStart !== null) {
          if (key >= pickedStart) {
            setPickedEnd(key);
          } else {
            setPickedEnd(pickedEnd ?? pickedStart);
            setPickedStart(key);
          }
        } else {
          setPickedStart(key);
          setPickedEnd(key);
        }
      };
      const focusable = focusKey !== null && focusKey >= minDate && focusKey <= maxDate ? focusKey : maxDate;
      const moveFocus = (fromKey, delta) => {
        const d = parseDayKeyUTC(fromKey);
        d.setUTCDate(d.getUTCDate() + delta);
        const key = keyOfDateUTC(d);
        if (key < minDate || key > maxDate) return;
        setFocusKey(key);
        gridRef.current?.querySelector(`[data-day="${key}"]`)?.focus();
      };
      const onGridKeyDown = (event) => {
        const cell = event.target.closest("[data-day]");
        if (!cell) return;
        const key = cell.dataset.day;
        const delta = event.key === "ArrowLeft" ? -7 : event.key === "ArrowRight" ? 7 : event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (delta !== 0) {
          event.preventDefault();
          moveFocus(key, delta);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveFocus(minDate, 0);
        } else if (event.key === "End") {
          event.preventDefault();
          moveFocus(maxDate, 0);
        }
      };
      const cells = [];
      for (const week of weeks) {
        for (let r = 0; r < 7; r++) {
          const rec = week[r];
          if (rec === null || rec === void 0) {
            cells.push(/* @__PURE__ */ React3.createElement("i", { key: "pad-" + cells.length, className: "dsw-ust-graph-pad", "aria-hidden": "true" }));
            continue;
          }
          const key = rec.date;
          const outside = key < start || key > end;
          cells.push(
            /* @__PURE__ */ React3.createElement(
              "button",
              {
                key,
                type: "button",
                "data-day": key,
                className: "dsw-ust-graph-day dsw-ust-h" + heatLevel(rec.total, q) + (outside ? " is-outside" : ""),
                tabIndex: key === focusable ? 0 : -1,
                "aria-label": t("heat.day", { date: dateCN(key, locale), tokens: fmtTokens(rec.total, locale) }),
                "aria-pressed": hasRange && start === key && end === key,
                onClick: (event) => pick(key, event.shiftKey),
                onMouseEnter: (event) => showTip(event.currentTarget, rec),
                onMouseLeave: () => onTip(null),
                onFocus: (event) => {
                  setFocusKey(key);
                  showTip(event.currentTarget, rec);
                },
                onBlur: () => onTip(null)
              }
            )
          );
        }
      }
      const weekdayText = locale === "zh-CN" ? ["\u4E00", "", "\u4E09", "", "\u4E94", "", ""] : ["Mon", "", "Wed", "", "Fri", "", ""];
      const rangeText = start === end ? dateCN(start, locale) : dateCN(start, locale) + " \u2013 " + dateCN(end, locale);
      const summaryText = hasRange ? t("heat.range", { range: rangeText, tokens: fmtTokens(selectedTotal, locale), active: activeDays, total: selected.length }) : t("heat.window", { tokens: fmtTokens(selectedTotal, locale), active: activeDays });
      return /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-card dsw-ust-heat-card" }, /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-card-head" }, /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-card-title" }, /* @__PURE__ */ React3.createElement("h3", null, t("heat.title")), /* @__PURE__ */ React3.createElement("span", { className: "dsw-ust-card-sub" }, t("heat.sub.fallback")))), /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-graph-wrap" }, /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-graph", role: "group", "aria-label": t("heat.title"), onKeyDown: onGridKeyDown }, /* @__PURE__ */ React3.createElement(
        "div",
        {
          className: "dsw-ust-graph-months",
          "aria-hidden": "true",
          style: { gridTemplateColumns: "repeat(" + weeks.length + ", 12px)" }
        },
        monthLabels.map((label) => /* @__PURE__ */ React3.createElement("span", { key: label.week, style: { gridRow: 1, gridColumn: label.week + 1 } }, monthShort(label.monthKey, locale)))
      ), /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-graph-weekdays", "aria-hidden": "true" }, weekdayText.map((text, row) => /* @__PURE__ */ React3.createElement("span", { key: row, style: { gridRow: row + 1 } }, text))), /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-graph-cells", ref: gridRef }, cells))), /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-graph-footer" }, /* @__PURE__ */ React3.createElement("span", { className: "dsw-ust-graph-summary", "aria-live": "polite" }, summaryText), hasRange ? /* @__PURE__ */ React3.createElement(Button, { variant: "ghost", size: "sm", onClick: () => {
        setPickedStart(null);
        setPickedEnd(null);
      } }, t("heat.clear")) : /* @__PURE__ */ React3.createElement("span", { className: "dsw-ust-graph-hint" }, t("heat.hint")), /* @__PURE__ */ React3.createElement("div", { className: "dsw-ust-heat-legend" }, /* @__PURE__ */ React3.createElement("span", null, t("heat.less")), [0, 1, 2, 3, 4].map((level) => /* @__PURE__ */ React3.createElement("i", { key: level, className: "dsw-ust-heat-swatch dsw-ust-h" + level })), /* @__PURE__ */ React3.createElement("span", null, t("heat.more")))));
    }

    // src/client/components/BarChart.tsx
    var import_react4 = require("react");
    var React4 = __toESM(require("react"), 1);
    function BarChart({ days, byModel, i18n, onTip }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const [range, setRange] = (0, import_react4.useState)(7);
      const rows = modelRows(byModel, t("donut.other"));
      const topNames = {};
      for (let i = 0; i < byModel.length && i < 5; i++) topNames[byModel[i].model] = true;
      const othersOf = (d) => {
        let s = 0;
        for (const name of Object.keys(d.models)) if (!topNames[name]) s += d.models[name].total;
        return s;
      };
      const rangeDays = days.slice(-range);
      const yMax = niceCeil(Math.max.apply(null, rangeDays.map((d) => d.total).concat(1)));
      const W = 720;
      const H = 230;
      const PL = 52;
      const PR = 12;
      const PT = 10;
      const PB = 26;
      const plotW = W - PL - PR;
      const plotH = H - PT - PB;
      const n = rangeDays.length;
      const band = plotW / n;
      const barW = Math.min(44, band * 0.6);
      const yLines = [];
      for (let i = 0; i <= 4; i++) {
        const v = yMax / 4 * i;
        const y = PT + plotH - v / yMax * plotH;
        yLines.push(
          /* @__PURE__ */ React4.createElement("g", { key: "y" + i }, /* @__PURE__ */ React4.createElement("line", { x1: PL, x2: W - PR, y1: y, y2: y, stroke: "var(--dsw-alias-border-l1)", strokeWidth: 1, strokeDasharray: i === 0 ? "none" : "3 3" }), /* @__PURE__ */ React4.createElement("text", { x: PL - 6, y: y + 3, textAnchor: "end", className: "dsw-ust-axis" }, fmtCompact(v, locale)))
        );
      }
      const bars = rangeDays.map((d, i) => {
        const x = PL + band * i + (band - barW) / 2;
        const segs = [];
        let acc = 0;
        for (const r of rows) {
          const v = r.rest ? othersOf(d) : d.models[r.model] ? d.models[r.model].total : 0;
          if (v > 0) {
            const h = v / yMax * plotH;
            segs.push(
              /* @__PURE__ */ React4.createElement(
                "rect",
                {
                  key: r.model,
                  x,
                  y: PT + plotH - acc - h,
                  width: barW,
                  height: h,
                  fill: r.rest ? "var(--dsw-alias-label-secondary)" : r.color,
                  opacity: r.rest ? 0.45 : 1,
                  rx: 2,
                  className: "dsw-ust-bar-seg",
                  style: { animationDelay: i * 30 + "ms" }
                }
              )
            );
            acc += h;
          }
        }
        if (acc === 0) {
          segs.push(
            /* @__PURE__ */ React4.createElement(
              "rect",
              {
                key: "zero",
                x,
                y: PT + plotH - 2,
                width: barW,
                height: 2,
                fill: "var(--dsw-alias-border-l2)",
                className: "dsw-ust-bar-seg",
                style: { animationDelay: i * 30 + "ms" }
              }
            )
          );
        }
        return /* @__PURE__ */ React4.createElement(
          "g",
          {
            key: d.date,
            className: "dsw-ust-bar-day",
            onMouseEnter: (e) => {
              const lines = [];
              let acc2 = 0;
              for (const r of rows) {
                const v = r.rest ? othersOf(d) : d.models[r.model] ? d.models[r.model].total : 0;
                if (v > 0) {
                  lines.push({ label: r.model, value: fmtTokens(v, locale) + " Tokens", color: r.rest ? "var(--dsw-alias-label-secondary)" : r.color });
                  acc2 += v;
                }
              }
              const rect = e.currentTarget.getBoundingClientRect();
              onTip({
                left: rect.left + rect.width / 2,
                top: rect.top - 6,
                title: t("bar.day", { date: dateCN(d.date, locale), tokens: fmtTokens(d.total || acc2, locale) }),
                lines
              });
            },
            onMouseLeave: () => onTip(null)
          },
          segs
        );
      });
      const xStep = n <= 7 ? 1 : Math.ceil(n / 7);
      const xLabels = rangeDays.map(
        (d, i) => i % xStep === 0 || i === n - 1 ? /* @__PURE__ */ React4.createElement("text", { key: d.date, x: PL + band * i + band / 2, y: H - 8, textAnchor: "middle", className: "dsw-ust-axis" }, dateLabel(d.date)) : null
      );
      return /* @__PURE__ */ React4.createElement("div", { className: "dsw-ust-card" }, /* @__PURE__ */ React4.createElement("div", { className: "dsw-ust-card-head" }, /* @__PURE__ */ React4.createElement("div", { className: "dsw-ust-card-title" }, /* @__PURE__ */ React4.createElement("h3", null, t("bar.title")), /* @__PURE__ */ React4.createElement("span", { className: "dsw-ust-card-sub" }, t("bar.sub"))), /* @__PURE__ */ React4.createElement("div", { className: "dsw-ust-range" }, [7, 14, 30].map((r) => /* @__PURE__ */ React4.createElement("button", { key: r, className: range === r ? "on" : "", onClick: () => setRange(r) }, r + "d")))), /* @__PURE__ */ React4.createElement("svg", { viewBox: "0 0 720 230", className: "dsw-ust-chart", preserveAspectRatio: "xMidYMid meet" }, yLines, bars, xLabels), /* @__PURE__ */ React4.createElement("div", { className: "dsw-ust-legend" }, rows.map((r) => /* @__PURE__ */ React4.createElement("span", { key: r.model, className: "dsw-ust-legend-item" }, /* @__PURE__ */ React4.createElement("i", { style: { background: r.rest ? "var(--dsw-alias-label-secondary)" : r.color, opacity: r.rest ? 0.45 : 1 } }), r.model))));
    }

    // src/client/components/SessionsCard.tsx
    var import_react6 = require("react");

    // src/client/components/MoreRankModal.tsx
    var import_react5 = require("react");
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var React5 = __toESM(require("react"), 1);
    function MoreRankModal({ kind, i18n, rpc, open, onClose }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const billing = useBillingSettings(rpc);
      const [sort, setSort] = (0, import_react5.useState)("tokens");
      const [sessions, setSessions] = (0, import_react5.useState)([]);
      const [projects, setProjects] = (0, import_react5.useState)([]);
      const [loading, setLoading] = (0, import_react5.useState)(false);
      const [loadingMore, setLoadingMore] = (0, import_react5.useState)(false);
      const [loadError, setLoadError] = (0, import_react5.useState)(null);
      const [appendError, setAppendError] = (0, import_react5.useState)(null);
      const appendErrorId = React5.useRef(0);
      const [hasMore, setHasMore] = (0, import_react5.useState)(false);
      const resetAndFetch = (nextSort) => {
        setSort(nextSort);
        setLoadError(null);
        setAppendError(null);
        setSessions([]);
        setProjects([]);
        setHasMore(false);
        fetchPage(0, nextSort, false);
      };
      const fetchPage = (offset, nextSort, append) => {
        if (append && (loading || loadingMore)) return;
        setAppendError(null);
        if (append) setLoadingMore(true);
        else setLoading(true);
        const p = kind === "sessions" ? callSessionPage(rpc, offset, nextSort) : callProjectPage(rpc, offset, nextSort);
        p.then((page) => {
          if (kind === "sessions") {
            const result = page;
            setSessions((prev) => append ? [...prev, ...result.sessions] : result.sessions);
            setHasMore(result.hasMore);
          } else {
            const result = page;
            setProjects((prev) => append ? [...prev, ...result.rows] : result.rows);
            setHasMore(result.hasMore);
          }
        }).catch((err) => {
          const msg = String(err?.message ?? err);
          if (append) setAppendError({ id: ++appendErrorId.current, text: t("status.error", { msg }) });
          else setLoadError(msg);
        }).finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
      };
      React5.useEffect(() => {
        if (!open) return;
        resetAndFetch(sort);
      }, [open]);
      const title = kind === "sessions" ? t("sessions.title") : t("projects.title");
      const body = loadError !== null && (kind === "sessions" ? sessions.length === 0 : projects.length === 0) ? /* @__PURE__ */ React5.createElement("div", { className: "dsw-ust-bill-loading" }, /* @__PURE__ */ React5.createElement("div", null, t("billing.loadError", { msg: loadError })), /* @__PURE__ */ React5.createElement("button", { type: "button", className: "dsw-ust-bill-cancel", onClick: () => resetAndFetch(sort) }, t("billing.retry"))) : /* @__PURE__ */ React5.createElement("div", { className: "dsw-ust-more-modal" }, /* @__PURE__ */ React5.createElement("div", { className: "dsw-ust-card-head" }, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-card-sub" }, t("sessions.sub")), /* @__PURE__ */ React5.createElement("label", { className: "dsw-ust-sort" }, /* @__PURE__ */ React5.createElement("span", null, t("sort.by")), /* @__PURE__ */ React5.createElement("select", { value: sort, disabled: loading || loadingMore, onChange: (e) => resetAndFetch(e.target.value) }, /* @__PURE__ */ React5.createElement("option", { value: "tokens" }, t("sort.tokens")), /* @__PURE__ */ React5.createElement("option", { value: "cost" }, t("sort.cost"))))), /* @__PURE__ */ React5.createElement("div", { className: "dsw-ust-table-head" }, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-rank" }, "#"), kind === "sessions" ? /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-session" }, t("sessions.hSession")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-type" }, t("sessions.hType")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-date" }, t("sessions.hActive")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-cost" }, t("sessions.hCost")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-tokens" }, t("sessions.hTokens"))) : /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-session" }, t("projects.hProject")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-cost" }, t("projects.hCost")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-th-tokens" }, t("projects.hTokens")))), loading ? /* @__PURE__ */ React5.createElement("div", { className: "dsw-ust-empty" }, t("projects.loading")) : kind === "sessions" ? sessions.map((s, i) => {
        const d = new Date(s.lastActive);
        const date = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
        const cents = billing === null ? null : sumCostCents(s.models.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled)));
        return /* @__PURE__ */ React5.createElement("div", { key: s.id, className: "dsw-ust-srow" }, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-srank" }, i + 1), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-sname", title: s.id }, s.title || t("sessions.untitled")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-stag" + (s.depth > 0 ? " sub" : "") }, s.depth > 0 ? t("sessions.subagent") : t("sessions.main")), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-smeta" }, date), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-scost" + (cents === null ? " is-unpriced" : ""), title: cents === null ? t("sessions.cost.none") : t("strip.estimate") }, cents === null ? "\u2014" : formatCost(cents)), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-stokens" }, fmtTokens(s.totals.total, locale)));
      }) : projects.map((row, i) => {
        const cents = billing === null ? null : totalCostCents(row.models, billing.prices, billing.peakValleyEnabled);
        return /* @__PURE__ */ React5.createElement("div", { key: i, className: "dsw-ust-srow" }, /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-srank" }, i + 1), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-sname", title: row.project ?? "" }, row.name), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-scost" + (cents === null ? " is-unpriced" : ""), title: cents === null ? t("sessions.cost.none") : t("strip.estimate") }, cents === null ? "\u2014" : formatCost(cents)), /* @__PURE__ */ React5.createElement("span", { className: "dsw-ust-stokens" }, fmtTokens(row.totals.total, locale)));
      }), hasMore && /* @__PURE__ */ React5.createElement(import_dsh_client_ui_primitives.Button, { size: "sm", className: "dsw-ust-more", onClick: () => fetchPage(kind === "sessions" ? sessions.length : projects.length, sort, true), disabled: loadingMore, loading: loadingMore }, t("sessions.more")));
      return /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement(
        import_dsh_client_ui_primitives.Modal,
        {
          open,
          onClose,
          title,
          closeLabel: t("billing.close"),
          className: "dsw-ust-modal",
          contentClassName: "dsw-ust-modal-content"
        },
        body
      ), open && appendError !== null && /* @__PURE__ */ React5.createElement(
        import_dsh_client_ui_primitives.Toast,
        {
          key: appendError.id,
          text: appendError.text,
          holdMs: null,
          dismissLabel: t("billing.close"),
          actions: [{ label: t("billing.retry"), onClick: () => fetchPage(kind === "sessions" ? sessions.length : projects.length, sort, true) }],
          onDone: () => setAppendError(null)
        }
      ));
    }

    // src/client/components/SessionsCard.tsx
    var React6 = __toESM(require("react"), 1);
    function SessionsCard({ sessions, i18n, rpc }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const billing = useBillingSettings(rpc);
      const [sort, setSort] = (0, import_react6.useState)("tokens");
      const [moreOpen, setMoreOpen] = (0, import_react6.useState)(false);
      const rows = sessions;
      return /* @__PURE__ */ React6.createElement("div", { className: "dsw-ust-card" }, /* @__PURE__ */ React6.createElement("div", { className: "dsw-ust-card-head" }, /* @__PURE__ */ React6.createElement("div", { className: "dsw-ust-card-title" }, /* @__PURE__ */ React6.createElement("h3", null, t("sessions.title")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-card-sub" }, t("sessions.sub"))), /* @__PURE__ */ React6.createElement("label", { className: "dsw-ust-sort" }, /* @__PURE__ */ React6.createElement("span", null, t("sort.by")), /* @__PURE__ */ React6.createElement("select", { value: sort, onChange: (e) => setSort(e.target.value) }, /* @__PURE__ */ React6.createElement("option", { value: "tokens" }, t("sort.tokens")), /* @__PURE__ */ React6.createElement("option", { value: "cost" }, t("sort.cost"))))), /* @__PURE__ */ React6.createElement("div", { className: "dsw-ust-table-head" }, /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-rank" }, "#"), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-session" }, t("sessions.hSession")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-type" }, t("sessions.hType")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-date" }, t("sessions.hActive")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-cost" }, t("sessions.hCost")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-th-tokens" }, t("sessions.hTokens"))), rows.map((s, i) => {
        const d = new Date(s.lastActive);
        const date = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
        const cents = billing === null ? null : sumCostCents(s.models.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled)));
        return /* @__PURE__ */ React6.createElement("div", { key: s.id, className: "dsw-ust-srow" }, /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-srank" }, i + 1), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-sname", title: s.id }, s.title || t("sessions.untitled")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-stag" + (s.depth > 0 ? " sub" : "") }, s.depth > 0 ? t("sessions.subagent") : t("sessions.main")), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-smeta" }, date), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-scost" + (cents === null ? " is-unpriced" : ""), title: cents === null ? t("sessions.cost.none") : t("strip.estimate") }, cents === null ? "\u2014" : formatCost(cents)), /* @__PURE__ */ React6.createElement("span", { className: "dsw-ust-stokens" }, fmtTokens(s.totals.total, locale)));
      }), rows.length > 0 && /* @__PURE__ */ React6.createElement("button", { type: "button", className: "dsw-ust-more", onClick: () => setMoreOpen(true) }, t("sessions.more")), /* @__PURE__ */ React6.createElement(MoreRankModal, { kind: "sessions", i18n, rpc, open: moreOpen, onClose: () => setMoreOpen(false) }));
    }

    // src/client/components/ProjectRankCard.tsx
    var import_react7 = require("react");
    var React7 = __toESM(require("react"), 1);
    function ProjectRankCard({ i18n, rpc }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const billing = useBillingSettings(rpc);
      const [sort, setSort] = (0, import_react7.useState)("tokens");
      const [rows, setRows] = (0, import_react7.useState)([]);
      const [loading, setLoading] = (0, import_react7.useState)(false);
      const [loadError, setLoadError] = (0, import_react7.useState)(null);
      const [moreOpen, setMoreOpen] = (0, import_react7.useState)(false);
      const fetchFirst = (nextSort) => {
        setLoading(true);
        setLoadError(null);
        callProjectPage(rpc, 0, nextSort).then((page) => {
          setRows(page.rows);
        }).catch((err) => {
          setLoadError(String(err?.message ?? err));
        }).finally(() => setLoading(false));
      };
      React7.useEffect(() => {
        fetchFirst(sort);
      }, [rpc, sort]);
      React7.useEffect(() => {
        if (loadError === null) return;
        const timer = setInterval(() => {
          fetchFirst(sort);
        }, 5e3);
        return () => clearInterval(timer);
      }, [loadError, sort]);
      return /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-card" }, /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-card-head" }, /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-card-title" }, /* @__PURE__ */ React7.createElement("h3", null, t("projects.title")), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-card-sub" }, t("projects.sub"))), /* @__PURE__ */ React7.createElement("label", { className: "dsw-ust-sort" }, /* @__PURE__ */ React7.createElement("span", null, t("sort.by")), /* @__PURE__ */ React7.createElement("select", { value: sort, onChange: (e) => setSort(e.target.value) }, /* @__PURE__ */ React7.createElement("option", { value: "tokens" }, t("sort.tokens")), /* @__PURE__ */ React7.createElement("option", { value: "cost" }, t("sort.cost"))))), /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-table-head" }, /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-th-rank" }, "#"), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-th-session" }, t("projects.hProject")), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-th-cost" }, t("projects.hCost")), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-th-tokens" }, t("projects.hTokens"))), loadError !== null && rows.length === 0 ? /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-bill-loading" }, /* @__PURE__ */ React7.createElement("div", null, t("billing.loadError", { msg: loadError })), /* @__PURE__ */ React7.createElement("button", { type: "button", className: "dsw-ust-bill-cancel", onClick: () => fetchFirst(sort) }, t("billing.retry"))) : loading && rows.length === 0 ? /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-empty" }, t("projects.loading")) : rows.length === 0 ? /* @__PURE__ */ React7.createElement("div", { className: "dsw-ust-empty" }, t("projects.empty")) : rows.map((row, i) => {
        const cents = billing === null ? null : totalCostCents(row.models, billing.prices, billing.peakValleyEnabled);
        return /* @__PURE__ */ React7.createElement("div", { key: i, className: "dsw-ust-srow" }, /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-srank" }, i + 1), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-sname", title: row.project ?? "" }, row.name), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-scost" + (cents === null ? " is-unpriced" : ""), title: cents === null ? t("sessions.cost.none") : t("strip.estimate") }, cents === null ? "\u2014" : formatCost(cents)), /* @__PURE__ */ React7.createElement("span", { className: "dsw-ust-stokens" }, fmtTokens(row.totals.total, locale)));
      }), /* @__PURE__ */ React7.createElement("button", { type: "button", className: "dsw-ust-more", onClick: () => setMoreOpen(true), disabled: rows.length === 0 }, t("sessions.more")), /* @__PURE__ */ React7.createElement(MoreRankModal, { kind: "projects", i18n, rpc, open: moreOpen, onClose: () => setMoreOpen(false) }));
    }

    // src/client/components/ProvidersCard.tsx
    var React8 = __toESM(require("react"), 1);
    function ProvidersCard({ providers, i18n }) {
      const locale = i18n.locale;
      if (!providers.length) return null;
      if (providers.length === 1 && (providers[0].id === "unknown" || providers[0].totals.total <= 0)) return null;
      if (providers.length === 1 && providers[0].id === "unknown") return null;
      const top = Math.max(1, providers[0].totals.total);
      return /* @__PURE__ */ React8.createElement("div", { className: "dsw-ust-card" }, /* @__PURE__ */ React8.createElement("h3", null, i18n.t("providers.title")), providers.map((p) => /* @__PURE__ */ React8.createElement("div", { key: p.id, className: "dsw-ust-prow" }, /* @__PURE__ */ React8.createElement("span", { className: "dsw-ust-pname", title: p.id }, p.name), /* @__PURE__ */ React8.createElement("div", { className: "dsw-ust-pbar" }, /* @__PURE__ */ React8.createElement("i", { style: { width: Math.max(2, Math.round(p.totals.total / top * 100)) + "%" } })), /* @__PURE__ */ React8.createElement("span", { className: "dsw-ust-ptokens" }, fmtTokens(p.totals.total, locale)))));
    }

    // src/client/components/ModelDonut.tsx
    var React9 = __toESM(require("react"), 1);
    function ModelDonut({ byModel, total, i18n, onTip }) {
      const t = i18n.t;
      const locale = i18n.locale;
      const rows = modelRows(byModel, t("donut.other"));
      const R = 70;
      const C = 2 * Math.PI * R;
      const segs = [];
      let acc = 0;
      for (const r of rows) {
        const frac = total ? r.total / total : 0;
        if (frac <= 0) continue;
        const len = frac * C;
        const rate = hitRate(r.buckets);
        segs.push(
          /* @__PURE__ */ React9.createElement(
            "circle",
            {
              key: r.model,
              cx: 90,
              cy: 90,
              r: R,
              fill: "none",
              className: "dsw-ust-donut-seg",
              stroke: r.rest ? "var(--dsw-alias-label-secondary)" : r.color,
              strokeOpacity: r.rest ? 0.45 : 1,
              strokeWidth: 24,
              strokeDasharray: len + " " + (C - len),
              strokeDashoffset: -acc,
              onMouseEnter: (e) => {
                onTip({
                  left: e.clientX,
                  top: e.clientY - 6,
                  title: r.model,
                  lines: [
                    { label: t("unit.tokens", { n: "" }).trim() || "Tokens", value: fmtTokens(r.total, locale) },
                    { label: t("donut.share"), value: pctOf(r.total, total) + "%", color: r.rest ? "var(--dsw-alias-label-secondary)" : r.color },
                    { label: t("donut.hitRate"), value: rate === null ? "\u2014" : pctFull(rate) + "%" }
                  ]
                });
              },
              onMouseLeave: () => onTip(null)
            }
          )
        );
        acc += len;
      }
      const listRows = rows.map((r) => {
        const rate = hitRate(r.buckets);
        return /* @__PURE__ */ React9.createElement("div", { key: r.model, className: "dsw-ust-mrow" }, /* @__PURE__ */ React9.createElement("i", { className: "dsw-ust-dot", style: { background: r.rest ? "var(--dsw-alias-label-secondary)" : r.color, opacity: r.rest ? 0.45 : 1 } }), /* @__PURE__ */ React9.createElement("span", { className: "dsw-ust-mname", title: r.model }, r.model), /* @__PURE__ */ React9.createElement("span", { className: "dsw-ust-mtokens" }, fmtTokens(r.total, locale)), /* @__PURE__ */ React9.createElement("span", { className: "dsw-ust-mpct" }, pctOf(r.total, total) + "%"), /* @__PURE__ */ React9.createElement("span", { className: "dsw-ust-mrate" }, rate === null ? "\u2014" : pctFull(rate) + "%"));
      });
      return /* @__PURE__ */ React9.createElement("div", { className: "dsw-ust-card" }, /* @__PURE__ */ React9.createElement("h3", null, t("donut.title")), /* @__PURE__ */ React9.createElement("div", { className: "dsw-ust-models" }, /* @__PURE__ */ React9.createElement("div", { className: "dsw-ust-donut" }, /* @__PURE__ */ React9.createElement("svg", { width: 180, height: 180, viewBox: "0 0 180 180" }, /* @__PURE__ */ React9.createElement("circle", { cx: 90, cy: 90, r: R, fill: "none", stroke: "var(--dsw-alias-bg-layer-2)", strokeWidth: 24 }), segs, /* @__PURE__ */ React9.createElement("text", { x: 90, y: 86, textAnchor: "middle", className: "dsw-ust-donut-total" }, fmtTokens(total, locale)), /* @__PURE__ */ React9.createElement("text", { x: 90, y: 106, textAnchor: "middle", className: "dsw-ust-donut-cap" }, t("donut.cap")))), /* @__PURE__ */ React9.createElement("div", { className: "dsw-ust-mlist" }, /* @__PURE__ */ React9.createElement("div", { className: "dsw-ust-mhead" }, /* @__PURE__ */ React9.createElement("span", { style: { width: 18, flexShrink: 0 } }), /* @__PURE__ */ React9.createElement("span", { className: "h-model" }, t("donut.model")), /* @__PURE__ */ React9.createElement("span", null, t("donut.tokens")), /* @__PURE__ */ React9.createElement("span", { className: "h-share" }, t("donut.share")), /* @__PURE__ */ React9.createElement("span", { className: "h-rate" }, t("donut.hitRate"))), listRows)));
    }

    // src/client/components/ExportMenu.tsx
    var import_react8 = require("react");
    var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

    // src/client/export.ts
    function csvCell(value) {
      let text = String(value);
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
      return text;
    }
    function phaseCost(row, price, phase) {
      const usage = phase === "peak" ? { peak: billedBucketsOf(row.peak), offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 } } : { peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, offPeak: billedBucketsOf(row.offPeak) };
      return computeBilledCost(usage, price);
    }
    function rowCost(phase, provider, model, prices, peakValley) {
      const price = resolveModelPrice(provider, model, prices);
      if (price === null) return { peak: null, idle: null, total: null };
      const effective = peakValley ? price : { ...price, idle: price.peak };
      return {
        peak: phaseCost(phase, effective, "peak"),
        idle: phaseCost(phase, effective, "offPeak"),
        total: phaseCost(phase, effective, "peak") + phaseCost(phase, effective, "offPeak")
      };
    }
    function buildDailyCsv(days, prices = {}, peakValley = true, modelProviders = {}) {
      const rows = ["date,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents"];
      for (const d of days) {
        let input = 0;
        let output = 0;
        let cacheRead = 0;
        let cacheWrite = 0;
        let peak = null;
        let idle = null;
        let total = null;
        for (const model of Object.keys(d.models)) {
          const m = d.models[model];
          input += m.input;
          output += m.output;
          cacheRead += m.cacheRead;
          cacheWrite += m.cacheWrite;
          const phase = d.modelCosts[model];
          if (phase === void 0) continue;
          const row = rowCost(phase, modelProviders[model] ?? null, model, prices, peakValley);
          if (row.total === null) continue;
          peak = (peak ?? 0) + row.peak;
          idle = (idle ?? 0) + row.idle;
          total = (total ?? 0) + row.total;
        }
        if (input + output + cacheRead + cacheWrite <= 0) continue;
        rows.push(
          [
            csvCell(d.date),
            csvCell(input + output),
            csvCell(input),
            csvCell(output),
            csvCell(cacheRead),
            csvCell(cacheWrite),
            csvCell(peak === null ? "" : peak),
            csvCell(idle === null ? "" : idle),
            csvCell(total === null ? "" : total)
          ].join(",")
        );
      }
      return "\uFEFF" + rows.join("\n");
    }
    function buildModelCsv(byModel, prices = {}, peakValley = true) {
      const rows = ["model,provider,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents"];
      for (const m of byModel) {
        const cost = rowCost(m.cost, m.provider, m.model, prices, peakValley);
        rows.push(
          [
            csvCell(m.model),
            csvCell(m.provider),
            csvCell(m.input + m.output),
            csvCell(m.input),
            csvCell(m.output),
            csvCell(m.cacheRead),
            csvCell(m.cacheWrite),
            csvCell(cost.peak === null ? "" : cost.peak),
            csvCell(cost.idle === null ? "" : cost.idle),
            csvCell(cost.total === null ? "" : cost.total)
          ].join(",")
        );
      }
      return "\uFEFF" + rows.join("\n");
    }
    function buildJson(overview) {
      return JSON.stringify(overview, null, 2);
    }
    function download(filename, content, mime) {
      const blob = new Blob([content], { type: mime + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.hidden = true;
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      }
    }

    // src/client/components/ExportMenu.tsx
    var React10 = __toESM(require("react"), 1);
    function ExportMenu({ overview, i18n, rpc }) {
      const t = i18n.t;
      const [open, setOpen] = (0, import_react8.useState)(false);
      const [failure, setFailure] = (0, import_react8.useState)(null);
      const failureId = React10.useRef(0);
      const billing = useBillingSettings(rpc);
      const prices = billing === null ? {} : billing.prices;
      const peakValley = billing === null ? true : billing.peakValleyEnabled;
      const modelProviders = Object.fromEntries(overview.allTime.byModel.map((m) => [m.model, m.provider]));
      const run = (kind) => {
        setFailure(null);
        try {
          if (kind === "json") download(t("export.file.json"), buildJson(overview), "application/json");
          else if (kind === "daily") download(t("export.file.daily"), buildDailyCsv(overview.days, prices, peakValley, modelProviders), "text/csv");
          else download(t("export.file.models"), buildModelCsv(overview.byModel, prices, peakValley), "text/csv");
        } catch (err) {
          setFailure({ id: ++failureId.current, text: t("export.failed", { msg: String(err?.message ?? err) }) });
        } finally {
          setOpen(false);
        }
      };
      return /* @__PURE__ */ React10.createElement(React10.Fragment, null, /* @__PURE__ */ React10.createElement(
        import_dsh_client_ui_primitives2.Menu,
        {
          open,
          align: "end",
          portal: true,
          anchor: /* @__PURE__ */ React10.createElement(import_dsh_client_ui_primitives2.Button, { variant: "outline", size: "sm", onClick: () => setOpen((v) => !v) }, t("export.button")),
          items: [
            { id: "json", label: t("export.json") },
            { id: "daily", label: t("export.daily") },
            { id: "models", label: t("export.models") }
          ],
          onSelect: (id) => {
            if (id === "json" || id === "daily" || id === "models") run(id);
          },
          onClose: () => setOpen(false)
        }
      ), failure !== null && /* @__PURE__ */ React10.createElement(
        import_dsh_client_ui_primitives2.Toast,
        {
          key: failure.id,
          text: failure.text,
          holdMs: null,
          dismissLabel: t("billing.close"),
          onDone: () => setFailure(null)
        }
      ));
    }

    // src/client/BillingSettingsModal.tsx
    var React11 = __toESM(require("react"), 1);
    var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

    // src/client/billing-buffer.ts
    var EMPTY_BUFFER = {
      hit: "",
      miss: "",
      out: "",
      idleChecked: false,
      idleHit: "",
      idleMiss: "",
      idleOut: ""
    };
    function seedPriceBuffer(custom, official) {
      if (custom === void 0) {
        if (official === null) return { ...EMPTY_BUFFER };
        return {
          hit: priceText(official.peak.inputCacheHit),
          miss: priceText(official.peak.inputCacheMiss),
          out: priceText(official.peak.output),
          idleChecked: true,
          idleHit: priceText(official.idle.inputCacheHit),
          idleMiss: priceText(official.idle.inputCacheMiss),
          idleOut: priceText(official.idle.output)
        };
      }
      const peak = {
        hit: priceText(custom.inputCacheHit),
        miss: priceText(custom.inputCacheMiss),
        out: priceText(custom.output)
      };
      if (custom.flat === true) {
        return { ...EMPTY_BUFFER, idleHit: peak.hit, idleMiss: peak.miss, idleOut: peak.out };
      }
      const idle = custom.idle !== void 0 ? { hit: priceText(custom.idle.inputCacheHit), miss: priceText(custom.idle.inputCacheMiss), out: priceText(custom.idle.output) } : { hit: priceText(custom.inputCacheHit / 2), miss: priceText(custom.inputCacheMiss / 2), out: priceText(custom.output / 2) };
      return { ...peak, idleChecked: true, idleHit: idle.hit, idleMiss: idle.miss, idleOut: idle.out };
    }

    // src/client/BillingSettingsModal.tsx
    function rowKey(provider, model) {
      return compositePriceKey(provider, model);
    }
    function validPrice(value) {
      if (value.trim() === "") return false;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0;
    }
    function defaultPrice(provider, model) {
      return resolveModelPrice(provider, model, {});
    }
    function withClientTimeout(source, ms, label) {
      source.catch(() => {
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(label + " timed out")), ms);
        source.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          }
        );
      });
    }
    function BillingSettingsModal({ rpc, i18n, open, onClose }) {
      const t = i18n.t;
      const [settings, setSettings] = React11.useState(() => currentBilling());
      const [options, setOptions] = React11.useState({ options: [] });
      const [providerId, setProviderId] = React11.useState("");
      const [modelName, setModelName] = React11.useState("");
      const [buffer, setBuffer] = React11.useState({ ...EMPTY_BUFFER });
      const [feedback, setFeedback] = React11.useState(null);
      const [dismissedFeedbackId, setDismissedFeedbackId] = React11.useState(null);
      const feedbackId = React11.useRef(0);
      const [validationAttempted, setValidationAttempted] = React11.useState(false);
      const [loading, setLoading] = React11.useState(false);
      const [loadError, setLoadError] = React11.useState(null);
      const [loadNonce, setLoadNonce] = React11.useState(0);
      const [savingAction, setSavingAction] = React11.useState(null);
      const saving = savingAction !== null;
      const showFeedback = (text, success = false) => {
        setFeedback({ id: ++feedbackId.current, text, success });
      };
      const bumpLoad = () => setLoadNonce((n) => n + 1);
      React11.useEffect(() => {
        if (!open) return;
        let disposed = false;
        const snapshot2 = currentBilling();
        setLoadError(null);
        setFeedback(null);
        setValidationAttempted(false);
        setOptions({ options: [] });
        setProviderId("");
        setModelName("");
        setBuffer({ ...EMPTY_BUFFER });
        if (snapshot2 !== null) {
          setSettings(snapshot2);
          setLoading(false);
        } else {
          setSettings(null);
          setLoading(true);
        }
        withClientTimeout(callBillingGet(rpc), 6e3, "billing settings").then((current) => {
          if (disposed) return;
          publishBilling(current);
          setSettings(current);
          setLoading(false);
        }).catch((err) => {
          if (disposed) return;
          if (currentBilling() === null) {
            setLoadError(String(err?.message ?? err));
            setLoading(false);
          }
        });
        callBillingModels(rpc).then((modelOptions) => {
          if (!disposed) setOptions(modelOptions);
        }).catch(() => {
          if (!disposed) setOptions({ options: [] });
        });
        return () => {
          disposed = true;
        };
      }, [rpc, open, loadNonce]);
      React11.useEffect(() => {
        if (!open || options.options.length === 0) return;
        setProviderId((prev) => prev !== "" ? prev : options.options[0].provider);
      }, [open, options]);
      const providerOptions = React11.useMemo(() => {
        const map = /* @__PURE__ */ new Map();
        for (const option of options.options) {
          map.set(option.provider, { ...option, models: [...option.models] });
        }
        if (settings !== null) {
          for (const key of Object.keys(settings.prices)) {
            const provider = key.includes("/") ? key.slice(0, key.indexOf("/")) : "(unknown)";
            if (!map.has(provider)) map.set(provider, { provider, providerName: provider, models: [] });
          }
        }
        if (map.size === 0) map.set("(unknown)", { provider: "(unknown)", providerName: "(unknown)", models: [] });
        return [...map.values()];
      }, [options, settings]);
      const providerModels = React11.useMemo(() => {
        const option = providerOptions.find((p) => p.provider === providerId);
        return option ? option.models : [];
      }, [providerOptions, providerId]);
      const selectModel = (provider, model) => {
        setProviderId(provider);
        setModelName(model);
        setFeedback(null);
        setValidationAttempted(false);
        const custom = settings?.prices[rowKey(provider, model)] ?? settings?.prices[model];
        setBuffer(seedPriceBuffer(custom, defaultPrice(provider, model)));
      };
      React11.useEffect(() => {
        if (!open || modelName !== "" || providerId === "") return;
        const first = providerModels[0];
        if (first === void 0) return;
        selectModel(providerId, first);
      }, [open, modelName, providerId, providerModels]);
      const toggleIdle = (checked) => {
        setFeedback(null);
        if (!checked) {
          setBuffer({ ...buffer, idleChecked: false });
          return;
        }
        const double = (n) => n.trim() === "" ? "" : String(Number(n) * 2);
        setBuffer({
          ...buffer,
          idleChecked: true,
          hit: buffer.hit === "" ? double(buffer.idleHit) : buffer.hit,
          miss: buffer.miss === "" ? double(buffer.idleMiss) : buffer.miss,
          out: buffer.out === "" ? double(buffer.idleOut) : buffer.out
        });
      };
      const switchProvider = (provider) => {
        const first = providerOptions.find((p) => p.provider === provider)?.models[0];
        setFeedback(null);
        setValidationAttempted(false);
        if (first === void 0) {
          setProviderId(provider);
          setModelName("");
          setBuffer({ ...EMPTY_BUFFER });
          return;
        }
        selectModel(provider, first);
      };
      const commitModel = (close) => {
        if (settings === null || saving) return;
        setFeedback(null);
        if (modelName === "") {
          if (!close) return;
          setSavingAction("save");
          callBillingSet(rpc, settings).then((saved) => {
            publishBilling(saved);
            setSettings(saved);
            onClose();
          }).catch((err) => {
            showFeedback(t("billing.saveError", { msg: String(err?.message ?? err) }));
          }).finally(() => setSavingAction(null));
          return;
        }
        const key = rowKey(providerId, modelName);
        setValidationAttempted(true);
        if (buffer.idleChecked && (!validPrice(buffer.hit) || !validPrice(buffer.miss) || !validPrice(buffer.out))) {
          showFeedback(t("billing.err.invalidPrice", { key: modelName }));
          return;
        }
        if (!validPrice(buffer.idleHit) || !validPrice(buffer.idleMiss) || !validPrice(buffer.idleOut)) {
          showFeedback(t(buffer.idleChecked ? "billing.err.invalidIdle" : "billing.err.invalidSingle", { key: modelName }));
          return;
        }
        const prices = { ...settings.prices };
        const def = defaultPrice(providerId, modelName);
        const unchanged = def !== null && buffer.idleChecked && Number(buffer.idleHit) === def.idle.inputCacheHit && Number(buffer.idleMiss) === def.idle.inputCacheMiss && Number(buffer.idleOut) === def.idle.output && Number(buffer.hit) === def.peak.inputCacheHit && Number(buffer.miss) === def.peak.inputCacheMiss && Number(buffer.out) === def.peak.output;
        if (unchanged) {
          delete prices[key];
          delete prices[modelName];
        } else if (buffer.idleChecked) {
          delete prices[modelName];
          prices[key] = {
            inputCacheHit: Number(buffer.hit),
            inputCacheMiss: Number(buffer.miss),
            output: Number(buffer.out),
            idle: { inputCacheHit: Number(buffer.idleHit), inputCacheMiss: Number(buffer.idleMiss), output: Number(buffer.idleOut) }
          };
        } else {
          delete prices[modelName];
          const flat = {
            inputCacheHit: Number(buffer.idleHit),
            inputCacheMiss: Number(buffer.idleMiss),
            output: Number(buffer.idleOut)
          };
          prices[key] = { ...flat, idle: { ...flat }, flat: true };
        }
        setSavingAction(close ? "save" : "commit");
        callBillingSet(rpc, { ...settings, prices }).then((saved) => {
          publishBilling(saved);
          setSettings(saved);
          if (close) onClose();
          else showFeedback(t("billing.updated", { model: modelName }), true);
        }).catch((err) => {
          showFeedback(t("billing.saveError", { msg: String(err?.message ?? err) }));
        }).finally(() => setSavingAction(null));
      };
      const save = () => commitModel(true);
      const addUpdate = () => commitModel(false);
      const peakValley = settings?.peakValleyEnabled !== false;
      const idleInvalidReason = t(buffer.idleChecked ? "billing.err.invalidIdle" : "billing.err.invalidSingle", { key: modelName });
      const peakInvalidReason = t("billing.err.invalidPrice", { key: modelName });
      const editPrice = (field, value) => {
        setFeedback(null);
        setBuffer({ ...buffer, [field]: value });
      };
      const body = loadError !== null ? /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-loading" }, /* @__PURE__ */ React11.createElement("div", null, t("billing.loadError", { msg: loadError })), /* @__PURE__ */ React11.createElement("button", { type: "button", onClick: bumpLoad, className: "dsw-ust-bill-cancel" }, t("billing.retry"))) : loading || settings === null ? /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-loading" }, t("billing.loading")) : /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill" }, /* @__PURE__ */ React11.createElement("section", { className: "dsw-ust-bill-section" }, /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-section-head" }, /* @__PURE__ */ React11.createElement("h4", null, t("billing.modelsTitle"))), /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-pick" }, /* @__PURE__ */ React11.createElement("label", { className: "dsw-ust-bill-select" }, /* @__PURE__ */ React11.createElement("span", null, t("billing.providerLabel")), /* @__PURE__ */ React11.createElement(
        "select",
        {
          value: providerId,
          disabled: saving,
          onChange: (e) => switchProvider(e.target.value)
        },
        providerOptions.map((option) => /* @__PURE__ */ React11.createElement("option", { key: option.provider, value: option.provider }, option.providerName))
      )), /* @__PURE__ */ React11.createElement("label", { className: "dsw-ust-bill-select" }, /* @__PURE__ */ React11.createElement("span", null, t("billing.modelLabel")), /* @__PURE__ */ React11.createElement(
        "select",
        {
          value: modelName,
          disabled: saving,
          onChange: (e) => selectModel(providerId, e.target.value)
        },
        providerModels.map((model) => /* @__PURE__ */ React11.createElement("option", { key: model, value: model }, model))
      )), peakValley && /* @__PURE__ */ React11.createElement("label", { className: "dsw-ust-bill-switch-inline" }, /* @__PURE__ */ React11.createElement("span", null, t("billing.idleToggle")), /* @__PURE__ */ React11.createElement(
        import_dsh_client_ui_primitives3.Switch,
        {
          checked: buffer.idleChecked,
          disabled: saving,
          onChange: (e) => toggleIdle(e.target.checked)
        }
      ))), /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-prices", "data-period": "idle" }, /* @__PURE__ */ React11.createElement("span", { className: buffer.idleChecked ? "dsw-ust-bill-period is-idle" : "dsw-ust-bill-period" }, buffer.idleChecked ? t("billing.periodIdle") : t("billing.periodSingle")), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.hit"), value: buffer.idleHit, onChange: (v) => editPrice("idleHit", v), validationAttempted, invalidReason: idleInvalidReason, disabled: saving }), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.miss"), value: buffer.idleMiss, onChange: (v) => editPrice("idleMiss", v), validationAttempted, invalidReason: idleInvalidReason, disabled: saving }), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.out"), value: buffer.idleOut, onChange: (v) => editPrice("idleOut", v), validationAttempted, invalidReason: idleInvalidReason, disabled: saving })), buffer.idleChecked && /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-prices" }, /* @__PURE__ */ React11.createElement("span", { className: "dsw-ust-bill-period is-peak" }, t("billing.periodPeak")), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.hit"), value: buffer.hit, onChange: (v) => editPrice("hit", v), validationAttempted, invalidReason: peakInvalidReason, disabled: saving }), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.miss"), value: buffer.miss, onChange: (v) => editPrice("miss", v), validationAttempted, invalidReason: peakInvalidReason, disabled: saving }), /* @__PURE__ */ React11.createElement(PriceInput, { label: t("billing.out"), value: buffer.out, onChange: (v) => editPrice("out", v), validationAttempted, invalidReason: peakInvalidReason, disabled: saving })), /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-commit-row" }, /* @__PURE__ */ React11.createElement(import_dsh_client_ui_primitives3.Button, { size: "sm", className: "dsw-ust-bill-commit", onClick: addUpdate, disabled: saving || modelName === "", loading: savingAction === "commit" }, t("billing.commit")))));
      return /* @__PURE__ */ React11.createElement(React11.Fragment, null, /* @__PURE__ */ React11.createElement(
        import_dsh_client_ui_primitives3.Modal,
        {
          open,
          onClose: () => {
            if (!saving) onClose();
          },
          title: t("billing.title"),
          closeLabel: t("billing.close"),
          className: "dsw-ust-modal",
          contentClassName: "dsw-ust-modal-content",
          footer: /* @__PURE__ */ React11.createElement("div", { className: "dsw-ust-bill-footer" }, /* @__PURE__ */ React11.createElement("button", { type: "button", className: "dsw-ust-bill-cancel", onClick: onClose, disabled: saving }, t("billing.close")), /* @__PURE__ */ React11.createElement(import_dsh_client_ui_primitives3.Button, { size: "sm", className: "dsw-ust-bill-save", onClick: save, disabled: saving || loading, loading: savingAction === "save" }, t("billing.save")))
        },
        body
      ), open && feedback !== null && feedback.id !== dismissedFeedbackId && /* @__PURE__ */ React11.createElement(
        import_dsh_client_ui_primitives3.Toast,
        {
          key: feedback.id,
          text: feedback.text,
          tone: feedback.success ? "success" : void 0,
          holdMs: feedback.success ? void 0 : null,
          dismissLabel: t("billing.close"),
          onDone: () => setDismissedFeedbackId(feedback.id)
        }
      ));
    }
    function PriceInput({ label, value, onChange, validationAttempted, invalidReason, disabled }) {
      const invalid = (validationAttempted || value !== "") && !validPrice(value);
      return /* @__PURE__ */ React11.createElement("label", { className: "dsw-ust-bill-input" }, /* @__PURE__ */ React11.createElement("span", null, label), /* @__PURE__ */ React11.createElement(
        "input",
        {
          value,
          disabled,
          inputMode: "decimal",
          placeholder: "0.00",
          onChange: (e) => onChange(e.target.value),
          className: invalid ? "is-bad" : value === "" ? "" : "is-ok",
          "aria-invalid": invalid,
          title: invalid ? invalidReason : void 0
        }
      ));
    }

    // src/client/StatsSection.tsx
    var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
    var React12 = __toESM(require("react"), 1);
    function sourceNote(overview, t) {
      const coverage = overview.coverage;
      const magpie = coverage ? coverage.magpie : void 0;
      if (coverage && coverage.source === "magpie" && magpie) {
        return {
          text: t("source.magpie", {
            calls: magpie.calls,
            from: magpie.from === null ? "\u2014" : dayKeyUTC(magpie.from),
            to: magpie.to === null ? "\u2014" : dayKeyUTC(magpie.to)
          }),
          title: magpie.file
        };
      }
      return { text: t("source.logs") };
    }
    function StatsSection(props) {
      if (props.indexOnly) {
        const t = props.i18n.t;
        return /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-root" }, props.settingsRows, ["nav.label", "billing.title", "heat.title", "bar.title", "donut.title", "sessions.title", "projects.title", "providers.title", "refresh.title"].map((key) => /* @__PURE__ */ React12.createElement("div", { key }, /* @__PURE__ */ React12.createElement("h3", null, t(key)), /* @__PURE__ */ React12.createElement("p", null, t("nav.label")))));
      }
      return /* @__PURE__ */ React12.createElement(StatsContent, { ...props });
    }
    function StatsContent({ rpc, i18n: baseI18n, settingsRows }) {
      const i18n = useI18n(baseI18n);
      const t = i18n.t;
      const locale = i18n.locale;
      const [data, setData] = (0, import_react9.useState)(null);
      const [loading, setLoading] = (0, import_react9.useState)(false);
      const [error, setError] = (0, import_react9.useState)(null);
      const [freshness, setFreshness] = (0, import_react9.useState)("loading");
      const [barTip, setBarTip] = (0, import_react9.useState)(null);
      const [donutTip, setDonutTip] = (0, import_react9.useState)(null);
      const [heatTip, setHeatTip] = (0, import_react9.useState)(null);
      const [billingOpen, setBillingOpen] = (0, import_react9.useState)(false);
      const [repairing, setRepairing] = (0, import_react9.useState)(false);
      const [repairFeedback, setRepairFeedback] = (0, import_react9.useState)(null);
      const repairFeedbackId = React12.useRef(0);
      const billing = useBillingSettings(rpc);
      const dataRef = useLatest(data);
      const [overviewRequests] = (0, import_react9.useState)(createOverviewRequests);
      const repairFirst = () => {
        const targets = data?.coverage.failedSessionIds ?? [];
        if (targets.length === 0 || repairing) return;
        setRepairing(true);
        setRepairFeedback(null);
        const chain = targets.reduce(
          (acc, id) => acc.then((count) => callRepairSession(rpc, id).then((result) => count + result.repaired)),
          Promise.resolve(0)
        );
        chain.then((total) => {
          return load(true).then((fresh) => {
            const success = fresh !== void 0 && fresh.coverage.failedSessionIds.length === 0;
            const text = fresh === void 0 ? t("status.repairRefreshFailed", { count: total }) : success ? t("status.repairDone", { count: total }) : t("status.repairStill");
            setRepairFeedback({ id: ++repairFeedbackId.current, text, success });
          });
        }).catch((err) => {
          setRepairFeedback({ id: ++repairFeedbackId.current, text: t("status.repairFailed", { msg: String(err?.message ?? err) }), success: false });
        }).finally(() => setRepairing(false));
      };
      const load = (0, import_react9.useCallback)(
        (force) => {
          const isCurrent = overviewRequests.begin();
          setLoading(true);
          setError(null);
          return callOverview(rpc, force, (res) => {
            if (!isCurrent()) return;
            setData(res);
            setError(null);
            setFreshness(res.stale ? "stale" : "fresh");
            setLoading(false);
            saveCached(res);
          }).then((res) => isCurrent() ? res : void 0).catch((err) => {
            if (!isCurrent()) return void 0;
            const msg = String(err?.message ?? err);
            setError(msg);
            setFreshness(dataRef.current ? "fallback" : "error");
            return void 0;
          }).finally(() => {
            if (isCurrent()) setLoading(false);
          });
        },
        [rpc, dataRef, overviewRequests]
      );
      (0, import_react9.useEffect)(() => {
        const cached = loadCached();
        if (cached) {
          setData(cached.payload);
          setFreshness("fresh");
        }
        load(false);
        return () => overviewRequests.invalidate();
      }, [load]);
      const allTime = data && data.allTime || { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, sessionCount: 0, byModel: [] };
      const allTimeTotal = allTime.totals.total || 0;
      const recentByModel = data && data.byModel || [];
      const days = data && data.days || [];
      let subText = null;
      if (!data && !error) subText = t("status.loading");
      else if (data) {
        const time = formatClock(data.updatedAt || Date.now(), locale);
        if (freshness === "stale") subText = t("status.stale", { time });
        else if (freshness === "fallback") subText = t("status.fallback", { time });
        else subText = t("status.fresh", { time });
      } else if (error) {
        subText = t("status.error", { msg: error });
      }
      const source = data ? sourceNote(data, t) : null;
      let body;
      if (!data && !error) {
        body = /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-empty" }, /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-empty-title" }, t("status.loading")), /* @__PURE__ */ React12.createElement("div", null, t("status.loading.hint")));
      } else if (error && !data) {
        body = /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-empty" }, t("status.error", { msg: error }));
      } else if (data && isUsageEmpty(data)) {
        body = /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-empty" }, /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-empty-title" }, t("empty.title")), /* @__PURE__ */ React12.createElement("div", null, t("empty.hint")));
      } else {
        const overview = data;
        const modelProviders = Object.fromEntries(overview.allTime.byModel.map((m) => [m.model, m.provider]));
        body = /* @__PURE__ */ React12.createElement(React12.Fragment, null, /* @__PURE__ */ React12.createElement(KpiCards, { overview, i18n, rpc }), /* @__PURE__ */ React12.createElement(
          Heatmap,
          {
            days,
            i18n,
            onTip: setHeatTip,
            prices: billing?.prices,
            peakValley: billing?.peakValleyEnabled !== false,
            modelProviders
          }
        ), /* @__PURE__ */ React12.createElement(BarChart, { days, byModel: recentByModel, i18n, onTip: setBarTip }), /* @__PURE__ */ React12.createElement(SessionsCard, { sessions: overview.topSessions, i18n, rpc }), !loading && freshness === "fresh" && /* @__PURE__ */ React12.createElement(ProjectRankCard, { key: overview.updatedAt, i18n, rpc }), /* @__PURE__ */ React12.createElement(ProvidersCard, { providers: overview.providers, i18n }), /* @__PURE__ */ React12.createElement(ModelDonut, { byModel: allTime.byModel, total: allTimeTotal, i18n, onTip: setDonutTip }));
      }
      return /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-root" }, /* @__PURE__ */ React12.createElement(Tooltip, { tip: barTip }), /* @__PURE__ */ React12.createElement(Tooltip, { tip: donutTip }), /* @__PURE__ */ React12.createElement(Tooltip, { tip: heatTip }), /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-head" }, /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-head-title" }, /* @__PURE__ */ React12.createElement("svg", { className: "dsw-ust-page-icon", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", "aria-hidden": "true" }, /* @__PURE__ */ React12.createElement("path", { d: "M3 13V9.5" }), /* @__PURE__ */ React12.createElement("path", { d: "M8 13V5.5" }), /* @__PURE__ */ React12.createElement("path", { d: "M13 13V3" }), /* @__PURE__ */ React12.createElement("path", { d: "M2 13.5h12" })), /* @__PURE__ */ React12.createElement("div", null, /* @__PURE__ */ React12.createElement("h2", null, t("nav.label")), subText ? /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-sub" }, subText) : null, source ? /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-source", title: source.title }, source.text) : null, data && data.coverage.failedSessionIds.length > 0 && /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-repair" }, /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-repair-row" }, /* @__PURE__ */ React12.createElement("span", { className: "dsw-ust-repair-hint" }, t("status.repairHint", { count: data.coverage.failedSessionIds.length })), /* @__PURE__ */ React12.createElement(import_dsh_client_ui_primitives4.Button, { size: "sm", className: "dsw-ust-more", onClick: repairFirst, disabled: repairing, loading: repairing }, t("status.repair")))))), /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-head-actions" }, data ? /* @__PURE__ */ React12.createElement(ExportMenu, { overview: data, i18n, rpc }) : null, /* @__PURE__ */ React12.createElement(
        import_dsh_client_ui_primitives4.Button,
        {
          variant: "outline",
          size: "sm",
          onClick: () => setBillingOpen(true),
          title: t("billing.title"),
          icon: /* @__PURE__ */ React12.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ React12.createElement("circle", { cx: "12", cy: "12", r: "3" }), /* @__PURE__ */ React12.createElement("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" }))
        },
        t("billing.button")
      ), /* @__PURE__ */ React12.createElement(
        import_dsh_client_ui_primitives4.Button,
        {
          variant: "outline",
          size: "sm",
          onClick: () => load(true),
          disabled: loading,
          loading,
          title: t("refresh.title"),
          icon: /* @__PURE__ */ React12.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, /* @__PURE__ */ React12.createElement("path", { d: "M21 12a9 9 0 1 1-2.64-6.36" }), /* @__PURE__ */ React12.createElement("polyline", { points: "21 3 21 9 15 9" }))
        },
        t("refresh.button")
      ))), settingsRows ? /* @__PURE__ */ React12.createElement("div", { className: "dsw-ust-settings" }, settingsRows) : null, body, /* @__PURE__ */ React12.createElement(BillingSettingsModal, { rpc, i18n, open: billingOpen, onClose: () => setBillingOpen(false) }), repairFeedback !== null && /* @__PURE__ */ React12.createElement(
        import_dsh_client_ui_primitives4.Toast,
        {
          key: repairFeedback.id,
          text: repairFeedback.text,
          tone: repairFeedback.success ? "success" : void 0,
          holdMs: repairFeedback.success ? void 0 : null,
          dismissLabel: t("billing.close"),
          onDone: () => setRepairFeedback(null)
        }
      ));
    }

    // src/client/boundary.tsx
    var import_react10 = require("react");
    var React13 = __toESM(require("react"), 1);
    var Boundary = class extends import_react10.Component {
      state = { error: null };
      static getDerivedStateFromError(err) {
        return { error: String(err?.message ?? err) };
      }
      componentDidCatch(err) {
        console.error("[dsh-usage-panel] render crashed:", err);
      }
      reset = () => {
        clearCached();
        this.setState({ error: null });
      };
      render() {
        const t = this.props.i18n.t;
        if (this.state.error !== null) {
          return /* @__PURE__ */ React13.createElement("div", { className: "dsw-ust-empty" }, /* @__PURE__ */ React13.createElement("div", { className: "dsw-ust-empty-title" }, t("error.title")), /* @__PURE__ */ React13.createElement("div", { style: { margin: "6px 0 12px" } }, t("error.detail", { msg: this.state.error })), /* @__PURE__ */ React13.createElement("button", { className: "dsw-ust-refresh", onClick: this.reset }, t("error.reset")));
        }
        return this.props.children;
      }
    };

    // src/client/primitives.ts
    var REQUIRED_PRIMITIVES = ["Button", "Menu", "Modal", "Switch", "Toast"];
    function missingPrimitives(mod) {
      const src = mod || {};
      return REQUIRED_PRIMITIVES.filter((name) => src[name] === void 0);
    }

    // src/client/index.tsx
    var inject = ["slots", "connection", "locale"];
    function apply(ctx) {
      const gaps = missingPrimitives(uiPrimitives);
      if (gaps.length) {
        console.warn(
          "[dsh-usage-panel] host ui-primitives missing " + gaps.join(", ") + " \u2014 usage-stats section disabled"
        );
        return;
      }
      callBillingGet(ctx.connection.rpc).then((settings) => publishBilling(settings)).catch(() => {
      });
      let tag = null;
      if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
        tag = document.createElement("style");
        tag.dataset.plugin = "dsh-usage-panel";
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      }
      const i18n = createI18n(ctx.locale);
      const disposeLocaleEvent = ctx.on ? ctx.on("locale/change", () => i18n.update()) : null;
      const slots = ctx.slots;
      slots.inject(
        "settings.section",
        () => slots.register(
          {
            name: "settings.section",
            id: "usage-stats",
            order: 25,
            label: () => i18n.t("nav.label"),
            // The session cost and peak/valley switches (ui-conversation) sit
            // above the statistics they relate to.
            children: { "settings.usage.item": { kind: "list", scope: "root" } }
          },
          (props) => (0, import_react11.createElement)(
            Boundary,
            { i18n },
            (0, import_react11.createElement)(StatsSection, {
              rpc: ctx.connection.rpc,
              i18n,
              indexOnly: props?.indexOnly,
              settingsRows: props?.renderSlot?.("settings.usage.item", {})
            })
          )
        )
      );
      ctx.effect(() => () => {
        if (tag !== null && tag.isConnected) tag.remove();
        if (disposeLocaleEvent) disposeLocaleEvent();
        i18n.dispose();
      });
    }

    return module.exports
  }
})
