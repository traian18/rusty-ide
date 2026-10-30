import { skillsClient, type SkillsClient } from "../client";
import type { Skill } from "../../../store";

const SKILLS_DIR = ".rusty/skills";

export function createSkillsService(client: SkillsClient) {
  return {
  async saveSkill(rootPath: string, skill: Skill): Promise<void> {
    const dirPath = `${rootPath}/${SKILLS_DIR}`;
    try {
      await client.createDirectory(dirPath);
    } catch (e) {
      // Ignore if directory already exists
    }
    const filePath = `${dirPath}/${skill.id}.json`;
    await client.writeFile(filePath, JSON.stringify(skill, null, 2));
  },

  async deleteSkill(rootPath: string, skillId: string): Promise<void> {
    const filePath = `${rootPath}/${SKILLS_DIR}/${skillId}.json`;
    try {
      await client.deleteItem(filePath);
    } catch (e) {
      // ignore if file doesn't exist
    }
  },

  async loadSkills(rootPath: string): Promise<Skill[]> {
    try {
      const dirPath = `${rootPath}/${SKILLS_DIR}`;
      const tree = await client.listDirectory(dirPath);
      const skillFiles = (tree || []).filter((f) => f.name.endsWith(".json"));

      const skills: Skill[] = [];
      for (const file of skillFiles) {
        try {
          const content = await client.readFile(file.path);
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
}

export const skillsService = createSkillsService(skillsClient);
