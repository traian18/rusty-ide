import { Zap, Box, Package, Cloud } from "lucide-react";
import type { McpServerConfig } from "../types";
import type { AtlassianIntegrationMethod, AtlassianMcpFormData, SpecializedIntegrationPreset } from "./types";

export const ATLASSIAN_PRESETS: SpecializedIntegrationPreset<AtlassianIntegrationMethod>[] = [
  {
    id: "uvx",
    name: "UVX / Python (mcp-atlassian)",
    badge: "Recommended",
    description: "Runs the popular mcp-atlassian server via uvx (fast, isolated Python runner).",
    requirements: "Requires uv / uvx installed on your system (pip install uv or brew install uv).",
    commandPreview: "uvx mcp-atlassian",
    icon: Zap,
  },
  {
    id: "docker",
    name: "Docker Container",
    badge: "Containerized",
    description: "Runs the containerized Atlassian MCP server in a Docker sandbox.",
    requirements: "Requires Docker desktop/daemon running locally.",
    commandPreview: "docker run -i --rm -e ATLASSIAN_INSTANCE_URL ... ghcr.io/soopk/mcp-atlassian",
    icon: Box,
  },
  {
    id: "npx",
    name: "NPX / Node.js",
    badge: "Node Alternative",
    description: "Runs the Node-packaged Atlassian MCP server via npx.",
    requirements: "Requires Node.js 18+ and npm installed on your system.",
    commandPreview: "npx -y @soopk/mcp-atlassian",
    icon: Package,
  },
  {
    id: "remote_http",
    name: "Remote HTTP / SSE",
    badge: "Cloud Gateway",
    description: "Connects to a remote Atlassian Rovo or hosted gateway MCP endpoint.",
    requirements: "Requires an accessible HTTP/SSE MCP gateway URL.",
    commandPreview: "https://your-atlassian-mcp.internal.net/sse",
    icon: Cloud,
  },
];

export const DEFAULT_ATLASSIAN_FORM_DATA: AtlassianMcpFormData = {
  method: "uvx",
  serverName: "atlassian",
  instanceUrl: "",
  email: "",
  apiToken: "",
  enableJira: true,
  enableConfluence: true,
  dockerImage: "ghcr.io/soopk/mcp-atlassian",
  remoteUrl: "",
  timeout: 30000,
  enabled: true,
};

export function normalizeInstanceUrl(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  // Remove trailing slashes
  url = url.replace(/\/+$/, "");
  return url;
}

