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
import { GitHubIcon } from "./icons";
import {
  GITHUB_PRESETS,
  DEFAULT_GITHUB_FORM_DATA,
  githubFormToConfig,
  configToGithubForm,
  validateGitHubInputs,
} from "./githubConfig";
import type { GitHubMcpFormData, GitHubIntegrationMethod } from "./types";
import { testMcpConnection, type McpTestResult } from "../../../harness/core/mcpTestConnection";
import { useWorkspaceStore } from "../../../store";
import styles from "./SpecializedMcp.module.css";

export const GitHubMcpTab: React.FC = () => {
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const addMcpServer = useWorkspaceStore((state) => state.addMcpServer);
  const updateMcpServer = useWorkspaceStore((state) => state.updateMcpServer);
  const removeMcpServer = useWorkspaceStore((state) => state.removeMcpServer);

  // Find existing server named 'github' or matching GitHub
  const existingServer =
    mcpServers.github ||
    Object.values(mcpServers).find((s) => s.name.toLowerCase().includes("github"));

  const [formData, setFormData] = useState<GitHubMcpFormData>(() =>
    configToGithubForm(existingServer)
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
      setFormData(configToGithubForm(existingServer));
    }
  }, [existingServer]);

  const handleFieldChange = <K extends keyof GitHubMcpFormData>(
    field: K,
    value: GitHubMcpFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setSaveSuccessMessage(null);
  };

  const handleOpenTokenHelp = async () => {
    const tokenUrl =
      "https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Rusty+IDE+GitHub+MCP";
    try {
      await openUrl(tokenUrl);
    } catch {
      window.open(tokenUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleTestConnection = async () => {
    const validationError = validateGitHubInputs(formData);
    if (validationError) {
      setTestResult({ status: "error", message: validationError });
      return;
    }

    setTesting(true);
    setTestResult({ status: "idle", message: "Connecting to GitHub MCP server..." });

    try {
      const config = githubFormToConfig(formData);
      const result: McpTestResult = await testMcpConnection(config);
      setTestResult({
        status: "success",
        message: `Connected successfully! Discovered ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`,
        tools: result.tools,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const requirements = GITHUB_PRESETS.find((preset) => preset.id === formData.method)?.requirements;
      const hint = requirements && msg.includes("was not found on your PATH") ? ` ${requirements}` : "";
      setTestResult({
        status: "error",
        message: `Connection failed: ${msg}${hint}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const validationError = validateGitHubInputs(formData);
    if (validationError) {
      setTestResult({ status: "error", message: validationError });
      return;
    }

    const config = githubFormToConfig(formData);
    addMcpServer(config);
    setSaveSuccessMessage("GitHub MCP configuration saved and activated!");
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
    setFormData({ ...DEFAULT_GITHUB_FORM_DATA, token: "" });
    setTestResult({ status: "idle", message: "" });
  };

  const isLocalServer = formData.method === "npx" || formData.method === "docker" || formData.method === "custom";
  const isConfigured = Boolean(existingServer);
  const isEnabled = existingServer?.enabled ?? formData.enabled;

  return (
    <div className={styles.container}>
      {/* Header Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerLeft}>
          <div className={styles.brandIconWrapper}>
            <GitHubIcon size={28} />
          </div>
          <div className={styles.headerText}>
            <div className="flex items-center gap-2">
              <h3 className={styles.title}>GitHub MCP Integration</h3>
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
              Allows your AI agents to explore GitHub repositories, search code, read & write issues,
              and manage pull requests directly within Rusty.
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
              title="Remove GitHub integration"
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
          {GITHUB_PRESETS.map((preset) => {
            const isActive = formData.method === preset.id;
            const PresetIcon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleFieldChange("method", preset.id as GitHubIntegrationMethod)}
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
    </div>
  );
};
