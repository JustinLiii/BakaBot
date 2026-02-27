import fs from 'fs/promises';
import path from 'path';

const SKILLS_DIR = './data/skills'; // 相对于BakaBot项目根目录

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
}

export const skillTool = {
  name: 'skill_manager',
  description: '管理技能的工具，可以列出、加载、安装技能',
  parameters: {
    action: {
      type: 'string',
      description: '要执行的操作：list_skills, load_skill, install_skill',
      required: true
    },
    skill_id: {
      type: 'string',
      description: '技能ID（仅load_skill和install_skill需要）',
      required: false
    },
    skill_content: {
      type: 'string',
      description: '技能内容（仅install_skill需要）',
      required: false
    }
  },
  execute: async (args: any) => {
    const { action, skill_id, skill_content } = args;
    
    switch (action) {
      case 'list_skills':
        return await listSkills();
      case 'load_skill':
        if (!skill_id) throw new Error('需要skill_id参数');
        return await loadSkill(skill_id);
      case 'install_skill':
        if (!skill_id || !skill_content) throw new Error('需要skill_id和skill_content参数');
        return await installSkill(skill_id, skill_content);
      default:
        throw new Error(`未知操作: ${action}`);
    }
  }
};

async function listSkills(): Promise<string> {
  try {
    // 确保目录存在
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    
    const files = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skillDirs = files.filter(f => f.isDirectory());
    
    if (skillDirs.length === 0) {
      return "🎯 **可用Skill列表**\n\n目前还没有安装任何技能呢～\n\n💡 使用install_skill来安装新技能吧！(◕ᴗ◕✿)";
    }
    
    let result = "🎯 **可用Skill列表**\n\n";
    for (const dir of skillDirs) {
      const skillPath = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillPath, 'utf-8');
        const firstLine = content.split('\n')[0];
        const name = firstLine.replace('#', '').trim();
        result += `• **${dir.name}**: ${name}\n`;
      } catch {
        result += `• **${dir.name}**: (未找到描述文件)\n`;
      }
    }
    
    result += "\n💡 使用install_skill安装新技能，load_skill查看详细描述";
    return result;
  } catch (error) {
    return `读取技能列表失败: ${error}`;
  }
}

async function loadSkill(skillId: string): Promise<string> {
  try {
    const skillPath = path.join(SKILLS_DIR, skillId, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    
    // 直接返回skill描述内容（渐进式披露）
    return content;
  } catch (error) {
    return `加载技能失败: ${error}\n\n请先使用install_skill安装技能 "${skillId}"`;
  }
}

async function installSkill(skillId: string, content: string): Promise<string> {
  try {
    const skillDir = path.join(SKILLS_DIR, skillId);
    await fs.mkdir(skillDir, { recursive: true });
    
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(skillPath, content, 'utf-8');
    
    return `✅ **已安装 ${skillId} skill**\n\n📁 保存到: ${skillPath}\n\n现在可以用load_skill查看详细描述了！(◡‿◡✿)`;
  } catch (error) {
    return `安装技能失败: ${error}`;
  }
}
