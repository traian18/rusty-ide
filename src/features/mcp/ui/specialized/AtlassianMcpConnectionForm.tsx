import React from "react";
import { Key, ExternalLink, Eye, EyeOff, CheckCircle2, AlertCircle, RotateCw, ShieldCheck } from "lucide-react";
import { JiraIcon, ConfluenceIcon } from "./icons";
import { normalizeInstanceUrl } from "../../service/atlassianConfig";
import styles from "./SpecializedMcp.module.css";
import type { AtlassianMcpModel } from "./useAtlassianMcp";

export function AtlassianMcpConnectionForm({ model }: { model: AtlassianMcpModel }): React.ReactElement {
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
                Remote Gateway URL
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="https://your-atlassian-mcp.internal.net/sse"
                  value={formData.remoteUrl}
                  onChange={(e) => handleFieldChange("remoteUrl", e.target.value)}
                  className={styles.input}
                />
              </div>
              <span className={styles.fieldHint}>
                The HTTP or SSE endpoint for your hosted Atlassian MCP gateway or Atlassian Rovo tunnel.
              </span>
            </div>
          )}

          {formData.method === "docker" && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Docker Image</label>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="ghcr.io/sooperset/mcp-atlassian"
                  value={formData.dockerImage}
                  onChange={(e) => handleFieldChange("dockerImage", e.target.value)}
                  className={styles.input}
                />
              </div>
              <span className={styles.fieldHint}>
                Container image tag to run (defaults to <code>ghcr.io/sooperset/mcp-atlassian</code>).
              </span>
            </div>
          )}

          {/* Atlassian Site / Instance URL */}
          {isLocalServer && (
          <div className={styles.field}>
            <label className={`${styles.fieldLabel} ${styles.fieldLabelRequired}`}>
              <span>Atlassian Instance URL</span>
            </label>
            <div className={styles.inputWrapper}>
              <input
                type="text"
                placeholder="https://your-domain.atlassian.net"
                value={formData.instanceUrl}
                onChange={(e) => handleFieldChange("instanceUrl", e.target.value)}
                onBlur={() => handleFieldChange("instanceUrl", normalizeInstanceUrl(formData.instanceUrl))}
                className={styles.input}
              />
            </div>
            <span className={styles.fieldHint}>
              Your Atlassian Cloud domain (e.g. <code>https://mycompany.atlassian.net</code>).
            </span>
          </div>
          )}

          {/* Account Email and API Token in a row */}
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={`${styles.fieldLabel} ${styles.fieldLabelRequired}`}>
                Account Email
              </label>
              <input
                type="email"
                placeholder="user@example.com"
                value={formData.email}
                onChange={(e) => handleFieldChange("email", e.target.value)}
                className={styles.input}
              />
              <span className={styles.fieldHint}>Email associated with your Atlassian account.</span>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                <span className={styles.fieldLabelRequired}>API Token</span>
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
                  placeholder="Atlassian API token..."
                  value={formData.apiToken}
                  onChange={(e) => handleFieldChange("apiToken", e.target.value)}
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
                {formData.method === "hosted" ? (
                  <>
                    Use <strong>Create API token with scopes</strong> and pick the Rovo MCP{" "}
                    <code>agent-interface</code> scopes you need (e.g. <code>read:jira:agent-interface</code>).
                    Your org admin must allow API-token authentication for the Rovo MCP server.
                  </>
                ) : (
                  "Create an API token in your Atlassian Account Security settings."
                )}
              </span>
            </div>
          </div>

          {/* Enabled Modules / Products */}
          {isLocalServer && (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              <span className={styles.fieldLabelRequired}>Enabled Products</span>
            </label>
            <div className={styles.checkboxGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.enableJira}
                  onChange={(e) => handleFieldChange("enableJira", e.target.checked)}
                  className={styles.checkbox}
                />
                <span className="flex items-center gap-1.5 font-medium">
                  <JiraIcon size={16} className="text-[#0052CC]" />
                  <span>Jira (Issues, Sprints, Projects)</span>
                </span>
              </label>

              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.enableConfluence}
                  onChange={(e) => handleFieldChange("enableConfluence", e.target.checked)}
                  className={styles.checkbox}
                />
                <span className="flex items-center gap-1.5 font-medium">
                  <ConfluenceIcon size={16} className="text-[#0052CC]" />
                  <span>Confluence (Spaces, Pages, Search)</span>
                </span>
              </label>
            </div>
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
                placeholder="atlassian"
              />
              <span className={styles.fieldHint}>
                Tools will be prefixed as <code>{formData.serverName || "atlassian"}:&lt;tool&gt;</code>.
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
              <span className={styles.fieldHint}>Maximum duration for Jira/Confluence MCP tool calls.</span>
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
