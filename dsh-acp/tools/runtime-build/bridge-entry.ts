// Vendored ACP runtime ACP MCP stdio bridge CLI — same role as `providers acp-mcp-bridge`
// and `providers acp-mcp-call` inside ACP's own binary.
import { runAcpMcpCliFastPath } from "./upstream/apps/server/src/mcp/AcpMcpStdioBridge.ts";

const command = process.argv[2] as "acp-mcp-bridge" | "acp-mcp-call" | undefined;
if (command !== "acp-mcp-bridge" && command !== "acp-mcp-call") {
  process.stderr.write("usage: mcp-bridge <acp-mcp-bridge|acp-mcp-call> [tool arguments-json]\n");
  process.exitCode = 2;
} else {
  void runAcpMcpCliFastPath(command, process.argv.slice(3));
}
