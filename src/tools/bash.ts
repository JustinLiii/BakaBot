import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

async function getSessionPath(sessionId: string): Promise<string> {
  const sessionPath = path.resolve(process.cwd(), "data", "sessions", sessionId, "workspace");
  await fs.mkdir(sessionPath, { recursive: true });
  return sessionPath;
}

export const createBashTool = (sessionId: string): AgentTool => ({
  name: "bash",
  label: "Bash Executor",
  description: "Execute bash commands in a persistent Docker container with Python 3.11 environment. Workspace is at /workspace. Files are persistent for this session. Limits: 512MB RAM, 0.5 CPU.",
  parameters: Type.Object({
    command: Type.String({ description: "The bash command to execute" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const sessionPath = await getSessionPath(sessionId);
    console.log(`[Bash] Session: ${sessionId}, Command: ${params.command}`);

    return new Promise((resolve) => {
      const dockerArgs = [
        "run", "--rm",
        "-i",
        "--memory", "512m",
        "--cpus", "0.5",
        "-v", `${sessionPath}:/root`,
        "-w", "/root",
        "juztinlii/bakabot-sandbox",
        "bash", "-c", "source /root/.bashrc && " + params.command,
      ];

      const proc = spawn("docker", dockerArgs);
      let stdout = "";
      let stderr = "";
      let completed = false;

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutMs = 60000;
      const timeoutHandle = setTimeout(() => {
        if (!completed) {
          completed = true;
          proc.kill("SIGKILL");
          resolve({
            content: [{ type: "text", text: stdout + `\n[ERROR] Command timed out after ${timeoutMs}ms\n` + stderr }],
            details: { error: "timeout", stdout, stderr },
          });
        }
      }, timeoutMs);

      proc.on("close", (exitCode) => {
        clearTimeout(timeoutHandle);
        if (!completed) {
          completed = true;
          resolve({
            content: [{ type: "text", text: stdout + (stderr ? "\nErrors/Stderr:\n" + stderr : "") }],
            details: { exitCode, stdout, stderr },
          });
        }
      });

      proc.on("error", (error) => {
        clearTimeout(timeoutHandle);
        if (!completed) {
          completed = true;
          resolve({
            content: [{ type: "text", text: `Failed to start docker: ${error.message}` }],
            details: { error: error.message },
          });
        }
      });
    });
  },
});
