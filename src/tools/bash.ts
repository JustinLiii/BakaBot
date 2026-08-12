import { createHash, randomUUID } from "crypto";
import { spawn } from "child_process";
import type { ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const SANDBOX_IMAGE = "juztinlii/bakabot-sandbox";
const COMMAND_TIMEOUT_MS = 60000;
const CONTAINER_HOME = "/root";
const SANDBOX_STATE_DIR = ".bakabot";

type BashToolDetails = {
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

type RunningCommand = {
  id: string;
  process: ChildProcessWithoutNullStreams;
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function getSessionPath(sessionId: string): Promise<string> {
  const sessionPath = path.resolve(process.cwd(), "data", "sessions", sessionId, "workspace");
  await fs.mkdir(path.join(sessionPath, SANDBOX_STATE_DIR, "run"), { recursive: true });
  return sessionPath;
}

function getContainerName(sessionId: string): string {
  const sessionHash = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return `bakabot-${sessionHash}`;
}

function formatResult(result: ProcessResult): AgentToolResult<BashToolDetails> {
  return {
    content: [{
      type: "text",
      text: result.stdout + (result.stderr ? `\nErrors/Stderr:\n${result.stderr}` : ""),
    }],
    details: result,
  };
}

export class BashSandbox {
  readonly containerName: string;

  private readonly sessionId: string;
  private sessionPath?: string;
  private activeCommand?: RunningCommand;
  private executionQueue: Promise<void> = Promise.resolve();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.containerName = getContainerName(sessionId);
  }

  async execute(command: string, signal?: AbortSignal): Promise<AgentToolResult<BashToolDetails>> {
    const previousExecution = this.executionQueue;
    let releaseExecution!: () => void;
    this.executionQueue = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });

    await previousExecution;
    try {
      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: "[ERROR] Command aborted before execution." }],
          details: { stdout: "", stderr: "", error: "aborted" },
        };
      }
      return await this.executeNow(command, signal);
    } finally {
      releaseExecution();
    }
  }

  async killActiveProcess(): Promise<void> {
    const activeCommand = this.activeCommand;
    if (!activeCommand) return;

    await this.killCommandInContainer(activeCommand.id);
    activeCommand.process.kill("SIGKILL");
  }

  async killContainer(): Promise<void> {
    await this.killActiveProcess();
    const inspected = await this.runDocker(["inspect", this.containerName]);
    if (inspected.exitCode !== 0) return;

    const killed = await this.runDocker(["kill", this.containerName]);
    if (killed.exitCode !== 0 && !killed.stderr.includes("is not running")) {
      throw new Error(`Failed to kill sandbox container ${this.containerName}: ${killed.stderr.trim()}`);
    }
  }

  private async executeNow(command: string, signal?: AbortSignal): Promise<AgentToolResult<BashToolDetails>> {
    await this.ensureContainer();

    const commandId = randomUUID();
    const pidFile = `${CONTAINER_HOME}/${SANDBOX_STATE_DIR}/run/${commandId}.pid`;
    const cwdFile = `${CONTAINER_HOME}/${SANDBOX_STATE_DIR}/cwd`;
    const nextCwdFile = `${cwdFile}.${commandId}`;
    const wrapper = [
      "command=$1",
      "pid_file=$2",
      "cwd_file=$3",
      "next_cwd_file=$4",
      `cwd=${CONTAINER_HOME}`,
      "if [ -f \"$cwd_file\" ]; then IFS= read -r saved_cwd < \"$cwd_file\"; [ -d \"$saved_cwd\" ] && cwd=$saved_cwd; fi",
      "setsid bash -lc 'source /root/.bashrc 2>/dev/null || true; cd -- \"$1\" || cd /root; eval \"$2\"; status=$?; pwd -P > \"$3\"; exit $status' bash \"$cwd\" \"$command\" \"$next_cwd_file\" &",
      "child_pid=$!",
      "printf '%s\\n' \"$child_pid\" > \"$pid_file\"",
      "wait \"$child_pid\"",
      "status=$?",
      "if [ -f \"$next_cwd_file\" ]; then mv -f \"$next_cwd_file\" \"$cwd_file\"; fi",
      "rm -f \"$pid_file\" \"$next_cwd_file\"",
      "exit \"$status\"",
    ].join("\n");

    console.log(`[Bash] Session: ${this.sessionId}, Container: ${this.containerName}, Command: ${command}`);
    const proc = spawn("docker", [
      "exec", "-i", "-w", CONTAINER_HOME,
      this.containerName,
      "bash", "-c", wrapper, "bash", command, pidFile, cwdFile, nextCwdFile,
    ]);
    this.activeCommand = { id: commandId, process: proc };

    return await new Promise<AgentToolResult<BashToolDetails>>((resolve) => {
      let stdout = "";
      let stderr = "";
      let completed = false;

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const finish = (result: AgentToolResult<BashToolDetails>): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutHandle);
        signal?.removeEventListener("abort", abortHandler);
        if (this.activeCommand?.id === commandId) this.activeCommand = undefined;
        resolve(result);
      };

      const stopCommand = async (error: "aborted" | "timeout"): Promise<void> => {
        if (completed) return;
        await this.killCommandInContainer(commandId);
        proc.kill("SIGKILL");
        const message = error === "timeout"
          ? `[ERROR] Command timed out after ${COMMAND_TIMEOUT_MS}ms`
          : "[ERROR] Command aborted.";
        finish({
          content: [{ type: "text", text: stdout + `\n${message}\n` + stderr }],
          details: { stdout, stderr, error },
        });
      };

      const abortHandler = (): void => {
        void stopCommand("aborted");
      };
      signal?.addEventListener("abort", abortHandler, { once: true });

      const timeoutHandle = setTimeout(() => {
        void stopCommand("timeout");
      }, COMMAND_TIMEOUT_MS);

      proc.on("close", (exitCode: number | null) => {
        finish(formatResult({ exitCode, stdout, stderr }));
      });
      proc.on("error", (error: Error) => {
        finish({
          content: [{ type: "text", text: `Failed to execute command in Docker: ${error.message}` }],
          details: { stdout, stderr, error: error.message },
        });
      });
    });
  }

  private async ensureContainer(): Promise<void> {
    const inspected = await this.runDocker(["inspect", "--format", "{{.State.Running}}", this.containerName]);
    if (inspected.exitCode === 0) {
      if (inspected.stdout.trim() !== "true") {
        const started = await this.runDocker(["start", this.containerName]);
        if (started.exitCode !== 0) {
          throw new Error(`Failed to start sandbox container ${this.containerName}: ${started.stderr.trim()}`);
        }
      }
      return;
    }

    const sessionPath = this.sessionPath ?? await getSessionPath(this.sessionId);
    this.sessionPath = sessionPath;
    const created = await this.runDocker([
      "run", "-d",
      "--name", this.containerName,
      "--memory", "512m",
      "--cpus", "0.5",
      "--label", "bakabot.sandbox=true",
      "--label", `bakabot.session=${createHash("sha256").update(this.sessionId).digest("hex")}`,
      "-v", `${sessionPath}:${CONTAINER_HOME}`,
      "-w", CONTAINER_HOME,
      SANDBOX_IMAGE,
      "sleep", "infinity",
    ]);
    if (created.exitCode !== 0) {
      throw new Error(`Failed to create sandbox container ${this.containerName}: ${created.stderr.trim()}`);
    }
  }

  private async killCommandInContainer(commandId: string): Promise<void> {
    const pidFile = `${CONTAINER_HOME}/${SANDBOX_STATE_DIR}/run/${commandId}.pid`;
    const script = [
      "pid_file=$1",
      "if [ ! -f \"$pid_file\" ]; then exit 0; fi",
      "IFS= read -r pid < \"$pid_file\"",
      "case \"$pid\" in ''|*[!0-9]*) rm -f \"$pid_file\"; exit 0;; esac",
      "kill -TERM -- \"-$pid\" 2>/dev/null || true",
      "for _ in 1 2 3 4 5; do kill -0 \"$pid\" 2>/dev/null || break; sleep 0.1; done",
      "kill -KILL -- \"-$pid\" 2>/dev/null || true",
      "rm -f \"$pid_file\"",
    ].join("\n");
    await this.runDocker(["exec", this.containerName, "bash", "-c", script, "bash", pidFile]);
  }

  private async runDocker(args: string[]): Promise<ProcessResult> {
    return await new Promise<ProcessResult>((resolve, reject) => {
      const proc = spawn("docker", args);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      proc.on("close", (exitCode: number | null) => {
        resolve({ exitCode, stdout, stderr });
      });
      proc.on("error", reject);
    });
  }
}

export const createBashTool = (sandbox: BashSandbox): AgentTool => ({
  name: "bash",
  label: "Bash Executor",
  description: "Execute Bash commands in a persistent per-session Docker container with Python 3.12. The working directory, files under /root, installed packages, and background processes persist between calls. Limits: 512MB RAM, 0.5 CPU.",
  parameters: Type.Object({
    command: Type.String({ description: "The Bash command to execute" }),
  }),
  execute: async (_toolCallId, params: unknown, signal): Promise<AgentToolResult<BashToolDetails>> => {
    try {
      const command = (params as { command: string }).command;
      return await sandbox.execute(command, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to use Docker sandbox: ${message}` }],
        details: { stdout: "", stderr: "", error: message },
      };
    }
  },
});
