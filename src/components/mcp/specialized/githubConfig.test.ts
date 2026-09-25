import { describe, expect, it } from "vitest";
import {
  githubFormToConfig,
  configToGithubForm,
  validateGitHubInputs,
  DEFAULT_GITHUB_FORM_DATA,
} from "./githubConfig";
import type { GitHubMcpFormData } from "./types";
import type { McpServerConfig } from "../types";

describe("githubConfig", () => {
  describe("githubFormToConfig", () => {
    it("maps the hosted method to GitHub's remote MCP server with the PAT as a bearer token", () => {
      const config = githubFormToConfig({ ...DEFAULT_GITHUB_FORM_DATA, token: "ghp_hosted" });

      expect(config.transport).toEqual({ type: "http", url: "https://api.githubcopilot.com/mcp/" });
      expect(config.auth).toEqual({ type: "bearer", token: "ghp_hosted" });
      expect(configToGithubForm(config).method).toBe("hosted");
    });

    it("converts NPX form data into standard McpServerConfig", () => {
      const form: GitHubMcpFormData = {
        method: "npx",
        serverName: "github",
        token: "ghp_secrettoken123",
        apiUrl: "",
        dockerImage: "mcp/github",
        customCommand: "",
        customArgs: "",
        remoteUrl: "",
        timeout: 35000,
        enabled: true,
      };

      const config = githubFormToConfig(form);
      expect(config.name).toBe("github");
      expect(config.enabled).toBe(true);
      expect(config.timeout).toBe(35000);
      expect(config.transport.type).toBe("stdio");
      expect(config.transport.command).toBe("npx");
      expect(config.transport.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
      expect(config.transport.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_secrettoken123");
      expect(config.transport.env?.GITHUB_API_URL).toBeUndefined();
    });

    it("includes GITHUB_API_URL when provided for enterprise", () => {
      const form: GitHubMcpFormData = {
        ...DEFAULT_GITHUB_FORM_DATA,
        method: "npx",
        token: "ghp_enterprise_token",
        apiUrl: "https://github.mycorp.internal/api/v3",
      };

      const config = githubFormToConfig(form);
      expect(config.transport.env?.GITHUB_API_URL).toBe("https://github.mycorp.internal/api/v3");
    });

    it("converts Docker form data into docker run command", () => {
      const form: GitHubMcpFormData = {
        ...DEFAULT_GITHUB_FORM_DATA,
        method: "docker",
        dockerImage: "custom/github-mcp:v1",
        token: "ghp_dockertoken",
      };

      const config = githubFormToConfig(form);
      expect(config.transport.type).toBe("stdio");
      expect(config.transport.command).toBe("docker");
      expect(config.transport.args).toContain("custom/github-mcp:v1");
      expect(config.transport.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_dockertoken");
    });

    it("converts Remote HTTP/SSE form data into http transport with bearer auth", () => {
      const form: GitHubMcpFormData = {
        ...DEFAULT_GITHUB_FORM_DATA,
        method: "remote_http",
        remoteUrl: "https://mcp.github.corp/sse",
        token: "ghp_remotetoken",
      };

      const config = githubFormToConfig(form);
      expect(config.transport.type).toBe("http");
      expect(config.transport.url).toBe("https://mcp.github.corp/sse");
      expect(config.auth.type).toBe("bearer");
      expect(config.auth.token).toBe("ghp_remotetoken");
    });

    it("converts Custom command form data", () => {
      const form: GitHubMcpFormData = {
        ...DEFAULT_GITHUB_FORM_DATA,
        method: "custom",
        customCommand: "/usr/bin/my-github-tool",
        customArgs: "--mode=read --verbose",
        token: "ghp_customtoken",
      };

      const config = githubFormToConfig(form);
      expect(config.transport.type).toBe("stdio");
      expect(config.transport.command).toBe("/usr/bin/my-github-tool");
      expect(config.transport.args).toEqual(["--mode=read", "--verbose"]);
      expect(config.transport.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_customtoken");
    });
  });

  describe("configToGithubForm", () => {
    it("returns default form when config is undefined", () => {
      const form = configToGithubForm(undefined);
      expect(form.method).toBe("hosted");
      expect(form.serverName).toBe("github");
      expect(form.token).toBe("");
    });

    it("restores npx configuration", () => {
      const config: McpServerConfig = {
        name: "github",
        enabled: true,
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_restored",
            GITHUB_API_URL: "https://github.corp/api/v3",
          },
        },
        auth: { type: "none" },
        timeout: 45000,
        maxRetries: 3,
        retryDelay: 1000,
      };

      const form = configToGithubForm(config);
      expect(form.method).toBe("npx");
      expect(form.token).toBe("ghp_restored");
      expect(form.apiUrl).toBe("https://github.corp/api/v3");
      expect(form.timeout).toBe(45000);
    });

    it("restores remote HTTP configuration", () => {
      const config: McpServerConfig = {
        name: "github-remote",
        enabled: false,
        transport: {
          type: "http",
          url: "https://mcp.mycorp.com/sse",
        },
        auth: {
          type: "bearer",
          token: "ghp_bearer123",
        },
        timeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
      };

      const form = configToGithubForm(config);
      expect(form.method).toBe("remote_http");
      expect(form.remoteUrl).toBe("https://mcp.mycorp.com/sse");
      expect(form.token).toBe("ghp_bearer123");
      expect(form.enabled).toBe(false);
    });
  });

  describe("validateGitHubInputs", () => {
    it("needs only a token for the hosted method", () => {
      expect(validateGitHubInputs({ ...DEFAULT_GITHUB_FORM_DATA, token: "" })).toContain("Token is required");
      expect(validateGitHubInputs({ ...DEFAULT_GITHUB_FORM_DATA, token: "ghp_x", apiUrl: "not a url" })).toBeNull();
    });

    it("fails when token is empty", () => {
      const error = validateGitHubInputs({
        ...DEFAULT_GITHUB_FORM_DATA,
        token: "",
      });
      expect(error).toContain("Token is required");
    });

    it("fails when remote URL is invalid for remote_http", () => {
      const error = validateGitHubInputs({
        ...DEFAULT_GITHUB_FORM_DATA,
        method: "remote_http",
        remoteUrl: "not-a-valid-url",
        token: "ghp_valid",
      });
      expect(error).toContain("valid HTTP or HTTPS endpoint URL");
    });

    it("passes with valid inputs", () => {
      const error = validateGitHubInputs({
        ...DEFAULT_GITHUB_FORM_DATA,
        token: "ghp_valid_token_12345",
      });
      expect(error).toBeNull();
    });
  });
});
