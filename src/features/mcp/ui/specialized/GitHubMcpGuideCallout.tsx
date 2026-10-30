import React from "react";
import { HelpCircle } from "lucide-react";
import styles from "./SpecializedMcp.module.css";
import type { GitHubMcpModel } from "./useGitHubMcp";

export function GitHubMcpGuideCallout({ model }: { model: GitHubMcpModel }): React.ReactElement {
  const {  } = model;

  return (
    <>
      {/* Guide Callout */}
      <div className={styles.guideCard}>
        <h5 className={styles.guideTitle}>
          <HelpCircle size={15} className="text-[var(--color-primary)]" />
          <span>GitHub MCP Capabilities & Setup Tips</span>
        </h5>
        <ul className={styles.guideList}>
          <li>
            <strong>Required Permissions:</strong> A Classic Personal Access Token with{" "}
            <code>repo</code> (full control of repositories) and <code>read:org</code> (read org membership).
            For workflows, enable <code>workflow</code>.
          </li>
          <li>
            <strong>Hosted Method:</strong> Uses GitHub's official remote MCP server — nothing runs on your
            machine. Available on every GitHub plan; members of Copilot Business/Enterprise orgs need the
            "MCP servers in Copilot" policy enabled.
          </li>
          <li>
            <strong>NPX Method:</strong> Runs <code>@modelcontextprotocol/server-github</code>, which npm marks as
            no longer supported. Requires Node.js 18+ on your host machine.
          </li>
          <li>
            <strong>Docker Method:</strong> Useful if you want complete sandboxing without Node.js installed.
          </li>
          <li>
            <strong>Agent Integration:</strong> Once connected, the agent automatically gains access to
            tools such as <code>search_repositories</code>, <code>get_file_contents</code>,{" "}
            <code>create_issue</code>, and <code>create_pull_request</code>.
          </li>
        </ul>
      </div>
    </>
  );
}
