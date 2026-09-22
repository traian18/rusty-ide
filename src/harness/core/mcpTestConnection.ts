// ============================================================
// mcpTestConnection.ts — Sidecar-removal Phase 7b: the direct replacement
// for `HarnessControlPlane.testMcp`, which until now was ONLY ever
// implemented by the sidecar (`mcpTestService.ts`'s `POST /mcp/test`,
// called unconditionally by `components/mcp/connection-test.ts` -- not
// even through `hybridControlPlane`'s own dispatch).
//
// Calls the new `mcp_test_connection` Tauri command
// (src-tauri/src/harness/commands.rs), which reuses the exact same
// `harness_tool_mcp::connect_and_discover` call recipe.rs's own
// `register_mcp_servers` (Phase 6) already makes -- no new MCP client code
// anywhere. Maps the app's own `McpServerConfig` into the SDK's
// `McpServerSpec` via `mcpServerMapping.ts` client-side first: an
// unsupported transport/auth kind (websocket, OAuth2) is rejected here,
// with the same human-readable reason a skipped session-level MCP server
// gets, before ever reaching Rust.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import type { McpServerConfig } from "../../components/mcp/types";
import { mapMcpServerConfig } from "./mcpServerMapping";

export interface McpTestResult {
  toolCount: number;
  tools: string[];
}

export async function testMcpConnection(config: McpServerConfig): Promise<McpTestResult> {
  const mapped = mapMcpServerConfig(config);
  if (!mapped.ok) throw new Error(mapped.reason);
  return invoke<McpTestResult>("mcp_test_connection", { server: mapped.spec });
}
