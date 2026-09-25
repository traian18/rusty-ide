import { Package, Box, Cloud, Globe, TerminalSquare } from "lucide-react";
import type { McpServerConfig } from "../types";
import type { GitHubIntegrationMethod, GitHubMcpFormData, SpecializedIntegrationPreset } from "./types";

/** GitHub's own hosted MCP server; github.com only (not GitHub Enterprise Server). */
export const GITHUB_HOSTED_MCP_URL = "https://api.githubcopilot.com/mcp/";

export const GITHUB_PRESETS: SpecializedIntegrationPreset<GitHubIntegrationMethod>[] = [
  {
    id: "hosted",
    name: "Hosted by GitHub",
    badge: "Recommended",
    description: "Connects to GitHub's official remote MCP server. Nothing to install; just a personal access token.",
    requirements: "Requires only a GitHub personal access token.",
    commandPreview: GITHUB_HOSTED_MCP_URL,
    icon: Globe,
  },
  {
    id: "npx",
    name: "NPX / Node.js",
    badge: "Deprecated",
    description: "Launches @modelcontextprotocol/server-github via npx. npm marks this package as no longer supported.",
    requirements: "Requires Node.js 18+ and npm installed on your system.",
    commandPreview: "npx -y @modelcontextprotocol/server-github",
    icon: Package,
  },
  {
    id: "docker",
    name: "Docker Container",
    badge: "Isolated",
    description: "Runs the official mcp/github image inside a sandboxed container.",
    requirements: "Requires Docker desktop/daemon running locally.",
    commandPreview: "docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN mcp/github",
    icon: Box,
  },
  {
    id: "remote_http",
    name: "Remote HTTP / SSE",
    badge: "Cloud / Enterprise",
    description: "Connects to a hosted GitHub MCP endpoint or internal gateway.",
    requirements: "Requires a running HTTP or SSE MCP server endpoint.",
    commandPreview: "https://your-github-mcp-gateway.com/sse",
    icon: Cloud,
  },
  {
    id: "custom",
    name: "Custom Command",
    badge: "Advanced",
    description: "Run any local binary or wrapper script that speaks MCP stdio.",
    requirements: "Custom executable installed in PATH or absolute path.",
    commandPreview: "/usr/local/bin/github-mcp-server",
    icon: TerminalSquare,
  },
];

export const DEFAULT_GITHUB_FORM_DATA: GitHubMcpFormData = {
  method: "hosted",
  serverName: "github",
  token: "",
  apiUrl: "",
  dockerImage: "mcp/github",
  customCommand: "",
  customArgs: "",
  remoteUrl: "",
  timeout: 30000,
  enabled: true,
};

