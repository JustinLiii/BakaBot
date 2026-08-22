import * as fs from "node:fs/promises";
import path from "node:path";

import matter from 'gray-matter';

const defaultSkillRegSandBoxDir = "/root/.agent/skills"
function defaultSkillRegHostDir(sessionId: string) {
    return path.join(process.cwd(), "data", "sessions", sessionId, "workspace", ".agent/skills");
}

async function loadSkillRegPrompt(sessionId: string): Promise<string> {
    const skillRegDir = defaultSkillRegHostDir(sessionId);
    const sandboxSkillRegDir = defaultSkillRegSandBoxDir;
    try {
        await fs.mkdir(skillRegDir, { recursive: true }); // 目录已存在时不会报错
    } catch (err) {
        console.warn(`无法创建默认skill目录：${skillRegDir}`);
        if (err instanceof Error) {
            console.warn(err.message);
            console.warn(err.stack);
        } else {
            console.warn(`未知错误：${err}`);
        }
        return ""
    }
    let regFolder = undefined;
    try {
        regFolder = await fs.opendir(skillRegDir);
    } catch (err) {
        console.warn(`无法打开skill目录：${skillRegDir}`);
        if (err instanceof Error) {
            console.warn(err.message);
            console.warn(err.stack);
        } else {
            console.warn(`未知错误：${err}`);
        }
        return ""
    }

    let skillRegPrompt = `<system-reminder>
A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>\n`;
    for await (const dirent of regFolder) {
        const skillDocHost = path.join(skillRegDir, dirent.name, "SKILL.md");

        try {
            const skillDoc: string = await fs.readFile(skillDocHost, "utf-8");
            const skillInfo = matter(skillDoc).data
            const skillName = dirent.name; // we use dir name instead of name in metadata to ensure agent can locate the skill
            const skillDesc = "description" in skillInfo ? skillInfo.description : "";
            skillRegPrompt += `- \`${skillName}\`: ${skillDesc}\n`;
        } catch (err) {
            console.warn(`无法打开skill目录下的：${skillDocHost}, ${err}`);
        }
    }

    skillRegPrompt +=`\n\nIf the user names a skill, or the task clearly matches a skill's description, read the SKILL.md located in ${sandboxSkillRegDir}/<skill-name>/SKILL.md before taking task actions. 
Read all applicable skills, then follow their full instructions. 
For any relative directory or file mentioned in skill, try ${sandboxSkillRegDir}/<skill-name>/<relative-dir> first.
This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.

**Skill Managing**
Use \`npx skills\` to manage skills. 
By default, install with \`npx skills add <skill source> -a cline\`
Always append \`-a cline\` to install skill in \`.agent/skills\` dir so you can use it.

### Skill Source Formats
npx skills add vercel-labs/agent-skills (GitHub shorthand (owner/repo))
npx skills add https://github.com/vercel-labs/agent-skills (Full GitHub URL)
npx skills add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines (Direct path to a skill in a repo)
npx skills add git@github.com:vercel-labs/agent-skills.git (Any git URL)
npx skills add ./my-local-skills (Local path)

## \`npx skills add\` Options
| Option                    | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| \`-g, --global\`            | Install to user directory instead of project                                                                                                       |
| \`-a, --agent <agents...>\` | <!-- agent-names:start -->Target specific agents (e.g., \`claude-code\`, \`codex\`). See [Supported Agents](https://github.com/vercel-labs/skills#supported-agents) |
| \`-s, --skill <skills...>\` | Install specific skills by name (use \`'*'\` for all skills)                                                                                         |
| \`-l, --list\`              | List available skills without installing                                                                                                           |
| \`--copy\`                  | Copy files instead of symlinking to agent directories                                                                                              |
| \`-y, --yes\`               | Skip all confirmation prompts                                                                                                                      |
| \`--all\`                   | Install all skills to all agents without prompts                                                                                                   |

## Other Commands

| Command                      | Description                                   |
| ---------------------------- | --------------------------------------------- |
| \`npx skills use <source>\`    | Use one skill without installing              |
| \`npx skills list\`            | List installed skills (alias: \`ls\`)           |
| \`npx skills find [query]\`    | Search for skills interactively or by keyword |
| \`npx skills remove [skills]\` | Remove installed skills from agents           |
| \`npx skills update [skills]\` | Update installed skills to latest versions    |
| \`npx skills init [name]\`     | Create a new SKILL.md template                |

After finishing skill modification, call \`refresh_skill_reg\` tool to refresh <available_skills>. 
The skill registry will be truly refreshed in the next round of user message after calling the tool.
</system-reminder>`

    return skillRegPrompt;
}

export { loadSkillRegPrompt };