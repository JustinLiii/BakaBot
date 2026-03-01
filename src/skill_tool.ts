import fs from 'fs/promises';
import path from 'path';

import { Type } from "@sinclair/typebox";
import * as yaml from 'js-yaml';
import type { AgentTool } from '@mariozechner/pi-agent-core';

// const SKILLS_DIR = './data/skills'; // 相对于BakaBot项目根目录
async function getSkillPath(sessionId: string): Promise<string> {
  const skillPath = path.resolve(process.cwd(), "data", "sessions", sessionId, "workspace", "skills");
  await fs.mkdir(skillPath, { recursive: true });
  return skillPath;
}

/**
 * 从 skill.md 文件中提取 name 和 description
 * @param filePath - skill.md 的路径
 * @returns 包含 name 和 description 的对象，若解析失败则抛出错误
 */
export async function readSkillMetadata(filePath: string) {
  const content = await fs.readFile(filePath, 'utf-8');

  // 匹配 YAML frontmatter：开头的 --- 和结束的 ---
  const match = content.match(/^---\n([\s\S]+?)\n---\n/);
  if (!match) {
    throw new Error('No YAML frontmatter found in file');
  }

  const yamlText = match[1] as string;
  const frontmatter = yaml.load(yamlText) as { name?: string; description?: string };

  if (!frontmatter.name || !frontmatter.description) {
    throw new Error('Missing required fields: name and/or description');
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

const creatSkillTool = (sessionId: string): AgentTool => ({
  name: 'list_skills',
  label: "List Skills",
  description: '列出可用的Skill',
  parameters: Type.Object({}),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    return {
      content: [
        {
          type: "text",
          text: await listSkills(sessionId),
        },
      ],
      details: {},
    }
  }
})

async function listSkills(sessionId: string): Promise<string> {
  const skill_dir = await getSkillPath(sessionId);
  
  const files = await fs.readdir(skill_dir, { withFileTypes: true });
  const skillDirs = files.filter(f => f.isDirectory());
  
  if (skillDirs.length === 0) {
    return "🎯 **可用Skill列表**\n\n目前还没有安装任何技能呢～\n\n";
  }
  
  let result = "🎯 **可用Skill列表**\n\n";
  for (const dir of skillDirs) {
    const skillPath = path.join(skill_dir, dir.name, 'SKILL.md');
    try {
      const skill_info = await readSkillMetadata(skillPath);
      result += `• **${skill_info.name}**: ${skill_info.description}\n  dir: ${path.join("root", "skills", dir.name)}\n`;
    } catch (error) {
      console.log(error);
    }
  }
  
  result += "\n用bash访问${dir}/SKILL.md读取完整内容，如需访问其中提到的资源，请加入前缀${dir}/...\n";
  return result;
}

export { creatSkillTool}
