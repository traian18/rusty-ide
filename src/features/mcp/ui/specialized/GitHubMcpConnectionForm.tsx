import React from "react";
import { Key, ExternalLink, Eye, EyeOff, CheckCircle2, AlertCircle, RotateCw, ShieldCheck } from "lucide-react";
import styles from "./SpecializedMcp.module.css";
import type { GitHubMcpModel } from "./useGitHubMcp";

export function GitHubMcpConnectionForm({ model }: { model: GitHubMcpModel }): React.ReactElement {
  const { formData, showToken, setShowToken, testing, testResult, saveSuccessMessage, handleFieldChange, handleOpenTokenHelp, handleTestConnection, handleSave, isLocalServer, isConfigured } = model;

  return (
    <>
      {/* Connection Form */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          <Key size={15} />
          <span>Connection Credentials</span>
        </h4>

        <div className={styles.formGrid}>
          {/* Method-specific fields */}
          {formData.method === "remote_http" && (
            <div className={styles.field}>
              <label className={`${styles.fieldLabel} ${styles.fieldLabelRequired}`}>
                Remote Endpoint URL
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="https://your-github-mcp-gateway.com/sse"
                  value={formData.remoteUrl}
                  onChange={(e) => handleFieldChange("remoteUrl", e.target.value)}
                  className={styles.input}
                />
              </div>
              <span className={styles.fieldHint}>
                The HTTP or SSE URL where your GitHub MCP server is hosted.
              </span>
            </div>
          )}

          {formData.method === "docker" && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Docker Image</label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="mcp/github"
                  value={formData.dockerImage}
                  onChange={(e) => handleFieldChange("dockerImage", e.target.value)}
                  className={styles.input}
                />
              </div>
              <span className={styles.fieldHint}>
                Docker image tag to run (defaults to official <code>mcp/github</code>).
              </span>
            </div>
          )}

          {formData.method === "custom" && (
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={`${styles.fieldLabel} ${styles.fieldLabelRequired}`}>
                  Executable Command
                </label>
                <input
                  type="text"
                  placeholder="/usr/local/bin/github-mcp"
                  value={formData.customCommand}
                  onChange={(e) => handleFieldChange("customCommand", e.target.value)}
                  className={styles.input}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Arguments</label>
                <input
                  type="text"
                  placeholder="--stdio --verbose"
                  value={formData.customArgs}
                  onChange={(e) => handleFieldChange("customArgs", e.target.value)}
                  className={styles.input}
                />
              </div>
            </div>
          )}

          {/* GitHub Personal Access Token */}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <span className={styles.fieldLabelRequired}>GitHub Personal Access Token (PAT)</span>
              <button
                type="button"
                onClick={handleOpenTokenHelp}
                className={styles.linkButton}
              >
                <span>Generate Token</span>
                <ExternalLink size={11} />
              </button>
            </div>
            <div className={styles.inputWrapper}>
              <input
                type={showToken ? "text" : "password"}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_xxxxxxxxxxxx"
                value={formData.token}
                onChange={(e) => handleFieldChange("token", e.target.value)}
                className={`${styles.input} ${styles.inputWithAction}`}
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className={styles.inputIconButton}
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <span className={styles.fieldHint}>
              Saved into your encrypted workspace configuration. Classic PAT requires{" "}
              <code>repo</code> and <code>read:org</code> scopes.
              {formData.method === "hosted" &&
                " The hosted server is github.com only; for GitHub Enterprise Cloud (ghe.com) use Remote HTTP with https://copilot-api.<your-subdomain>.ghe.com/mcp."}
            </span>
          </div>

          {/* Optional GitHub Enterprise API URL (only locally run servers read it) */}
          {isLocalServer && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              <span>GitHub Enterprise API URL (Optional)</span>
            </label>
            <div className={styles.inputWrapper}>
              <input
                type="text"
                placeholder="https://github.mycompany.com/api/v3"
                value={formData.apiUrl}
                onChange={(e) => handleFieldChange("apiUrl", e.target.value)}
                className={styles.input}
              />
            </div>
            <span className={styles.fieldHint}>
              Leave empty for standard GitHub.com. Fill only if using an on-premise GitHub Enterprise instance.
            </span>
          </div>
          )}

          {/* Advanced row: Server name & Timeout */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Server Identifier</label>
              <input
                type="text"
                value={formData.serverName}
                onChange={(e) => handleFieldChange("serverName", e.target.value)}
                className={styles.input}
                placeholder="github"
              />
              <span className={styles.fieldHint}>
                Tools will be prefixed as <code>{formData.serverName || "github"}:&lt;tool&gt;</code>.
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel}>Timeout (ms)</label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => handleFieldChange("timeout", parseInt(e.target.value, 10) || 30000)}
                className={styles.input}
                min={5000}
                step={1000}
              />
              <span className={styles.fieldHint}>Maximum duration for MCP tool calls.</span>
            </div>
          </div>
        </div>

        {/* Live Test Result Banner */}
        {testResult.status !== "idle" && (
          <div
            className={`${styles.testResultCard} ${
              testResult.status === "success" ? styles.testSuccess : styles.testError
            }`}
          >
            <div className={styles.testHeader}>
              {testResult.status === "success" ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertCircle size={16} />
              )}
              <span>{testResult.message}</span>
            </div>
            {testResult.tools && testResult.tools.length > 0 && (
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-fg-muted)] tracking-wider">
                  Available Tools:
                </span>
                <div className={styles.toolListContainer}>
                  {testResult.tools.map((tool) => (
                    <span key={tool} className={styles.toolPill}>
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {saveSuccessMessage && (
          <div className={`${styles.testResultCard} ${styles.testSuccess}`}>
            <div className={styles.testHeader}>
              <CheckCircle2 size={16} />
              <span>{saveSuccessMessage}</span>
            </div>
          </div>
        )}

        {/* Action Bar */}
        <div className={styles.actionBar}>
          <div className={styles.actionGroup}>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className={styles.buttonSecondary}
            >
              <RotateCw size={14} className={testing ? "animate-spin" : ""} />
              <span>{testing ? "Testing..." : "Test Connection"}</span>
            </button>
          </div>

          <div className={styles.actionGroup}>
            <button
              type="button"
              onClick={handleSave}
              className={styles.buttonPrimary}
            >
              <ShieldCheck size={15} />
              <span>{isConfigured ? "Update Connection" : "Save & Connect"}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
