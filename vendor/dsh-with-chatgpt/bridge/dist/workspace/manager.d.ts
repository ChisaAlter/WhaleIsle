// checkJs 用的入库声明（#438）：lib/index.js 通过相对路径导入
// ../bridge/dist/workspace/manager.js，而 bridge/dist 是可选构建产物。
// tsc 对 .js 导入优先解析同名 .d.ts，本文件让构建产物存在与否解析结果
// 一致；只声明 lib/tests 实际用到的 API，完整实现见
// bridge/src/workspace/manager.ts。
export declare class Workspace {
  readonly root: string;
  readonly id: string;
  readonly name: string;
  constructor(rootInput: string);
  resolve(requested: string, opts?: { allowSensitive?: boolean }): { abs: string; rel: string };
}
