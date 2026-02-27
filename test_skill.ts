import { skillTool } from './src/skill_tool';

async function test() {
  console.log("=== 测试list_skills ===");
  const listResult = await skillTool.execute({ action: 'list_skills' });
  console.log(listResult);
  
  console.log("\n=== 测试install_skill ===");
  const content = `# docx Skill\n\n我能处理Word文档！(◡‿◡✿)`;
  const installResult = await skillTool.execute({ 
    action: 'install_skill', 
    skill_id: 'docx',
    skill_content: content
  });
  console.log(installResult);
  
  console.log("\n=== 再次测试list_skills ===");
  const listResult2 = await skillTool.execute({ action: 'list_skills' });
  console.log(listResult2);
  
  console.log("\n=== 测试load_skill ===");
  const loadResult = await skillTool.execute({ 
    action: 'load_skill', 
    skill_id: 'docx'
  });
  console.log(loadResult);
}

test().catch(console.error);
