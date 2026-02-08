
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from 'child_process';
import * as fs from "fs/promises";
import * as path from "path";

function processPath(path: string) {
  path = path.replace(/^~/, process.env.HOME!);
  return path;
}

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
    const process = spawn("python3", ["-c", code], {
      maxBuffer: maxBufferBytes, // 5MB 缓冲区
      timeout: timeoutMs, // 30 秒超时
    });

    let stdout = "";
    let stderr = "";

    process.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    const timeoutHandle = setTimeout(() => {
      if (!completed) {
        completed = true;
        process.kill("SIGKILL");
        resolve({
          stdout,
          stderr: stderr + "\n[ERROR] Process timeout after " + timeoutMs + "ms",
          exitCode: null,
        });
      }
    }, timeoutMs + 1000);

    process.on("close", (exitCode) => {
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

    process.on("error", (error) => {
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
  execute: async (toolCallId, params, signal, onUpdate) => {
    console.log(`Executing Python code: ${params.code}`);

    // 步骤1: 验证代码安全性
    const validation = await validatePythonCode(params.code);
    if (!validation.valid) {
      const errorMessages = validation.errors
        ?.map((err) => `[${err.type}] ${err.message || err.name || "Unknown error"}`)
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
  execute: async (toolCallId, params, signal, onUpdate) => {
    const path = processPath(params.path);
    console.log(`Reading file: ${path}`);
    const content = await fs.readFile(path, "utf-8");

    // // Optional: stream progress
    // onUpdate?.({ content: [{ type: "text", text: "Reading..." }], details: {} });

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
  execute: async (toolCallId, params, signal, onUpdate) => {
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
  execute: async (toolCallId, params, signal, onUpdate) => {
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
  execute: async (toolCallId, params, signal, onUpdate) => {
    console.log(`Continuing response`);
    return {
      content: [{ type: "text", text: "Please continue your response..." }],
      details: {},
    }
  }
}

export { readFileTool, listDirTool, webFetchTool, continueTool, pythonTool};