// checkJs 用的入库声明（#438）：playwright-core 是 dsh-with-chatgpt 的
// 可选依赖，装在插件自己的 node_modules（npm run setup 生成），未安装时
// lib/browser.js 报 TS2307，基线随环境漂移。tsconfig.check.json 的 paths
// 始终优先把 playwright-core 指到本文件；只声明 lib/browser.js 实际用到
// 的 API。
export declare const chromium: {
  executablePath(): string;
  launchPersistentContext(userDataDir: string, options?: object): Promise<any>;
};
