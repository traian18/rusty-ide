import { useState } from "react";
import { SKILL_TOOLS } from "../../../config/skillTools";
import { Input } from "../../ui";
import styles from "./Behaviors.module.css";

export const PROFILE_TOOLS = [
  ...SKILL_TOOLS,
  // These follow a skill grant rather than needing their own: edit_file rides on
  // Write Files, project_info on Read Files, run_check and install_dependencies on
  // Run Commands. A profile can still name them to allow or deny one on its own.
  { id: "edit_file", label: "Edit Part of a File" },
  { id: "project_info", label: "Project Info" },
  { id: "run_check", label: "Run Project Checks" },
  { id: "install_dependencies", label: "Install Dependencies" },
  { id: "open_document", label: "Open Document" },
  { id: "web_extract", label: "Extract from Web Page" },
  { id: "web_fetch", label: "Fetch Web Page" },
  { id: "report_progress", label: "Report Progress" },
  { id: "ask_user_question", label: "Ask User a Question" },
  { id: "agent_spawn", label: "Delegate to an Agent" },
  { id: "write_plan", label: "Write Plan (plan mode)" },
  { id: "decide", label: "Request a Decision (when enabled)" },
];

export function ToolSelector({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState("");
  const tools = [...PROFILE_TOOLS, ...value.filter((id) => !PROFILE_TOOLS.some((tool) => tool.id === id))
    .map((id) => ({ id, label: "Saved custom tool or pattern" }))];
  const visible = tools.filter((tool) => `${tool.label} ${tool.id}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={styles.toolSelector}>
    <Input aria-label="Search tools" placeholder="Search tools…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <p className={styles.muted}>{value.length} selected. Tools also need to be enabled by the session and its permissions.</p>
    <div className={styles.toolOptions} role="group" aria-label="Allowed tools">
      {visible.map((tool) => <label key={tool.id} className={styles.toolOption}>
        <input type="checkbox" checked={value.includes(tool.id)} onChange={(event) => onChange(event.target.checked ? [...value, tool.id] : value.filter((id) => id !== tool.id))} />
        <span>{tool.label}<small>{tool.id}</small></span>
      </label>)}
      {!visible.length ? <p className={styles.muted}>No matching tools.</p> : null}
    </div>
  </div>;
}
