import { describe, expect, it } from "vitest";

import type { McpServerConfig } from "../../components/mcp/types";
import { DEFAULT_SERVER_CONFIG } from "../../components/mcp/types";
import { mapMcpServerConfig, mapMcpServerConfigs } from "./mcpServerMapping";

function server(overrides: Partial<McpServerConfig>): McpServerConfig {
  return { ...DEFAULT_SERVER_CONFIG, name: "test-server", ...overrides };
}

describe("mapMcpServerConfig", () => {
  it("maps a stdio server", () => {
    const result = mapMcpServerConfig(
      server({
        transport: { type: "stdio", command: "npx", args: ["-y", "some-mcp-server"], env: { FOO: "bar" } },
      }),
    );
    expect(result).toEqual({
      ok: true,
      spec: {
        name: "test-server",
        transport: { kind: "stdio", command: "npx", args: ["-y", "some-mcp-server"], env: { FOO: "bar" } },
        request_timeout_secs: 30,
      },
    });
  });

  it("maps an http server with no auth", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "http", url: "https://example.test/mcp" } }));
    expect(result).toEqual({
      ok: true,
      spec: {
        name: "test-server",
        transport: { kind: "http", url: "https://example.test/mcp", headers: undefined },
        request_timeout_secs: 30,
      },
    });
  });

  it("maps an sse server onto the http transport kind", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "sse", url: "https://example.test/sse" } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.transport).toEqual({ kind: "http", url: "https://example.test/sse", headers: undefined });
  });

  it("builds an apiKey header, value left un-interpolated for the Rust side to resolve", () => {
    const result = mapMcpServerConfig(
      server({
        transport: { type: "http", url: "https://example.test/mcp" },
        auth: { type: "apiKey", header: "X-Api-Key", value: "${MY_MCP_KEY}" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.transport).toMatchObject({ headers: { "X-Api-Key": "${MY_MCP_KEY}" } });
  });

  it("builds a bearer Authorization header", () => {
    const result = mapMcpServerConfig(
      server({
        transport: { type: "http", url: "https://example.test/mcp" },
        auth: { type: "bearer", token: "${MY_TOKEN}" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.transport).toMatchObject({ headers: { Authorization: "Bearer ${MY_TOKEN}" } });
  });

  it("skips a disabled server", () => {
    const result = mapMcpServerConfig(server({ enabled: false }));
    expect(result).toEqual({ ok: false, reason: "MCP server 'test-server' is disabled" });
  });

  it("skips a websocket server -- no target transport kind in the SDK yet", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "websocket", url: "wss://example.test/mcp" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("websocket");
  });

  it("skips an oauth2-authenticated server -- no target auth shape in the SDK yet", () => {
    const result = mapMcpServerConfig(
      server({
        transport: { type: "http", url: "https://example.test/mcp" },
        auth: { type: "oauth2", clientId: "c1", tokenUrl: "https://example.test/token", grantType: "client_credentials" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("OAuth2");
  });

  it("skips a stdio server with no command configured", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "stdio" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no command configured");
  });

  it("skips an http server with no url configured", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "http" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no url configured");
  });

  it("omits request_timeout_secs for a zero/default-less timeout", () => {
    const result = mapMcpServerConfig(server({ transport: { type: "http", url: "https://example.test/mcp" }, timeout: 0 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.request_timeout_secs).toBeUndefined();
  });
});

describe("mapMcpServerConfigs", () => {
  it("splits a mixed list into specs and skipped, each with a reason", () => {
    const good = server({ name: "good", transport: { type: "http", url: "https://example.test/mcp" } });
    const bad = server({ name: "bad", transport: { type: "websocket", url: "wss://example.test/mcp" } });

    const { specs, skipped } = mapMcpServerConfigs([good, bad]);

    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("good");
    expect(skipped).toEqual([{ name: "bad", reason: expect.stringContaining("websocket") }]);
  });

  it("returns empty results for an empty list", () => {
    expect(mapMcpServerConfigs([])).toEqual({ specs: [], skipped: [] });
  });
});
