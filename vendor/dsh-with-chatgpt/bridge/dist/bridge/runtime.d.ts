// checkJs/knip 用的入库声明（#438）：tests 通过相对路径导入
// ../bridge/dist/bridge/runtime.js，而 bridge/dist 是可选构建产物。
// tsc 对 .js 导入优先解析同名 .d.ts，本文件让构建产物存在与否解析结果
// 一致；只声明实际用到的 API，完整实现见 bridge/src/bridge/runtime.ts。
export declare interface RuntimeState {
  service: string;
  version: string;
  workspaceId: string;
  workspaceRoot: string;
  pid: number;
  port: number;
  adminToken: string;
  publicUrl: string | null;
  startedAt: string;
}
export declare function readRuntimeState(workspaceId: string): RuntimeState | null;
export declare function findLiveBridge(workspaceId: string): Promise<RuntimeState | null>;
