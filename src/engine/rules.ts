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

async function detectFramework(
  projectDir: string
): Promise<{ framework: "none" | "nextjs" | "laravel"; runtime: "bun" | "node" | "php" }> {
  // Check for Laravel: artisan file or composer.json with laravel/framework
  if (await fileExists(join(projectDir, "artisan"))) {
    return { framework: "laravel", runtime: "php" };
  }
  try {
    const composer = JSON.parse(await readFile(join(projectDir, "composer.json"), "utf-8"));
    if (composer.require?.["laravel/framework"]) {
      return { framework: "laravel", runtime: "php" };
    }
  } catch {}

  // Check for Next.js: next.config.* or next in dependencies
  for (const cfg of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
    if (await fileExists(join(projectDir, cfg))) {
      return { framework: "nextjs", runtime: "node" };
    }
  }
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    if (pkg.dependencies?.next) {
      return { framework: "nextjs", runtime: "node" };
    }
  } catch {}

  // Default: detect bun vs node
  return { framework: "none", runtime: await detectRuntime(projectDir) };
}

async function detectRuntime(projectDir: string): Promise<"bun" | "node"> {
  if (await fileExists(join(projectDir, "bun.lockb"))) return "bun";

  try {
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    if (pkg.engines?.bun) return "bun";
  } catch {}

  return "bun"; // default
}

async function findEntrypoint(
  projectDir: string,
  framework: "none" | "nextjs" | "laravel"
): Promise<string> {
  if (framework === "nextjs") return "package.json"; // next start uses package.json scripts
  if (framework === "laravel") return "artisan"; // php artisan serve

  // Check package.json scripts.start
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    const startScript = pkg.scripts?.start;
    if (startScript) {
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

async function detectPort(
  projectDir: string,
  entrypoint: string,
  framework: "none" | "nextjs" | "laravel"
): Promise<number> {
  if (framework === "nextjs") return 3000;
  if (framework === "laravel") return 8000;

  try {
    const content = await readFile(join(projectDir, entrypoint), "utf-8");

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
  const { framework, runtime } = await detectFramework(projectDir);
  const entrypoint = await findEntrypoint(projectDir, framework);
  const port = await detectPort(projectDir, entrypoint, framework);
  const dockerfile = await detectDockerfile(projectDir);
  const name = basename(projectDir);

  return { name, runtime, framework, entrypoint, port, dockerfile };
}
