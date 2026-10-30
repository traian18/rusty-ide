import type { LucideIcon } from "lucide-react";

export type GitHubIntegrationMethod = "hosted" | "npx" | "docker" | "remote_http" | "custom";

export interface GitHubMcpFormData {
  method: GitHubIntegrationMethod;
  serverName: string;
  token: string;
  apiUrl: string;
  dockerImage: string;
  customCommand: string;
  customArgs: string;
  remoteUrl: string;
  timeout: number;
  enabled: boolean;
}

export type AtlassianIntegrationMethod = "hosted" | "uvx" | "docker" | "remote_http";

export interface AtlassianMcpFormData {
  method: AtlassianIntegrationMethod;
  serverName: string;
  instanceUrl: string;
  email: string;
  apiToken: string;
  enableJira: boolean;
  enableConfluence: boolean;
  dockerImage: string;
  remoteUrl: string;
  timeout: number;
  enabled: boolean;
}

export interface SpecializedIntegrationPreset<TMethod extends string> {
  id: TMethod;
  name: string;
  badge: string;
  description: string;
  requirements: string;
  commandPreview: string;
  /** Small glyph identifying the runtime (npx/docker/http/etc) at a glance. */
  icon: LucideIcon;
}

export type McpTabKey = "github" | "atlassian" | "generic";
