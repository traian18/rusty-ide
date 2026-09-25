import { Zap, Box, Cloud, Globe } from "lucide-react";
import type { McpServerConfig } from "../types";
import type { AtlassianIntegrationMethod, AtlassianMcpFormData, SpecializedIntegrationPreset } from "./types";

// Local methods run sooperset's mcp-atlassian (PyPI `mcp-atlassian`, image
// ghcr.io/sooperset/mcp-atlassian). It only reads the JIRA_* / CONFLUENCE_*
// variables below and enables each product only when its URL is set.
const DEFAULT_DOCKER_IMAGE = "ghcr.io/sooperset/mcp-atlassian";

/** Atlassian's official hosted (Rovo) MCP server; Atlassian Cloud sites only. */
export const ATLASSIAN_HOSTED_MCP_URL = "https://mcp.atlassian.com/v2/mcp";

export const ATLASSIAN_PRESETS: SpecializedIntegrationPreset<AtlassianIntegrationMethod>[] = [
  {
    id: "hosted",
    name: "Hosted by Atlassian (Rovo MCP)",
    badge: "Recommended",
    description: "Connects to Atlassian's official remote MCP server for Jira and Confluence Cloud. Nothing to install.",
    requirements:
      "Requires a scoped Atlassian API token with agent-interface scopes, and your org admin must allow API-token authentication for the Rovo MCP server.",
    commandPreview: ATLASSIAN_HOSTED_MCP_URL,
    icon: Globe,
  },
  {
    id: "uvx",
    name: "UVX / Python (mcp-atlassian)",
    badge: "Self-hosted",
    description: "Runs the popular mcp-atlassian server via uvx (fast, isolated Python runner).",
    requirements: "Requires uv / uvx installed on your system (brew install uv, or see docs.astral.sh/uv).",
    commandPreview: "uvx mcp-atlassian",
    icon: Zap,
  },
  {
    id: "docker",
    name: "Docker Container",
    badge: "Containerized",
    description: "Runs the mcp-atlassian container image in a Docker sandbox.",
    requirements: "Requires Docker Desktop / the Docker daemon running locally.",
    commandPreview: `docker run -i --rm -e JIRA_URL -e JIRA_USERNAME ... ${DEFAULT_DOCKER_IMAGE}`,
    icon: Box,
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
  method: "hosted",
  serverName: "atlassian",
  instanceUrl: "",
  email: "",
  apiToken: "",
  enableJira: true,
  enableConfluence: true,
  dockerImage: DEFAULT_DOCKER_IMAGE,
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

  if (form.method === "hosted" || form.method === "remote_http") {
    const hosted = form.method === "hosted";
    // Personal API tokens authenticate as HTTP Basic `email:token`.
    const basicAuth = email && apiToken ? btoa(`${email}:${apiToken}`) : "";
    return {
      name: serverName,
      displayName: hosted ? "Atlassian MCP (Hosted)" : "Atlassian MCP (Remote)",
      description: hosted
        ? "Atlassian's hosted Rovo Model Context Protocol server"
        : "Atlassian Model Context Protocol server over HTTP/SSE",
      enabled: form.enabled,
      transport: {
        type: "http",
        url: hosted ? ATLASSIAN_HOSTED_MCP_URL : form.remoteUrl.trim(),
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

  const env = productEnv(instanceUrl, email, apiToken, form.enableJira, form.enableConfluence);

  if (form.method === "docker") {
    const image = form.dockerImage.trim() || DEFAULT_DOCKER_IMAGE;
    // `-e NAME` without a value forwards the variable from docker's own
    // environment (set via `env` below), keeping the token off the command line.
    const dockerArgs = ["run", "-i", "--rm", ...Object.keys(env).flatMap((name) => ["-e", name]), image];

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

  return {
    name: serverName,
    displayName: "Atlassian MCP",
    description: "Atlassian Jira & Confluence Model Context Protocol server via uvx",
    enabled: form.enabled,
    transport: {
      type: "stdio",
      command: "uvx",
      args: ["mcp-atlassian"],
      env,
    },
    auth: { type: "none" },
    timeout: form.timeout || 30000,
    maxRetries: 3,
    retryDelay: 1000,
  };
}

function stripWiki(url: string): string {
  return url.replace(/\/wiki\/?$/, "");
}

function productEnv(
  instanceUrl: string,
  email: string,
  apiToken: string,
  enableJira: boolean,
  enableConfluence: boolean
): Record<string, string> {
  const base = stripWiki(instanceUrl);
  const env: Record<string, string> = {};
  const set = (name: string, value: string) => {
    if (value) env[name] = value;
  };
  if (enableJira) {
    set("JIRA_URL", base);
    set("JIRA_USERNAME", email);
    set("JIRA_API_TOKEN", apiToken);
  }
  if (enableConfluence) {
    // Confluence Cloud's REST API lives under /wiki on the same site.
    set("CONFLUENCE_URL", base ? `${base}/wiki` : "");
    set("CONFLUENCE_USERNAME", email);
    set("CONFLUENCE_API_TOKEN", apiToken);
  }
  return env;
}

export function configToAtlassianForm(config?: McpServerConfig): AtlassianMcpFormData {
  if (!config) {
    return { ...DEFAULT_ATLASSIAN_FORM_DATA };
  }

  let method: AtlassianIntegrationMethod = "hosted";
  let instanceUrl = "";
  let email = "";
  let apiToken = "";
  let enableJira = true;
  let enableConfluence = true;
  let dockerImage = DEFAULT_DOCKER_IMAGE;
  let remoteUrl = "";

  if (config.transport.type === "http" || config.transport.type === "sse") {
    remoteUrl = config.transport.url || "";
    method = remoteUrl.startsWith("https://mcp.atlassian.com/") ? "hosted" : "remote_http";
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

    // Also reads the ATLASSIAN_* names earlier versions wrote (which the
    // server never read), so one save rewrites such a config correctly.
    instanceUrl = env.JIRA_URL || stripWiki(env.CONFLUENCE_URL || "") || env.ATLASSIAN_INSTANCE_URL || "";
    email = env.JIRA_USERNAME || env.CONFLUENCE_USERNAME || env.ATLASSIAN_EMAIL || env.JIRA_EMAIL || "";
    apiToken = env.JIRA_API_TOKEN || env.CONFLUENCE_API_TOKEN || env.ATLASSIAN_API_TOKEN || "";

    if (env.JIRA_URL || env.CONFLUENCE_URL) {
      enableJira = Boolean(env.JIRA_URL);
      enableConfluence = Boolean(env.CONFLUENCE_URL);
    } else {
      enableJira = !(env.JIRA_ENABLED === "false" || args.includes("--confluence-only"));
      enableConfluence = !(env.CONFLUENCE_ENABLED === "false" || args.includes("--jira-only"));
    }

    if (cmd === "docker") {
      method = "docker";
      const lastArg = args[args.length - 1];
      if (lastArg && !lastArg.startsWith("-") && !lastArg.includes("/soopk/")) {
        dockerImage = lastArg;
      }
    } else {
      // Includes the old npx method, whose package was never published.
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
  if (data.method === "hosted") {
    if (!data.email.trim()) return "Atlassian account email is required.";
    if (!data.email.includes("@")) return "Please enter a valid email address.";
    if (!data.apiToken.trim()) return "Atlassian API Token is required to authenticate.";
    return null;
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