export function atlassianFormToConfig(form: AtlassianMcpFormData): McpServerConfig {
  const serverName = form.serverName.trim().toLowerCase() || "atlassian";
  const instanceUrl = normalizeInstanceUrl(form.instanceUrl);
  const email = form.email.trim();
  const apiToken = form.apiToken.trim();

  if (form.method === "remote_http") {
    // If Basic auth credentials exist, encode header or bearer
    const basicAuth = email && apiToken ? btoa(`${email}:${apiToken}`) : "";
    return {
      name: serverName,
      displayName: "Atlassian MCP (Remote)",
      description: "Atlassian Model Context Protocol server over HTTP/SSE",
      enabled: form.enabled,
      transport: {
        type: "http",
        url: form.remoteUrl.trim(),
      },
      auth: {
        type: basicAuth ? "apiKey" : "none",
        header: basicAuth ? "Authorization" : undefined,
        value: basicAuth ? `Basic ${basicAuth}` : undefined,
      },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  const env: Record<string, string> = {};
  if (instanceUrl) {
    env.ATLASSIAN_INSTANCE_URL = instanceUrl;
  }
  if (email) {
    env.ATLASSIAN_EMAIL = email;
  }
  if (apiToken) {
    env.ATLASSIAN_API_TOKEN = apiToken;
  }
  if (!form.enableJira) {
    env.JIRA_ENABLED = "false";
  }
  if (!form.enableConfluence) {
    env.CONFLUENCE_ENABLED = "false";
  }

  if (form.method === "docker") {
    const image = form.dockerImage.trim() || "ghcr.io/soopk/mcp-atlassian";
    const dockerArgs = [
      "run",
      "-i",
      "--rm",
      "-e",
      "ATLASSIAN_INSTANCE_URL",
      "-e",
      "ATLASSIAN_EMAIL",
      "-e",
      "ATLASSIAN_API_TOKEN",
    ];
    if (!form.enableJira) {
      dockerArgs.push("-e", "JIRA_ENABLED=false");
    }
    if (!form.enableConfluence) {
      dockerArgs.push("-e", "CONFLUENCE_ENABLED=false");
    }
    dockerArgs.push(image);

    return {
      name: serverName,
      displayName: "Atlassian MCP (Docker)",
      description: "Atlassian Jira & Confluence Model Context Protocol server via Docker",
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

  if (form.method === "npx") {
    return {
      name: serverName,
      displayName: "Atlassian MCP (npx)",
      description: "Atlassian Jira & Confluence Model Context Protocol server via npx",
      enabled: form.enabled,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@soopk/mcp-atlassian"],
        env,
      },
      auth: { type: "none" },
      timeout: form.timeout || 30000,
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  // Default: "uvx"
  const uvxArgs = ["mcp-atlassian"];
  if (form.enableJira && !form.enableConfluence) {
    uvxArgs.push("--jira-only");
  } else if (!form.enableJira && form.enableConfluence) {
    uvxArgs.push("--confluence-only");
  }

  return {
    name: serverName,
    displayName: "Atlassian MCP",
    description: "Atlassian Jira & Confluence Model Context Protocol server via uvx",
    enabled: form.enabled,
    transport: {
      type: "stdio",
      command: "uvx",
      args: uvxArgs,
      env,
    },
    auth: { type: "none" },
    timeout: form.timeout || 30000,
    maxRetries: 3,
    retryDelay: 1000,
  };
}

export function configToAtlassianForm(config?: McpServerConfig): AtlassianMcpFormData {
  if (!config) {
    return { ...DEFAULT_ATLASSIAN_FORM_DATA };
  }

  let method: AtlassianIntegrationMethod = "uvx";
  let instanceUrl = "";
  let email = "";
  let apiToken = "";
  let enableJira = true;
  let enableConfluence = true;
  let dockerImage = "ghcr.io/soopk/mcp-atlassian";
  let remoteUrl = "";

  if (config.transport.type === "http" || config.transport.type === "sse") {
    method = "remote_http";
    remoteUrl = config.transport.url || "";
    if (config.auth.header === "Authorization" && config.auth.value?.startsWith("Basic ")) {
      try {
        const decoded = atob(config.auth.value.slice(6));
        const [u, ...p] = decoded.split(":");
        email = u || "";
        apiToken = p.join(":") || "";
      } catch {
        // Leave empty if decode fails
      }
    }
  } else if (config.transport.type === "stdio") {
    const cmd = config.transport.command || "";
    const args = config.transport.args || [];
    const env = config.transport.env || {};

    instanceUrl = env.ATLASSIAN_INSTANCE_URL || env.JIRA_URL || "";
    email = env.ATLASSIAN_EMAIL || env.JIRA_EMAIL || "";
    apiToken = env.ATLASSIAN_API_TOKEN || env.JIRA_API_TOKEN || "";

    if (env.JIRA_ENABLED === "false" || args.includes("--confluence-only")) {
      enableJira = false;
    }
    if (env.CONFLUENCE_ENABLED === "false" || args.includes("--jira-only")) {
      enableConfluence = false;
    }

    if (cmd === "docker") {
      method = "docker";
      const lastArg = args[args.length - 1];
      if (lastArg && !lastArg.startsWith("-")) {
        dockerImage = lastArg;
      }
    } else if (cmd === "npx") {
      method = "npx";
    } else {
      method = "uvx";
    }
  }

  return {
    method,
    serverName: config.name || "atlassian",
    instanceUrl,
    email,
    apiToken,
    enableJira,
    enableConfluence,
    dockerImage,
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

export function validateAtlassianInputs(data: AtlassianMcpFormData): string | null {
  if (data.method === "remote_http") {
    if (!data.remoteUrl.trim()) {
      return "Endpoint URL is required for remote HTTP/SSE integration.";
    }
    if (!isHttpUrl(data.remoteUrl.trim())) {
      return "Please enter a valid HTTP or HTTPS endpoint URL.";
    }
    return null;
  }

  const normalizedUrl = normalizeInstanceUrl(data.instanceUrl);
  if (!normalizedUrl) {
    return "Atlassian Instance URL is required (e.g., https://your-domain.atlassian.net).";
  }

  if (!isHttpUrl(normalizedUrl)) {
    return "Please enter a valid URL for your Atlassian instance.";
  }
  if (!new URL(normalizedUrl).hostname.includes(".")) {
    return "Please enter a valid domain name for your Atlassian instance.";
  }

  if (!data.email.trim()) {
    return "Atlassian account email is required.";
  }

  if (!data.email.includes("@")) {
    return "Please enter a valid email address.";
  }

  if (!data.apiToken.trim()) {
    return "Atlassian API Token is required to authenticate.";
  }

  if (!data.enableJira && !data.enableConfluence) {
    return "Please enable at least one Atlassian product (Jira or Confluence).";
  }

  return null;
}
