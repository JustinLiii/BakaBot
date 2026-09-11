import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

type ReadImageDetails = {
  path: string;
};

type ImageSource = {
  filePath: string;
  contentType?: string | null;
};

/** Mount point of the session workspace inside the sandbox container (see bash.ts). */
const SANDBOX_HOME = "/root";

const MIME_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function mimeType(filePath: string, contentType?: string | null): string {
  const type = contentType?.split(";", 1)[0]?.trim();
  return type?.startsWith("image/")
    ? type
    : MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Translate a path the agent uses inside the sandbox into the host path of the same
 * file, given the workspace that bash.ts mounts at {@link SANDBOX_HOME}. Accepts
 * `/root`, `/root/...`, `~`, `~/...`, and paths relative to the sandbox working
 * directory (which defaults to `/root`).
 */
function toHostPath(sandboxPath: string, workspace: string): string {
  const candidate = sandboxPath.trim();

  let relative: string | undefined;
  if (candidate === SANDBOX_HOME || candidate === "~") {
    relative = "";
  } else if (candidate.startsWith(`${SANDBOX_HOME}/`)) {
    relative = candidate.slice(SANDBOX_HOME.length + 1);
  } else if (candidate.startsWith("~/")) {
    relative = candidate.slice(2);
  }

  return relative === undefined
    ? path.resolve(workspace, candidate)
    : path.join(workspace, relative);
}

/**
 * Download an image over HTTP(S) into `destinationDir` and report where it landed.
 * The file is only an internal cache for the vision content block, so it lives outside
 * the mounted workspace: the agent sees nothing but the image itself, exactly as if the
 * URL had been read directly.
 */
async function downloadImage(url: string, destinationDir: string): Promise<ImageSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);

  await fs.mkdir(destinationDir, { recursive: true });
  const filePath = path.join(
    destinationDir,
    `${randomUUID()}${path.extname(new URL(url).pathname) || ".img"}`,
  );
  await fs.writeFile(filePath, Buffer.from(await response.arrayBuffer()));

  return { filePath, contentType: response.headers.get("content-type") };
}

/**
 * Resolve a path as the agent sees it inside the sandbox to the host file the sandbox
 * mounts there, refusing anything outside the session workspace.
 */
function resolveLocalImage(source: string, workspace: string): string {
  const filePath = toHostPath(source, workspace);
  const relativePath = path.relative(workspace, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`file path must be inside the session workspace (${SANDBOX_HOME} in the sandbox)`);
  }

  return filePath;
}

export class ReadImageTool implements AgentTool {
  readonly name = "read_image";
  readonly label = "Read image";
  readonly description = `Read an image from the sandbox workspace (${SANDBOX_HOME}) or an HTTP(S) URL for vision analysis.`;
  readonly parameters = Type.Object({
    source: Type.String({ description: `Image URL or a path inside ${SANDBOX_HOME}` }),
  });

  private readonly sessionRoot: string;
  private readonly workspace: string;

  constructor(sessionId: string, root = process.cwd()) {
    this.sessionRoot = path.resolve(root, "data", "sessions", sessionId);
    this.workspace = path.join(this.sessionRoot, "workspace");
  }

  async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<ReadImageDetails>> {
    const source = typeof params === "object" && params !== null && "source" in params
      && typeof params.source === "string"
      ? params.source
      : "";

    try {
      if (!source) throw new Error("source is required");

      const image = /^https?:\/\//i.test(source)
        ? await downloadImage(source, path.join(this.sessionRoot, "tmp", "read_image"))
        : { filePath: resolveLocalImage(source, this.workspace) };

      const data = (await fs.readFile(image.filePath)).toString("base64");
      return {
        content: [{
          type: "image",
          data,
          mimeType: mimeType(image.filePath, image.contentType),
        }],
        details: { path: image.filePath },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[read_image] ${source || "<invalid source>"}: ${message}`);
      return {
        content: [{ type: "text", text: `Failed to read image: ${message}` }],
        details: { path: "" },
      };
    }
  }
}

export function createReadImageTool(sessionId: string, root = process.cwd()): AgentTool {
  return new ReadImageTool(sessionId, root);
}
