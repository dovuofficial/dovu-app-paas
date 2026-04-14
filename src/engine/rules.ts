import { readFile, access } from "fs/promises";
import { join, basename } from "path";
import type { DeploymentConfig } from "@/types";

const ENTRYPOINT_CANDIDATES = ["index.ts", "server.ts", "app.ts", "main.ts"];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectRuntime(projectDir: string): Promise<"bun" | "node"> {
  if (await fileExists(join(projectDir, "bun.lockb"))) return "bun";

  try {
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    if (pkg.engines?.bun) return "bun";
  } catch {}

  return "bun"; // default
}

async function findEntrypoint(projectDir: string): Promise<string> {
  // Check package.json scripts.start
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    const startScript = pkg.scripts?.start;
    if (startScript) {
      // Extract filename from "bun run index.ts" or "node server.js"
      const match = startScript.match(/(?:bun\s+run|node)\s+(\S+)/);
      if (match) {
        const candidate = match[1];
        if (await fileExists(join(projectDir, candidate))) return candidate;
      }
    }
  } catch {}

  // Check root directory
  for (const name of ENTRYPOINT_CANDIDATES) {
    if (await fileExists(join(projectDir, name))) return name;
  }

  // Check src/ directory
  for (const name of ENTRYPOINT_CANDIDATES) {
    const srcPath = `src/${name}`;
    if (await fileExists(join(projectDir, srcPath))) return srcPath;
  }

  return "index.ts"; // fallback
}

async function detectPort(projectDir: string, entrypoint: string): Promise<number> {
  try {
    const content = await readFile(join(projectDir, entrypoint), "utf-8");

    // Match Bun.serve({ port: N }) or .listen(N)
    const bunServeMatch = content.match(/port:\s*(\d+)/);
    if (bunServeMatch) return parseInt(bunServeMatch[1], 10);

    const listenMatch = content.match(/\.listen\((\d+)\)/);
    if (listenMatch) return parseInt(listenMatch[1], 10);
  } catch {}

  return 3000; // fallback
}

async function detectDockerfile(projectDir: string): Promise<string | null> {
  if (await fileExists(join(projectDir, "Dockerfile"))) return "Dockerfile";
  return null;
}

export async function inspectProject(projectDir: string): Promise<DeploymentConfig> {
  const runtime = await detectRuntime(projectDir);
  const entrypoint = await findEntrypoint(projectDir);
  const port = await detectPort(projectDir, entrypoint);
  const dockerfile = await detectDockerfile(projectDir);
  const name = basename(projectDir);

  return { name, runtime, entrypoint, port, dockerfile };
}
