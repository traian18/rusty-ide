import React from "react";
import { HelpCircle } from "lucide-react";
import styles from "./SpecializedMcp.module.css";
import type { AtlassianMcpModel } from "./useAtlassianMcp";

export function AtlassianMcpGuideCallout({ model }: { model: AtlassianMcpModel }): React.ReactElement {
  const {  } = model;

  return (
    <>
      {/* Guide Callout */}
      <div className={styles.guideCard}>
        <h5 className={styles.guideTitle}>
          <HelpCircle size={15} className="text-[var(--color-primary)]" />
          <span>Atlassian MCP Capabilities & Setup Tips</span>
        </h5>
        <ul className={styles.guideList}>
          <li>
            <strong>Generating an API Token:</strong> Sign in to{" "}
            <code>id.atlassian.com/manage-profile/security/api-tokens</code>. For the hosted server, click
            "Create API token with scopes" and select the Rovo MCP <code>agent-interface</code> scopes; for the
            self-hosted methods, a regular "Create API token" is enough.
          </li>
          <li>
            <strong>Hosted Method:</strong> Uses Atlassian's official Rovo MCP server — nothing runs on your
            machine. Atlassian Cloud only; an org admin must enable API-token authentication under
            Atlassian Administration → Rovo → Rovo MCP server → Authentication.
          </li>
          <li>
            <strong>UVX Method:</strong> Runs the Python-based <code>mcp-atlassian</code> package
            in an isolated, ephemeral environment without polluting your system Python.
          </li>
          <li>
            <strong>Jira Tools:</strong> Once connected, the agent can use JQL searches, retrieve issue
            details and comments, transition statuses (e.g. In Progress → Done), and log work.
          </li>
          <li>
            <strong>Confluence Tools:</strong> Enables agents to search technical documentation,
            architecture decision records, and knowledge base pages across your spaces.
          </li>
        </ul>
      </div>
    </>
  );
}
