import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { BakaAgent } from "../agent.ts";

function createRefreshSkillTool(agent: BakaAgent) {

  const refreshSkillTool: AgentTool = {
    name: "refresh_skill_reg",
    label: "Refresh Skill Reg",
    description: "刷新skill目录（Skill目录修改需要在下一轮对话（用户发出下一消息）才能生效）",
    parameters: Type.Object({}),
    execute: async (_id, params) => {
      await agent.refreshSkillRegistry();
      return {
        content: [{ type: "text", text: "Skill 目录已刷新..." }],
        details: {},
      };
    },
  };

  return refreshSkillTool;
}

export { createRefreshSkillTool }