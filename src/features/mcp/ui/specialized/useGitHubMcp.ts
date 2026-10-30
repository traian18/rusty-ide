import { useState, useEffect } from "react";
import { openUrl } from "../../../../lib/platform/opener";
import { GITHUB_PRESETS, DEFAULT_GITHUB_FORM_DATA, githubFormToConfig, configToGithubForm, validateGitHubInputs } from "../../service/githubConfig";
import type { GitHubMcpFormData } from "../../service/specializedTypes";
import { testMcpConnection, type McpTestResult } from "../../../../harness/core/mcpTestConnection";
import { useWorkspaceStore } from "../../../../store";

export function useGitHubMcp() {
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

  return {
    formData,
    setFormData,
    showToken,
    setShowToken,
    testing,
    setTesting,
    testResult,
    setTestResult,
    saveSuccessMessage,
    setSaveSuccessMessage,
    mcpServers,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    existingServer,
    handleFieldChange,
    handleOpenTokenHelp,
    handleTestConnection,
    handleSave,
    handleToggleEnabled,
    handleDisconnect,
    isLocalServer,
    isConfigured,
    isEnabled,
  };
}

export type GitHubMcpModel = ReturnType<typeof useGitHubMcp>;
