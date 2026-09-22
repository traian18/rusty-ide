import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { McpServerConfig } from "../../components/mcp/types";
import { DEFAULT_SERVER_CONFIG } from "../../components/mcp/types";
import { testMcpConnection } from "./mcpTestConnection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function server(overrides: Partial<McpServerConfig>): McpServerConfig {
  return { ...DEFAULT_SERVER_CONFIG, name: "test-server", ...overrides };
}

describe("testMcpConnection", () => {
  it("maps the config and invokes mcp_test_connection with the SDK spec", async () => {
    invokeMock.mockReset().mockResolvedValue({ toolCount: 2, tools: ["read", "write"] });

    const result = await testMcpConnection(server({ transport: { type: "stdio", command: "npx", args: ["fs-mcp"] } }));

    expect(result).toEqual({ toolCount: 2, tools: ["read", "write"] });
    expect(invokeMock).toHaveBeenCalledWith("mcp_test_connection", {
      server: {
        name: "test-server",
        transport: { kind: "stdio", command: "npx", args: ["fs-mcp"], env: undefined },
        request_timeout_secs: 30,
      },
    });
  });

  it("rejects client-side, never invoking, for an unmappable server (e.g. websocket)", async () => {
    invokeMock.mockReset();

    await expect(testMcpConnection(server({ transport: { type: "websocket", url: "wss://example.test" } }))).rejects.toThrow(/websocket/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("propagates a Rust-side connection failure as a rejection", async () => {
    invokeMock.mockReset().mockRejectedValue(new Error("MCP server closed its connection"));

    await expect(testMcpConnection(server({ transport: { type: "http", url: "https://example.test/mcp" } }))).rejects.toThrow(
      "MCP server closed its connection",
    );
  });
});
