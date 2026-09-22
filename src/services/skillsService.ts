import { invoke } from "@tauri-apps/api/core";
import type { Skill } from "../store";

const SKILLS_DIR = ".rusty/skills";

export const skillsService = {
  async saveSkill(rootPath: string, skill: Skill): Promise<void> {
    const dirPath = `${rootPath}/${SKILLS_DIR}`;
    try {
      await invoke("create_directory", { path: dirPath });
    } catch (e) {
      // Ignore if directory already exists
    }
    const filePath = `${dirPath}/${skill.id}.json`;
    await invoke("write_file_disk", { path: filePath, content: JSON.stringify(skill, null, 2) });
  },

  async deleteSkill(rootPath: string, skillId: string): Promise<void> {
    const filePath = `${rootPath}/${SKILLS_DIR}/${skillId}.json`;
    try {
      await invoke("delete_file_or_dir", { path: filePath });
    } catch (e) {
      // ignore if file doesn't exist
    }
  },

  async loadSkills(rootPath: string): Promise<Skill[]> {
    try {
      const dirPath = `${rootPath}/${SKILLS_DIR}`;
      const tree = await invoke<any[]>("get_directory_structure", { rootDir: dirPath });
      const skillFiles = (tree || []).filter((f: any) => f.name.endsWith(".json"));

      const skills: Skill[] = [];
      for (const file of skillFiles) {
        try {
          const content = await invoke<string>("read_file_disk", { path: file.path });
          const skill = JSON.parse(content) as Skill;
          skills.push(skill);
        } catch (e) {
          console.error(`Failed to load skill from ${file.path}:`, e);
        }
      }
      return skills;
    } catch (e) {
      return [];
    }
  }
};