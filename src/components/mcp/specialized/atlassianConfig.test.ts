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
    it("converts UVX form data into standard McpServerConfig", () => {
      const form: AtlassianMcpFormData = {
        method: "uvx",
        serverName: "atlassian",
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "atlassian_api_token_123",
        enableJira: true,
        enableConfluence: true,
        dockerImage: "ghcr.io/soopk/mcp-atlassian",
        remoteUrl: "",
        timeout: 30000,
        enabled: true,
      };

      const config = atlassianFormToConfig(form);
      expect(config.name).toBe("atlassian");
      expect(config.transport.type).toBe("stdio");
      expect(config.transport.command).toBe("uvx");
      expect(config.transport.args).toEqual(["mcp-atlassian"]);
      expect(config.transport.env?.ATLASSIAN_INSTANCE_URL).toBe("https://myteam.atlassian.net");
      expect(config.transport.env?.ATLASSIAN_EMAIL).toBe("dev@myteam.com");
      expect(config.transport.env?.ATLASSIAN_API_TOKEN).toBe("atlassian_api_token_123");
    });

    it("adds --jira-only flag when confluence is disabled in uvx mode", () => {
      const form: AtlassianMcpFormData = {
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "token",
        enableJira: true,
        enableConfluence: false,
      };

      const config = atlassianFormToConfig(form);
      expect(config.transport.args).toContain("--jira-only");
      expect(config.transport.env?.CONFLUENCE_ENABLED).toBe("false");
    });

    it("converts Docker mode into container run command", () => {
      const form: AtlassianMcpFormData = {
        ...DEFAULT_ATLASSIAN_FORM_DATA,
        method: "docker",
        instanceUrl: "https://myteam.atlassian.net",
        email: "dev@myteam.com",
        apiToken: "token",
        dockerImage: "custom-atlassian:latest",
      };

      const config = atlassianFormToConfig(form);
      expect(config.transport.command).toBe("docker");
      expect(config.transport.args).toContain("custom-atlassian:latest");
      expect(config.transport.env?.ATLASSIAN_EMAIL).toBe("dev@myteam.com");
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
    it("restores uvx configuration from existing server", () => {
      const config: McpServerConfig = {
        name: "atlassian",
        enabled: true,
        transport: {
          type: "stdio",
          command: "uvx",
          args: ["mcp-atlassian"],
          env: {
            ATLASSIAN_INSTANCE_URL: "https://corp.atlassian.net",
            ATLASSIAN_EMAIL: "admin@corp.com",
            ATLASSIAN_API_TOKEN: "secret_token",
          },
        },
        auth: { type: "none" },
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      };

      const form = configToAtlassianForm(config);
      expect(form.method).toBe("uvx");
      expect(form.instanceUrl).toBe("https://corp.atlassian.net");
      expect(form.email).toBe("admin@corp.com");
      expect(form.apiToken).toBe("secret_token");
      expect(form.enableJira).toBe(true);
      expect(form.enableConfluence).toBe(true);
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
    it("fails when instance URL is missing", () => {
      const error = validateAtlassianInputs({
        ...DEFAULT_ATLASSIAN_FORM_DATA,
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
