import React, { useState, useEffect } from "react";
import {
  Key,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Power,
  Trash2,
  ShieldCheck,
  Terminal,
  HelpCircle,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AtlassianIcon, JiraIcon, ConfluenceIcon } from "./icons";
import {
  ATLASSIAN_PRESETS,
  DEFAULT_ATLASSIAN_FORM_DATA,
  atlassianFormToConfig,
  configToAtlassianForm,
  validateAtlassianInputs,
  normalizeInstanceUrl,
} from "./atlassianConfig";
import type { AtlassianMcpFormData, AtlassianIntegrationMethod } from "./types";
import { testMcpConnection, type McpTestResult } from "../../../harness/core/mcpTestConnection";
import { useWorkspaceStore } from "../../../store";
import styles from "./SpecializedMcp.module.css";

export const AtlassianMcpTab: React.FC = () => {
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const addMcpServer = useWorkspaceStore((state) => state.addMcpServer);
  const updateMcpServer = useWorkspaceStore((state) => state.updateMcpServer);
  const removeMcpServer = useWorkspaceStore((state) => state.removeMcpServer);

  // Find existing server named 'atlassian' or matching Atlassian
  const existingServer =
    mcpServers.atlassian ||
    Object.values(mcpServers).find((s) => s.name.toLowerCase().includes("atlassian"));

  const [formData, setFormData] = useState<AtlassianMcpFormData>(() =>
    configToAtlassianForm(existingServer)
  );

  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: "idle" | "success" | "error";
    message: string;
    tools?: string[];
  }>({ status: "idle", message: "" });
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Re-sync if existingServer changes externally
  useEffect(() => {
    if (existingServer) {
      setFormData(configToAtlassianForm(existingServer));
    }
  }, [existingServer]);

  const handleFieldChange = <K extends keyof AtlassianMcpFormData>(
    field: K,
    value: AtlassianMcpFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setSaveSuccessMessage(null);
  };

  const handleOpenTokenHelp = async () => {
    const tokenUrl = "https://id.atlassian.com/manage-profile/security/api-tokens";
    try {
      await openUrl(tokenUrl);
    } catch {
      window.open(tokenUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleTestConnection = async () => {
    const validationError = validateAtlassianInputs(formData);
    if (validationError) {
      setTestResult({ status: "error", message: validationError });
      return;
    }

    setTesting(true);
    setTestResult({ status: "idle", message: "Connecting to Atlassian MCP server..." });

    try {
      const config = atlassianFormToConfig(formData);
      const result: McpTestResult = await testMcpConnection(config);
      setTestResult({
        status: "success",
        message: `Connected successfully! Discovered ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
        tools: result.tools,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({
        status: "error",
        message: `Connection failed: ${msg}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const validationError = validateAtlassianInputs(formData);
    if (validationError) {
      setTestResult({ status: "error", message: validationError });
      return;
    }

    const config = atlassianFormToConfig(formData);
    addMcpServer(config);
    setSaveSuccessMessage("Atlassian MCP configuration saved and activated!");
    setTimeout(() => setSaveSuccessMessage(null), 4000);
  };

  const handleToggleEnabled = () => {
    if (!existingServer) return;
    updateMcpServer(existingServer.name, { enabled: !existingServer.enabled });
    setFormData((prev) => ({ ...prev, enabled: !existingServer.enabled }));
  };

  const handleDisconnect = () => {
    if (!existingServer) return;
    removeMcpServer(existingServer.name);
    setFormData({ ...DEFAULT_ATLASSIAN_FORM_DATA, apiToken: "" });
    setTestResult({ status: "idle", message: "" });
  };

  const isConfigured = Boolean(existingServer);
  const isEnabled = existingServer?.enabled ?? formData.enabled;

  return (
    <div className={styles.container}>
      {/* Header Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerLeft}>
          <div className={styles.brandIconWrapper}>
            <AtlassianIcon size={28} />
          </div>
          <div className={styles.headerText}>
            <div className="flex items-center gap-2">
              <h3 className={styles.title}>Atlassian MCP Integration</h3>
              {isConfigured ? (
                <span
                  className={`${styles.statusPill} ${
                    isEnabled ? styles.statusPillActive : styles.statusPillDisabled
                  }`}
                >
                  <span className={styles.statusDot} />
                  {isEnabled ? "Connected & Active" : "Configured (Disabled)"}
                </span>
              ) : (
                <span className={styles.statusPill}>
                  <span className={styles.statusDot} />
                  Not Configured
                </span>
              )}
            </div>
            <p className={styles.description}>
              Equips Rusty with specialized tools to read, create, and transition Jira issues, track
              sprints, and query Confluence workspace documentation.
            </p>
          </div>
        </div>

        {isConfigured && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleEnabled}
              className={`${styles.buttonSecondary} ${
                isEnabled ? "text-[var(--color-status-success)]" : "text-[var(--color-fg-muted)]"
              }`}
              title={isEnabled ? "Disable server" : "Enable server"}
            >
              <Power size={14} />
              <span>{isEnabled ? "Enabled" : "Disabled"}</span>
            </button>
            <button
              onClick={handleDisconnect}
              className={styles.buttonDanger}
              title="Remove Atlassian integration"
            >
              <Trash2 size={14} />
              <span>Disconnect</span>
            </button>
          </div>
        )}
      </div>

      {/* Preset Integration Method Selector */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          <Terminal size={15} />
          <span>Integration Method</span>
        </h4>
        <div className={styles.presetGrid}>
          {ATLASSIAN_PRESETS.map((preset) => {
            const isActive = formData.method === preset.id;
            const PresetIcon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleFieldChange("method", preset.id as AtlassianIntegrationMethod)}
                className={`${styles.presetCard} ${isActive ? styles.presetCardActive : ""}`}
              >
                <div>
                  <div className={styles.presetTop}>
                    <div className={styles.presetNameRow}>
                      <span className={styles.presetIconWrap}>
                        <PresetIcon size={13} />
                      </span>
                      <span className={styles.presetName}>{preset.name}</span>
                    </div>
                    <span className={styles.presetBadge}>{preset.badge}</span>
                  </div>
                  <p className={styles.presetDesc}>{preset.description}</p>
                </div>
                <div className={styles.presetCodeRow} title={preset.commandPreview}>
                  <Terminal size={11} className={styles.presetCodeIcon} />
                  <span className={styles.presetCode}>{preset.commandPreview}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

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
                  placeholder="ghcr.io/soopk/mcp-atlassian"
                  value={formData.dockerImage}
                  onChange={(e) => handleFieldChange("dockerImage", e.target.value)}
                  className={styles.input}
                />
              </div>
              <span className={styles.fieldHint}>
                Container image tag to run (defaults to <code>ghcr.io/soopk/mcp-atlassian</code>).
              </span>
            </div>
          )}

          {/* Atlassian Site / Instance URL */}
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
                Create an API token in your Atlassian Account Security settings. Supports <code>{"${ENV_VAR}"}</code>.
              </span>
            </div>
          </div>

          {/* Enabled Modules / Products */}
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

      {/* Guide Callout */}
      <div className={styles.guideCard}>
        <h5 className={styles.guideTitle}>
          <HelpCircle size={15} className="text-[var(--color-primary)]" />
          <span>Atlassian MCP Capabilities & Setup Tips</span>
        </h5>
        <ul className={styles.guideList}>
          <li>
            <strong>Generating an API Token:</strong> Sign in to{" "}
            <code>id.atlassian.com/manage-profile/security/api-tokens</code>, click "Create API token",
            give it a label (e.g. <code>Rusty IDE</code>), and paste the generated string above.
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
    </div>
  );
};
