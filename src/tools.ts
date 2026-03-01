
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from 'child_process';
import * as fs from "fs/promises";
import * as path from "path";

function processPath(path: string) {
  path = path.replace(/^~/, process.env.HOME!);
  return path;
}

// Ensure session directory exists and return absolute path
async function getSessionPath(sessionId: string): Promise<string> {
  const sessionPath = path.resolve(process.cwd(), "data", "sessions", sessionId, "workspace");
  await fs.mkdir(sessionPath, { recursive: true });
  return sessionPath;
}

const createBashTool = (sessionId: string): AgentTool => ({
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
        "-v", `${sessionPath}:/workspace`,
        "-w", "/workspace",
        "juztinlii/bakabot-sandbox",
        "bash", "-c", "source /root/.bashrc && " + params.command
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
            details: { error: "timeout", stdout, stderr }
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

// 验证 Python 代码的安全性
async function validatePythonCode(code: string): Promise<{
  valid: boolean;
  errors?: Array<{ type: string; message?: string; name?: string; line?: number }>;
}> {
  try {
    const validatorPath = path.join(__dirname, "utils", "python_validator.py");
    const result = spawnSync("python3", [validatorPath, code], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024, // 1MB 缓冲区
      timeout: 5000, // 5 秒超时
    });

    if (result.error) {
      return {
        valid: false,
        errors: [
          {
            type: "validation_error",
            message: result.error.message,
          },
        ],
      };
    }

    const validationResult = JSON.parse(result.stdout);
    return validationResult;
  } catch (error: any) {
    return {
      valid: false,
      errors: [
        {
          type: "validation_error",
          message: error.message || "Failed to validate code",
        },
      ],
    };
  }
}

// 在受限环境中执行 Python 代码
function executePythonWithLimits(
  code: string,
  timeoutMs: number = 30000,
  maxBufferBytes: number = 5 * 1024 * 1024
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    let completed = false;
    const proc = spawn("python3", ["-c", code]);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutHandle = setTimeout(() => {
      if (!completed) {
        completed = true;
        proc.kill("SIGKILL");
        resolve({
          stdout,
          stderr: stderr + "\n[ERROR] Process timeout after " + timeoutMs + "ms",
          exitCode: null,
        });
      }
    }, timeoutMs + 1000);

    proc.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      if (!completed) {
        completed = true;
        resolve({
          stdout,
          stderr,
          exitCode,
        });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutHandle);
      if (!completed) {
        completed = true;
        resolve({
          stdout,
          stderr: error.message,
          exitCode: -1,
        });
      }
    });
  });
}

const pythonTool: AgentTool = {
  name: "python",
  label: "Python Executor", // For UI display
  description: "Execute Python code with security checks",
  parameters: Type.Object({
    code: Type.String({ description: "Python code to execute" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log(`Executing Python code: ${params.code}`);

    // 步骤1: 验证代码安全性
    const validation = await validatePythonCode(params.code);
    if (!validation.valid) {
      const errorMessages = validation.errors
        ?.map((err: any) => `[${err.type}] ${err.message || err.name || "Unknown error"}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `Security validation failed:\n${errorMessages}`,
          },
        ],
        details: {
          error: "Code security validation failed",
          validationErrors: validation.errors,
        },
      };
    }

    // 步骤2: 在受限环境中执行代码
    const result = await executePythonWithLimits(params.code, 30000, 5 * 1024 * 1024);

    if (result.exitCode !== 0) {
      return {
        content: [
          {
            type: "text",
            text:
              result.stderr ||
              `Process exited with code ${result.exitCode}`,
          },
        ],
        details: {
          error: "Python execution error",
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };
    }

    return {
      content: [{ type: "text", text: result.stdout }],
      details: {
        exitCode: result.exitCode,
      },
    };
  },
};

const readFileTool: AgentTool = {
  name: "read_file",
  label: "Read File",  // For UI display
  description: "Read a file's contents",
  parameters: Type.Object({
    path: Type.String({ description: "File path" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const path = processPath(params.path);
    console.log(`Reading file: ${path}`);
    const content = await fs.readFile(path, "utf-8");

    return {
      content: [{ type: "text", text: content }],
      details: { path: path, size: content.length },
    };
  },
};

const listDirTool: AgentTool = {
  name: "list_dir",
  label: "List Directory", 
  description: "List the contents of a directory",
  parameters: Type.Object({
    path: Type.String({ description: "Directory path" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    const path = processPath(params.path);
    console.log(`Listing directory: ${path}`);
    const entries = await fs.readdir(path, { recursive: false});

    return {
      content: [{ type: "text", text: entries.join("\n") }],
      details: { path: path, size: entries.length },
    };
  }
}

const webFetchTool: AgentTool = {
  name: "web_fetch",
  label: "Web Fetch", 
  description: "Fetch a web resource",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log(`Fetching URL: ${params.url}`);
    const url = "https://r.jina.ai/" + params.url
    const response = await fetch(url);
    return {
      content: [{ type: "text", text: await response.text() }],
      details: { url: params.url, status: response.status },
    };
  }
}

const continueTool: AgentTool = {
  name: "continue",
  label: "Continue",
  description: "Call this tool if you want to continue your response in the next turn",
  parameters: Type.Object({}),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log(`Continuing response`);
    return {
      content: [{ type: "text", text: "Please continue your response..." }],
      details: {},
    }
  }
}

export { readFileTool, listDirTool, webFetchTool, continueTool, pythonTool, createBashTool};