export function githubFormToConfig(form: GitHubMcpFormData): McpServerConfig {
  const serverName = form.serverName.trim().toLowerCase() || "github";
  const token = form.token.trim();
  const apiUrl = form.apiUrl.trim();

  if (form.method === "hosted") {
    return {
      name: serverName,
      displayName: "GitHub MCP (Hosted)",
      description: "GitHub's hosted Model Context Protocol server",
      enabled: form.enabled,
      transport: { type: "http", url: GITHUB_HOSTED_MCP_URL },
      auth: { type: "bearer", token },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  if (form.method === "remote_http") {
    return {
      name: serverName,
      displayName: "GitHub MCP (Remote)",
      description: "GitHub Model Context Protocol server over HTTP/SSE",
      enabled: form.enabled,
      transport: {
        type: "http",
        url: form.remoteUrl.trim(),
      },
      auth: {
        type: token ? "bearer" : "none",
        token: token || undefined,
      },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  const env: Record<string, string> = {};
  if (token) {
    env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  }
  if (apiUrl) {
    env.GITHUB_API_URL = apiUrl;
  }

  if (form.method === "docker") {
    const image = form.dockerImage.trim() || "mcp/github";
    const dockerArgs = ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN"];
    if (apiUrl) {
      dockerArgs.push("-e", "GITHUB_API_URL");
    }
    dockerArgs.push(image);

    return {
      name: serverName,
      displayName: "GitHub MCP (Docker)",
      description: "GitHub Model Context Protocol server via Docker",
      enabled: form.enabled,
      transport: {
        type: "stdio",
        command: "docker",
        args: dockerArgs,
        env,
      },
      auth: { type: "none" },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  if (form.method === "custom") {
    const rawArgs = form.customArgs.trim();
    const args = rawArgs.length > 0 ? rawArgs.split(/\s+/) : [];

    return {
      name: serverName,
      displayName: "GitHub MCP (Custom)",
      description: "GitHub Model Context Protocol server via custom command",
      enabled: form.enabled,
      transport: {
        type: "stdio",
        command: form.customCommand.trim() || "github-mcp",
        args,
        env,
      },
      auth: { type: "none" },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  // Default: "npx"
  return {
    name: serverName,
    displayName: "GitHub MCP",
    description: "Official GitHub Model Context Protocol server via npx",
    enabled: form.enabled,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env,
    },
    auth: { type: "none" },
    timeout: form.timeout || 30000,
    maxRetries: 3,
    retryDelay: 1000,
  };
}

export function configToGithubForm(config?: McpServerConfig): GitHubMcpFormData {
  if (!config) {
    return { ...DEFAULT_GITHUB_FORM_DATA };
  }

  let method: GitHubIntegrationMethod = "hosted";
  let token = "";
  let apiUrl = "";
  let dockerImage = "mcp/github";
  let customCommand = "";
  let customArgs = "";
  let remoteUrl = "";

  if (config.transport.type === "http" || config.transport.type === "sse") {
    remoteUrl = config.transport.url || "";
    method = remoteUrl === GITHUB_HOSTED_MCP_URL ? "hosted" : "remote_http";
    if (config.auth.type === "bearer" && config.auth.token) {
      token = config.auth.token;
    } else if (config.auth.type === "apiKey" && config.auth.value) {
      token = config.auth.value;
    }
  } else if (config.transport.type === "stdio") {
    const cmd = config.transport.command || "";
    const args = config.transport.args || [];
    const env = config.transport.env || {};

    token = env.GITHUB_PERSONAL_ACCESS_TOKEN || env.GITHUB_TOKEN || "";
    apiUrl = env.GITHUB_API_URL || env.GH_ENTERPRISE_URL || "";

    if (cmd === "docker") {
      method = "docker";
      const lastArg = args[args.length - 1];
      if (lastArg && !lastArg.startsWith("-")) {
        dockerImage = lastArg;
      }
    } else if (cmd === "npx" && args.some((a) => a.includes("server-github"))) {
      method = "npx";
    } else {
      method = "custom";
      customCommand = cmd;
      customArgs = args.join(" ");
    }
  }

  return {
    method,
    serverName: config.name || "github",
    token,
    apiUrl,
    dockerImage,
    customCommand,
    customArgs,
    remoteUrl,
    timeout: config.timeout || 30000,
    enabled: config.enabled !== false,
  };
}

/** Rejects any scheme other than http/https so a pasted `javascript:`,
 * `file:`, or similar URL can't be saved as an MCP transport endpoint --
 * `new URL()` alone happily accepts those. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateGitHubInputs(data: GitHubMcpFormData): string | null {
  if (data.method === "hosted") {
    return data.token.trim() ? null : "GitHub Personal Access Token is required to authenticate.";
  }

  if (data.method === "remote_http") {
    if (!data.remoteUrl.trim()) {
      return "Endpoint URL is required for remote HTTP/SSE integration.";
    }
    if (!isHttpUrl(data.remoteUrl.trim())) {
      return "Please enter a valid HTTP or HTTPS endpoint URL.";
    }
    return null;
  }

  if (data.method === "custom") {
    if (!data.customCommand.trim()) {
      return "Please enter the executable command for the custom MCP server.";
    }
  }

  if (!data.token.trim()) {
    return "GitHub Personal Access Token is required to authenticate.";
  }

  if (data.apiUrl.trim() && !isHttpUrl(data.apiUrl.trim())) {
    return "GitHub Enterprise API URL must be a valid HTTP or HTTPS URL (e.g., https://github.company.com/api/v3).";
  }

  return null;
}
