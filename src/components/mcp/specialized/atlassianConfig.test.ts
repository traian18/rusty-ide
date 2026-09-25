import { describe, expect, it } from "vitest";
import {
  atlassianFormToConfig,
  configToAtlassianForm,
  normalizeInstanceUrl,
  validateAtlassianInputs,
  DEFAULT_ATLASSIAN_FORM_DATA,
} from "./atlassianConfig";
import type { AtlassianMcpFormData } from "./types";
import type { McpServerConfig } from "../types";

describe("atlassianConfig", () => {
  describe("normalizeInstanceUrl", () => {
    it("adds https:// when protocol is missing", () => {
      expect(normalizeInstanceUrl("myteam.atlassian.net")).toBe("https://myteam.atlassian.net");
    });

    it("trims trailing slashes", () => {
      expect(normalizeInstanceUrl("https://myteam.atlassian.net///")).toBe("https://myteam.atlassian.net");
    });

    it("preserves already valid https URLs", () => {
      expect(normalizeInstanceUrl("https://jira.company.com")).toBe("https://jira.company.com");
    });
  });

  describe("atlassianFormToConfig", () => {
    it("maps the hosted method to Atlassian's Rovo MCP server with Basic email:token auth", () => {
      const config = atlassianFormToConfig({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        email: "dev@myteam.com",
        apiToken: "scoped_token",
      });

      expect(config.transport).toEqual({ type: "http", url: "https://mcp.atlassian.com/v2/mcp" });
      expect(config.auth.header).toBe("Authorization");
      expect(config.auth.value).toBe(`Basic ${btoa("dev@myteam.com:scoped_token")}`);

      const restored = configToAtlassianForm(config);
      expect(restored.method).toBe("hosted");
      expect(restored.email).toBe("dev@myteam.com");
      expect(restored.apiToken).toBe("scoped_token");
    });

    it("converts UVX form data into the JIRA_*/CONFLUENCE_* variables mcp-atlassian reads", () => {
      const form: AtlassianMcpFormData = {
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "atlassian_api_token_123",
      };

      const config = atlassianFormToConfig(form);
      expect(config.name).toBe("atlassian");
      expect(config.transport.command).toBe("uvx");
      expect(config.transport.args).toEqual(["mcp-atlassian"]);
      expect(config.transport.env).toEqual({
        JIRA_URL: "https://myteam.atlassian.net",
        JIRA_USERNAME: "dev@myteam.com",
        JIRA_API_TOKEN: "atlassian_api_token_123",
        CONFLUENCE_URL: "https://myteam.atlassian.net/wiki",
        CONFLUENCE_USERNAME: "dev@myteam.com",
        CONFLUENCE_API_TOKEN: "atlassian_api_token_123",
      });
    });

    it("enables only Jira by leaving out every Confluence variable, with no CLI flags", () => {
      const config = atlassianFormToConfig({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "token",
        enableConfluence: false,
      });

      expect(config.transport.args).toEqual(["mcp-atlassian"]);
      expect(Object.keys(config.transport.env ?? {})).toEqual(["JIRA_URL", "JIRA_USERNAME", "JIRA_API_TOKEN"]);
    });

    it("does not double the /wiki suffix when the instance URL already has it", () => {
      const config = atlassianFormToConfig({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "https://myteam.atlassian.net/wiki",
        email: "dev@myteam.com",
        apiToken: "token",
      });

      expect(config.transport.env?.JIRA_URL).toBe("https://myteam.atlassian.net");
      expect(config.transport.env?.CONFLUENCE_URL).toBe("https://myteam.atlassian.net/wiki");
    });

    it("converts Docker mode into a run command forwarding each variable by name", () => {
      const config = atlassianFormToConfig({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "docker",
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "secret-token",
        enableConfluence: false,
      });

      expect(config.transport.command).toBe("docker");
      expect(config.transport.args).toEqual([
        "run", "-i", "--rm",
        "-e", "JIRA_URL", "-e", "JIRA_USERNAME", "-e", "JIRA_API_TOKEN",
        "ghcr.io/sooperset/mcp-atlassian",
      ]);
      expect(config.transport.args?.join(" ")).not.toContain("secret-token");
      expect(config.transport.env?.JIRA_API_TOKEN).toBe("secret-token");
    });

    it("converts Remote HTTP mode with Basic auth header", () => {
      const form: AtlassianMcpFormData = {
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "remote_http",
        remoteUrl: "https://atlassian.corp.net/sse",
        email: "dev@myteam.com",
        apiToken: "token123",
      };

      const config = atlassianFormToConfig(form);
      expect(config.transport.type).toBe("http");
      expect(config.transport.url).toBe("https://atlassian.corp.net/sse");
      expect(config.auth.type).toBe("apiKey");
      expect(config.auth.header).toBe("Authorization");
      expect(config.auth.value).toBe(`Basic ${btoa("dev@myteam.com:token123")}`);
    });
  });

  describe("configToAtlassianForm", () => {
    it("restores a uvx configuration", () => {
      const config = atlassianFormToConfig({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "https://corp.atlassian.net",
        email: "admin@corp.com",
        apiToken: "secret_token",
        enableJira: false,
      });

      const form = configToAtlassianForm(config);
      expect(form.method).toBe("uvx");
      expect(form.instanceUrl).toBe("https://corp.atlassian.net");
      expect(form.email).toBe("admin@corp.com");
      expect(form.apiToken).toBe("secret_token");
      expect(form.enableJira).toBe(false);
      expect(form.enableConfluence).toBe(true);
    });

    it("migrates a config saved with the old ATLASSIAN_* variables and --jira-only flag", () => {
      const legacy: McpServerConfig = {
        name: "attlasian",
        enabled: true,
        transport: {
          type: "stdio",
          command: "uvx",
          args: ["mcp-atlassian", "--jira-only"],
          env: {
            ATLASSIAN_INSTANCE_URL: "https://corp.atlassian.net",
            ATLASSIAN_EMAIL: "admin@corp.com",
            ATLASSIAN_API_TOKEN: "secret_token",
            CONFLUENCE_ENABLED: "false",
          },
        },
        auth: { type: "none" },
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      };

      const resaved = atlassianFormToConfig(configToAtlassianForm(legacy));
      expect(resaved.name).toBe("attlasian");
      expect(resaved.transport.args).toEqual(["mcp-atlassian"]);
      expect(resaved.transport.env).toEqual({
        JIRA_URL: "https://corp.atlassian.net",
        JIRA_USERNAME: "admin@corp.com",
        JIRA_API_TOKEN: "secret_token",
      });
    });

    it("moves configs from the unpublished npx package and soopk image onto working ones", () => {
      const base = { name: "atlassian", enabled: true, auth: { type: "none" as const }, timeout: 30000, maxRetries: 3, retryDelay: 1000 };
      const fromNpx = configToAtlassianForm({
        ...base,
        transport: { type: "stdio", command: "npx", args: ["-y", "@soopk/mcp-atlassian"], env: {} },
      });
      const fromOldImage = configToAtlassianForm({
        ...base,
        transport: { type: "stdio", command: "docker", args: ["run", "-i", "--rm", "ghcr.io/soopk/mcp-atlassian"], env: {} },
      });

      expect(fromNpx.method).toBe("uvx");
      expect(fromOldImage.method).toBe("docker");
      expect(fromOldImage.dockerImage).toBe("ghcr.io/sooperset/mcp-atlassian");
    });

    it("restores remote HTTP configuration and decodes Basic auth", () => {
      const basic = btoa("user@atlassian.com:my_api_key");
      const config: McpServerConfig = {
        name: "atlassian-cloud",
        enabled: true,
        transport: {
          type: "http",
          url: "https://rovo.corp.internal/sse",
        },
        auth: {
          type: "apiKey",
          header: "Authorization",
          value: `Basic ${basic}`,
        },
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      };

      const form = configToAtlassianForm(config);
      expect(form.method).toBe("remote_http");
      expect(form.remoteUrl).toBe("https://rovo.corp.internal/sse");
      expect(form.email).toBe("user@atlassian.com");
      expect(form.apiToken).toBe("my_api_key");
    });
  });

  describe("validateAtlassianInputs", () => {
    it("needs only email and token for the hosted method, not an instance URL", () => {
      const hosted = { ...DEFAULT_ATLASSIAN_FORM_DATA, instanceUrl: "" };
      expect(validateAtlassianInputs({ ...hosted, email: "", apiToken: "t" })).toContain("email is required");
      expect(validateAtlassianInputs({ ...hosted, email: "a@b.com", apiToken: "" })).toContain("API Token is required");
      expect(validateAtlassianInputs({ ...hosted, email: "a@b.com", apiToken: "t" })).toBeNull();
    });

    it("fails when instance URL is missing", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "",
        email: "user@test.com",
        apiToken: "token",
      });
      expect(error).toContain("Instance URL is required");
    });

    it("fails when email is invalid", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        instanceUrl: "https://myteam.atlassian.net",
        email: "not-an-email",
        apiToken: "token",
      });
      expect(error).toContain("valid email address");
    });

    it("fails when API token is empty", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        instanceUrl: "https://myteam.atlassian.net",
        email: "user@test.com",
        apiToken: "",
      });
      expect(error).toContain("API Token is required");
    });

    it("fails when both Jira and Confluence are disabled", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "uvx",
        instanceUrl: "https://myteam.atlassian.net",
        email: "user@test.com",
        apiToken: "token",
        enableJira: false,
        enableConfluence: false,
      });
      expect(error).toContain("enable at least one Atlassian product");
    });

    it("passes with valid inputs", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        instanceUrl: "myteam.atlassian.net",
        email: "user@test.com",
        apiToken: "token",
      });
      expect(error).toBeNull();
    });
  });
});
