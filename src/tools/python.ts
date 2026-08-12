import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import * as path from "path";

interface PythonValidationError {
  type: string;
  message?: string;
  name?: string;
  line?: number;
}

interface PythonValidationResult {
  valid: boolean;
  errors?: PythonValidationError[];
}

async function validatePythonCode(code: string): Promise<PythonValidationResult> {
  try {
    const validatorPath = path.join(__dirname, "..", "utils", "python_validator.py");
    const result = spawnSync("python3", [validatorPath, code], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    });

    if (result.error) {
      return {
        valid: false,
        errors: [{ type: "validation_error", message: result.error.message }],
      };
    }

    return JSON.parse(result.stdout) as PythonValidationResult;
  } catch (error: any) {
    return {
      valid: false,
      errors: [{
        type: "validation_error",
        message: error.message || "Failed to validate code",
      }],
    };
  }
}

function executePythonWithLimits(
  code: string,
  timeoutMs: number = 30000,
  maxBufferBytes: number = 5 * 1024 * 1024,
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
        resolve({ stdout, stderr, exitCode });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutHandle);
      if (!completed) {
        completed = true;
        resolve({ stdout, stderr: error.message, exitCode: -1 });
      }
    });
  });
}

export const pythonTool: AgentTool = {
  name: "python",
  label: "Python Executor",
  description: "Execute Python code with security checks",
  parameters: Type.Object({
    code: Type.String({ description: "Python code to execute" }),
  }),
  execute: async (toolCallId, params: any, signal, onUpdate) => {
    console.log(`Executing Python code: ${params.code}`);

    const validation = await validatePythonCode(params.code);
    if (!validation.valid) {
      const errorMessages = validation.errors
        ?.map((error) => `[${error.type}] ${error.message || error.name || "Unknown error"}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Security validation failed:\n${errorMessages}` }],
        details: {
          error: "Code security validation failed",
          validationErrors: validation.errors,
        },
      };
    }

    const result = await executePythonWithLimits(params.code, 30000, 5 * 1024 * 1024);
    if (result.exitCode !== 0) {
      return {
        content: [{
          type: "text",
          text: result.stderr || `Process exited with code ${result.exitCode}`,
        }],
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
      details: { exitCode: result.exitCode },
    };
  },
};
