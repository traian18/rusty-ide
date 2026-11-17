import React from "react";
import { Check, Plus, Save, Wand2, Plug } from "lucide-react";
import { SKILL_TOOLS } from "../service/skillTools";
import { CustomSelect } from "../../../lib/ui/CustomSelect";
import { Button } from "../../../lib/ui";
import type { SkillsTabModel } from "./useSkillsTab";
import styles from "./SkillsTab.module.css";

export function SkillEditor({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { modelOptions, unauthenticatedProviders, mcpServers, editingSkill, isGenerating, generateError, genModel, genDescription, setEditingSkill, setGenModel, setGenDescription, isDirty, handleNewSkill, handleSave, handleToolToggle, handleMcpToggle, handleGenerateWithAI } = model;

  return (
    <>
        <div className="min-w-0">
          {editingSkill ? (
            <div className={styles.panel}>
              <div className={styles.fields}>
                <div className={styles.field}>
                  <label className={styles.label}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={editingSkill.name || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                    disabled={editingSkill.isBuiltIn}
                    className={styles.input}
                    placeholder="Skill name..."
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>
                    Description
                  </label>
                  <textarea
                    value={editingSkill.description || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                    rows={2}
                    className={styles.textarea}
                    placeholder="What this skill does..."
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>
                    System Prompt
                  </label>
                  <textarea
                    value={editingSkill.systemPrompt || ""}
                    onChange={(e) => setEditingSkill({ ...editingSkill, systemPrompt: e.target.value })}
                    rows={14}
                    className={`${styles.textarea} ${styles.mono}`}
                    placeholder="You are an AI coding agent specialized in..."
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>
                    Enabled Tools
                  </label>
                  <div className={styles.toolGrid}>
                    {SKILL_TOOLS.map((tool) => {
                      const isEnabled = (editingSkill.enabledTools || []).includes(tool.id);
                      return (
                        <button
                          type="button"
                          key={tool.id}
                          onClick={() => handleToolToggle(tool.id)}
                          aria-pressed={isEnabled}
                          className={`${styles.toggle} ${isEnabled ? styles.toggleOn : ""}`}
                        >
                          <span className={styles.check} aria-hidden="true">{isEnabled && <Check size={11} strokeWidth={3} />}</span>
                          <span>{tool.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>
                    Allowed MCP Servers
                  </label>
                  {Object.keys(mcpServers).length === 0 ? (
                    <p className={styles.emptyNote}>
                      No MCP servers configured. Add one via the MCP Integration tab.
                    </p>
                  ) : (
                    <div className={styles.chips}>
                      {Object.entries(mcpServers).map(([name, srv]) => {
                        const selected = (editingSkill.mcpServers || []).includes(name);
                        return (
                          <button
                            type="button"
                            key={name}
                            onClick={() => handleMcpToggle(name)}
                            aria-pressed={selected}
                            className={`${styles.chip} ${selected ? styles.toggleOn : ""}`}
                            title={srv.transport.url || srv.transport.command || name}
                          >
                            <Plug size={13} aria-hidden="true" />
                            <span>{srv.displayName || name}</span>
                            {!srv.enabled && <span className={styles.chipOff}>off</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className={styles.hint}>
                    The harness enforces these selections and the current mode. Commands and MCP servers currently require Write Files and Search Web because they can modify files and access the network.
                  </p>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>
                    Preferred Model (optional)
                  </label>
                  <div className={styles.selectNarrow}>
                    <CustomSelect
                      options={[{ id: "", name: "Default" }, ...modelOptions]}
                      value={editingSkill.preferredModel || ""}
                      onChange={(val) => setEditingSkill({ ...editingSkill, preferredModel: val || undefined })}
                      placeholder="Use default model"
                    />
                  </div>
                </div>

                <div className={styles.actions}>
                  <Button variant="primary" icon={<Save size={14} />} onClick={handleSave} disabled={!isDirty}>
                    Save
                  </Button>
                  {editingSkill.isBuiltIn && (
                    <span className={styles.hint}>
                      Built-in skill — MCP server access is saved; other edits last for this session
                    </span>
                  )}
                </div>
              </div>

              <div className={styles.generate}>
                <h3 className={styles.sectionTitle}>
                  <Wand2 size={15} aria-hidden="true" />
                  Generate with AI
                </h3>

                <div className={styles.fields}>
                  <div>
                    <div className={styles.selectNarrow}>
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
                    className={styles.textarea}
                    placeholder="Describe the skill you want the AI to generate. Be specific about its behavior, guidelines, and purpose..."
                  />
                  <div className={styles.actions}>
                    <Button
                      icon={<Wand2 size={14} />}
                      onClick={() => {
                        if (genModel && genDescription) {
                          handleGenerateWithAI(genModel, genDescription);
                        }
                      }}
                      disabled={isGenerating}
                    >
                      {isGenerating ? "Generating..." : "Generate"}
                    </Button>
                  </div>
                  {generateError && <p className={styles.error} role="alert">{generateError}</p>}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyText}>Select a skill to edit or create a new one</p>
              <Button variant="primary" icon={<Plus size={14} />} onClick={handleNewSkill}>
                New Skill
              </Button>
            </div>
          )}
        </div>
    </>
  );
}
