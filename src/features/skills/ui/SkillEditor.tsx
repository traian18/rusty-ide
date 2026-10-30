import React from "react";
import { Cpu, Plus, Save, Wand2, Plug } from "lucide-react";
import { SKILL_TOOLS } from "../service/skillTools";
import { CustomSelect } from "../../../lib/ui/CustomSelect";
import type { SkillsTabModel } from "./useSkillsTab";

export function SkillEditor({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { modelOptions, unauthenticatedProviders, mcpServers, editingSkill, isGenerating, generateError, genModel, genDescription, setEditingSkill, setGenModel, setGenDescription, isDirty, handleNewSkill, handleSave, handleToolToggle, handleMcpToggle, handleGenerateWithAI } = model;

  return (
    <>
        <div className="md:col-span-3 space-y-4">
          {editingSkill ? (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-6 space-y-5">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-2">
                    Name
                  </label>
                  <input
                    type="text"
                    value={editingSkill.name || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                    disabled={editingSkill.isBuiltIn}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-50"
                    placeholder="Skill name..."
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-2">
                    Description
                  </label>
                  <textarea
                    value={editingSkill.description || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                    rows={2}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none resize-y"
                    placeholder="What this skill does..."
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-2">
                    System Prompt
                  </label>
                  <textarea
                    value={editingSkill.systemPrompt || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, systemPrompt: e.target.value })}
                    rows={14}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none resize-y font-mono"
                    placeholder="You are an AI coding agent specialized in..."
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-3">
                    Enabled Tools
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {SKILL_TOOLS.map((tool) => {
                      const isEnabled = (editingSkill.enabledTools || []).includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          onClick={() => handleToolToggle(tool.id)}
                          className={`flex items-center space-x-2 p-2 rounded-lg border transition-all text-left ${
                            isEnabled
                              ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/20 text-[var(--accent-color)]"
                              : "border-[var(--border-color)] bg-[var(--bg-app)]/50 text-[var(--text-muted)] hover:border-[var(--border-active)]"
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full ${isEnabled ? "bg-[var(--accent-color)]" : "bg-[var(--border-color)]"}`} />
                          <span className="text-xs font-bold">{tool.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-2">
                    Allowed MCP Servers
                  </label>
                  {Object.keys(mcpServers).length === 0 ? (
                    <p className="text-[10px] font-mono text-[var(--text-muted)] py-2 px-3 border border-dashed border-[var(--border-color)] rounded-lg">
                      No MCP servers configured. Add one via the MCP Integration tab.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(mcpServers).map(([name, srv]) => {
                        const selected = (editingSkill.mcpServers || []).includes(name);
                        return (
                          <button
                            key={name}
                            onClick={() => handleMcpToggle(name)}
                            className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                              selected
                                ? "border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] text-[var(--color-status-info)]"
                                : "border-[var(--border-color)] bg-[var(--bg-app)]/50 text-[var(--text-muted)] hover:border-[var(--color-status-info-border)] hover:text-[var(--text-light)]"
                            }`}
                            title={srv.transport.url || srv.transport.command || name}
                          >
                            <Plug size={12} className={selected ? "text-[var(--color-status-info)]" : "text-[var(--text-muted)]"} />
                            <span className="text-[11px] font-bold">{srv.displayName || name}</span>
                            {!srv.enabled && (
                              <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase">off</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[9px] text-[var(--text-muted)] font-mono mt-1.5">
                    The harness enforces these selections and the current mode. Commands and MCP servers currently require Write Files and Search Web because they can modify files and access the network.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono block mb-2">
                    Preferred Model (optional)
                  </label>
                  <div className="max-w-xs">
                    <CustomSelect
                      options={[{ id: "", name: "Default" }, ...modelOptions]}
                      value={editingSkill.preferredModel || ""}
                      onChange={(val) => setEditingSkill({ ...editingSkill, preferredModel: val || undefined })}
                      placeholder="Use default model"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center space-x-3">
                  <button
                    onClick={handleSave}
                    disabled={!isDirty}
                    className="flex items-center space-x-2 px-4 py-2 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--color-primary-foreground)] text-xs font-bold rounded-lg transition-colors"
                  >
                    <Save size={14} />
                    <span>Save</span>
                  </button>
                  {editingSkill.isBuiltIn && (
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">
                      Built-in skill — MCP server access is saved; other edits last for this session
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--border-color)] pt-5 space-y-4">
                <div className="flex items-center space-x-2">
                  <Wand2 size={14} className="text-[var(--accent-color)]" />
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
                    Generate with AI
                  </h3>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="flex-1 max-w-xs">
                      <CustomSelect
                        options={modelOptions}
                        value={genModel}
                        onChange={setGenModel}
                        placeholder={modelOptions.length === 0 && unauthenticatedProviders.length > 0
                          ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")}`
                          : "Select model..."}
                      />
                    </div>
                  </div>
                  <textarea
                    value={genDescription}
                    onChange={(e) => setGenDescription(e.target.value)}
                    rows={4}
                    className="w-full bg-[var(--bg-app)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-[var(--text-light)] focus:border-[var(--accent-color)] focus:outline-none resize-y font-mono"
                    placeholder="Describe the skill you want the AI to generate. Be specific about its behavior, guidelines, and purpose..."
                  />
                  <button
                    onClick={() => {
                      if (genModel && genDescription) {
                        handleGenerateWithAI(genModel, genDescription);
                      }
                    }}
                    disabled={isGenerating}
                    className="flex items-center space-x-2 px-4 py-2 bg-[var(--color-secondary)] hover:opacity-85 disabled:opacity-50 text-[var(--color-secondary-foreground)] text-xs font-bold rounded-lg transition-colors"
                  >
                    <Wand2 size={14} />
                    <span>{isGenerating ? "Generating..." : "Generate"}</span>
                  </button>
                  {generateError && (
                    <p className="text-xs text-[var(--color-status-danger)] font-mono">{generateError}</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-8 flex flex-col items-center justify-center space-y-3 text-center">
              <Cpu size={32} className="text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-muted)]">
                Select a skill to edit or create a new one
              </p>
              <button
                onClick={handleNewSkill}
                className="flex items-center space-x-2 px-4 py-2 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-[var(--color-primary-foreground)] text-xs font-bold rounded-lg transition-colors"
              >
                <Plus size={14} />
                <span>New Skill</span>
              </button>
            </div>
          )}
        </div>
    </>
  );
}
