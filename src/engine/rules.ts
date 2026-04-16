import { readFile, access } from "fs/promises";
import { join, basename } from "path";
import type { DeploymentConfig } from "@/types";

const ENTRYPOINT_CANDIDATES = [
  "index.ts", "server.ts", "app.ts", "main.ts",
  "index.js", "server.js", "app.js", "main.js",
  "index.mjs", "server.mjs", "app.mjs",
];

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
): Promise<{ framework: "none" | "nextjs" | "laravel" | "static"; runtime: "bun" | "node" | "php" }> {
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
    if (pkg.engines?.node) return "node";
    // If start script uses node explicitly, it's a node project
    if (pkg.scripts?.start?.match(/^node\s/)) return "node";
  } catch {}

  // If package-lock.json or yarn.lock exists, likely node
  if (await fileExists(join(projectDir, "package-lock.json"))) return "node";
  if (await fileExists(join(projectDir, "yarn.lock"))) return "node";

  return "bun"; // default
}

async function findEntrypoint(
  projectDir: string,
  framework: "none" | "nextjs" | "laravel" | "static"
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

async function isStaticSite(projectDir: string): Promise<boolean> {
  // Static site: has index.html but no TypeScript/JavaScript entrypoint
  if (!(await fileExists(join(projectDir, "index.html")))) return false;

  // If any entrypoint candidate exists, it's not a pure static site
  for (const name of ENTRYPOINT_CANDIDATES) {
    if (await fileExists(join(projectDir, name))) return false;
    if (await fileExists(join(projectDir, `src/${name}`))) return false;
  }

  return true;
}

function generateStaticEntrypoint(): string {
  return `import { readdir } from "fs/promises";
import { join, extname } from "path";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf",
};

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(".", path));
    if (await file.exists()) {
      const mime = MIME[extname(path)] || "application/octet-stream";
      return new Response(file, { headers: { "Content-Type": mime } });
    }
    // Try .html extension for clean URLs
    const htmlFile = Bun.file(join(".", path + ".html"));
    if (await htmlFile.exists()) {
      return new Response(htmlFile, { headers: { "Content-Type": "text/html" } });
    }
    // Fallback to index.html for SPA routing
    const indexFile = Bun.file("./index.html");
    if (await indexFile.exists()) {
      return new Response(indexFile, { headers: { "Content-Type": "text/html" } });
    }
    return new Response("Not Found", { status: 404 });
  },
});
`;
}

async function detectPort(
  projectDir: string,
  entrypoint: string,
  framework: "none" | "nextjs" | "laravel" | "static"
): Promise<number> {
  if (framework === "static") return 3000;
  if (framework === "nextjs") return 3000;
  if (framework === "laravel") return 8000;

  try {
    const content = await readFile(join(projectDir, entrypoint), "utf-8");

    // Match port: 3000 or port: "3000"
    const bunServeMatch = content.match(/port:\s*["']?(\d+)["']?/);
    if (bunServeMatch) return parseInt(bunServeMatch[1], 10);

    // Match .listen(3000) or .listen(3000, ...) or .listen("3000")
    const listenMatch = content.match(/\.listen\(["']?(\d+)["']?/);
    if (listenMatch) return parseInt(listenMatch[1], 10);

    // Match PORT env with fallback: process.env.PORT || 3000
    const envPortMatch = content.match(/process\.env\.PORT\s*\|\|\s*(\d+)/);
    if (envPortMatch) return parseInt(envPortMatch[1], 10);
  } catch {}

  return 3000; // fallback
}

async function detectDockerfile(projectDir: string): Promise<string | null> {
  if (await fileExists(join(projectDir, "Dockerfile"))) return "Dockerfile";
  return null;
}

async function parseDockerfilePort(projectDir: string): Promise<number | null> {
  try {
    const content = await readFile(join(projectDir, "Dockerfile"), "utf-8");
    const match = content.match(/^EXPOSE\s+(\d+)/m);
    if (match) return parseInt(match[1], 10);
  } catch {}
  return null;
}

export { generateStaticEntrypoint };

export async function inspectProject(projectDir: string): Promise<DeploymentConfig> {
  const dockerfile = await detectDockerfile(projectDir);
  const name = basename(projectDir);

  // If Dockerfile present, prioritize it and parse EXPOSE for port
  if (dockerfile) {
    const dockerPort = await parseDockerfilePort(projectDir);
    const { framework, runtime } = await detectFramework(projectDir);
    const entrypoint = await findEntrypoint(projectDir, framework);
    return {
      name,
      runtime,
      framework,
      entrypoint,
      port: dockerPort || 3000,
      dockerfile,
    };
  }

  // Check for static site (index.html, no entrypoint files)
  if (await isStaticSite(projectDir)) {
    // Generate a Bun file server for static content
    const serverPath = join(projectDir, "_serve.ts");
    const { writeFile } = await import("fs/promises");
    await writeFile(serverPath, generateStaticEntrypoint());
    return {
      name,
      runtime: "bun",
      framework: "static" as DeploymentConfig["framework"],
      entrypoint: "_serve.ts",
      port: 3000,
      dockerfile: null,
    };
  }

  const { framework, runtime } = await detectFramework(projectDir);
  const entrypoint = await findEntrypoint(projectDir, framework);
  const port = await detectPort(projectDir, entrypoint, framework);

  return { name, runtime, framework, entrypoint, port, dockerfile };
}
