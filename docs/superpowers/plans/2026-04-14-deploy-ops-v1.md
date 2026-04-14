# deploy-ops v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that deploys Bun/JS Docker containers to pre-provisioned infrastructure (local or DigitalOcean) in seconds, with automatic project inspection, nginx routing, and deployment lifecycle management.

**Architecture:** Provider-based abstraction where the CLI, rules engine, state management, and nginx templating are provider-agnostic. A local provider uses Docker-in-Docker for development. A DigitalOcean provider uses SSH/SCP for production. State tracked locally in `.deploy-ops/state.json`.

**Tech Stack:** TypeScript, Bun runtime, Docker, nginx, SSH2 (via `ssh2` npm package for DO provider)

---

## File Map

| File | Responsibility |
|---|---|
| `src/types.ts` | All shared types: DeploymentConfig, DeploymentRecord, AppConfig, ProviderConfig |
| `src/engine/state.ts` | Read/write `.deploy-ops/config.json` and `.deploy-ops/state.json` |
| `src/engine/rules.ts` | Inspect project directory → produce DeploymentConfig |
| `src/engine/docker.ts` | Build Docker image, save to tarball |
| `src/engine/nginx.ts` | Generate nginx site config from template |
| `src/providers/provider.ts` | Provider interface definition |
| `src/providers/local.ts` | Local Docker-in-Docker provider |
| `src/providers/digitalocean.ts` | DigitalOcean SSH/SCP provider |
| `src/cli/index.ts` | CLI entry point, command routing |
| `src/cli/init.ts` | `deploy-ops init` command |
| `src/cli/deploy.ts` | `deploy-ops deploy` command |
| `src/cli/ls.ts` | `deploy-ops ls` command |
| `src/cli/status.ts` | `deploy-ops status <app>` command |
| `src/cli/logs.ts` | `deploy-ops logs <app>` command |
| `src/cli/stop.ts` | `deploy-ops stop <app>` command |
| `src/cli/destroy.ts` | `deploy-ops destroy <app>` command |
| `templates/Dockerfile.bun` | Default Dockerfile template for Bun projects |
| `templates/nginx.conf.tmpl` | Nginx site config template |
| `tests/engine/state.test.ts` | Tests for state management |
| `tests/engine/rules.test.ts` | Tests for rules engine |
| `tests/engine/nginx.test.ts` | Tests for nginx config generation |
| `tests/engine/docker.test.ts` | Tests for Docker build |
| `tests/providers/local.test.ts` | Tests for local provider |

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `src/types.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize the Bun project**

```bash
cd /Users/hecate/Documents/GitHub/deploy-ops
bun init -y
```

- [ ] **Step 2: Install dependencies**

```bash
bun add commander chalk
bun add -d @types/bun
```

`commander` for CLI argument parsing, `chalk` for colored output.

- [ ] **Step 3: Configure tsconfig.json**

Replace the generated `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.deploy-ops/
.superpowers/
*.tgz
```

- [ ] **Step 5: Create shared types**

Write `src/types.ts`:

```typescript
export interface DeploymentConfig {
  name: string;
  runtime: "bun" | "node";
  entrypoint: string;
  port: number;
  dockerfile: string | null; // null = generate one
}

export interface DeploymentRecord {
  name: string;
  image: string;
  port: number;
  hostPort: number;
  domain: string;
  containerId: string;
  status: "running" | "stopped";
  createdAt: string;
  updatedAt: string;
}

export interface StateFile {
  deployments: Record<string, DeploymentRecord>;
}

export interface LocalProviderConfig {
  baseDomain: string;
}

export interface DigitalOceanProviderConfig {
  host: string;
  sshKey: string;
  user: string;
  baseDomain: string;
}

export interface AppConfig {
  provider: "local" | "digitalocean";
  local?: LocalProviderConfig;
  digitalocean?: DigitalOceanProviderConfig;
}
```

- [ ] **Step 6: Add bin entry to package.json**

Add to `package.json`:

```json
{
  "bin": {
    "deploy-ops": "./src/cli/index.ts"
  }
}
```

- [ ] **Step 7: Verify setup**

```bash
bun run src/types.ts
```

Expected: exits cleanly with no output (types only, no runtime code).

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.json bunfig.toml src/types.ts .gitignore bun.lockb
git commit -m "feat: scaffold deploy-ops project with types"
```

---

### Task 2: State Management

**Files:**
- Create: `src/engine/state.ts`
- Create: `tests/engine/state.test.ts`

- [ ] **Step 1: Write failing tests for state management**

Write `tests/engine/state.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readConfig, writeConfig, readState, writeState, getNextPort } from "@/engine/state";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "deploy-ops-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("config", () => {
  test("writeConfig creates .deploy-ops/config.json", async () => {
    const config = { provider: "local" as const, local: { baseDomain: "ops.localhost" } };
    await writeConfig(testDir, config);
    const result = await readConfig(testDir);
    expect(result).toEqual(config);
  });

  test("readConfig returns null when no config exists", async () => {
    const result = await readConfig(testDir);
    expect(result).toBeNull();
  });
});

describe("state", () => {
  test("readState returns empty deployments when no state file", async () => {
    const state = await readState(testDir);
    expect(state).toEqual({ deployments: {} });
  });

  test("writeState persists and reads back", async () => {
    const state = {
      deployments: {
        myapp: {
          name: "myapp",
          image: "deploy-ops-myapp:abc123",
          port: 3000,
          hostPort: 3001,
          domain: "myapp.ops.localhost",
          containerId: "abc123",
          status: "running" as const,
          createdAt: "2026-04-14T12:00:00Z",
          updatedAt: "2026-04-14T12:00:00Z",
        },
      },
    };
    await writeState(testDir, state);
    const result = await readState(testDir);
    expect(result).toEqual(state);
  });
});

describe("getNextPort", () => {
  test("returns 3001 when no deployments exist", async () => {
    const port = await getNextPort(testDir);
    expect(port).toBe(3001);
  });

  test("returns next port after highest used", async () => {
    const state = {
      deployments: {
        app1: { name: "app1", image: "", port: 3000, hostPort: 3001, domain: "", containerId: "", status: "running" as const, createdAt: "", updatedAt: "" },
        app2: { name: "app2", image: "", port: 3000, hostPort: 3003, domain: "", containerId: "", status: "running" as const, createdAt: "", updatedAt: "" },
      },
    };
    await writeState(testDir, state);
    const port = await getNextPort(testDir);
    expect(port).toBe(3004);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/engine/state.test.ts
```

Expected: FAIL — module `@/engine/state` not found.

- [ ] **Step 3: Implement state management**

Write `src/engine/state.ts`:

```typescript
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { AppConfig, StateFile } from "@/types";

const CONFIG_DIR = ".deploy-ops";
const CONFIG_FILE = "config.json";
const STATE_FILE = "state.json";

function configPath(baseDir: string): string {
  return join(baseDir, CONFIG_DIR, CONFIG_FILE);
}

function statePath(baseDir: string): string {
  return join(baseDir, CONFIG_DIR, STATE_FILE);
}

async function ensureDir(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, CONFIG_DIR), { recursive: true });
}

export async function readConfig(baseDir: string): Promise<AppConfig | null> {
  try {
    const data = await readFile(configPath(baseDir), "utf-8");
    return JSON.parse(data) as AppConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(baseDir: string, config: AppConfig): Promise<void> {
  await ensureDir(baseDir);
  await writeFile(configPath(baseDir), JSON.stringify(config, null, 2) + "\n");
}

export async function readState(baseDir: string): Promise<StateFile> {
  try {
    const data = await readFile(statePath(baseDir), "utf-8");
    return JSON.parse(data) as StateFile;
  } catch {
    return { deployments: {} };
  }
}

export async function writeState(baseDir: string, state: StateFile): Promise<void> {
  await ensureDir(baseDir);
  await writeFile(statePath(baseDir), JSON.stringify(state, null, 2) + "\n");
}

export async function getNextPort(baseDir: string): Promise<number> {
  const state = await readState(baseDir);
  const ports = Object.values(state.deployments).map((d) => d.hostPort);
  if (ports.length === 0) return 3001;
  return Math.max(...ports) + 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/engine/state.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/state.ts tests/engine/state.test.ts
git commit -m "feat: add state management for config and deployments"
```

---

### Task 3: Rules Engine

**Files:**
- Create: `src/engine/rules.ts`
- Create: `tests/engine/rules.test.ts`

- [ ] **Step 1: Write failing tests for rules engine**

Write `tests/engine/rules.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { inspectProject } from "@/engine/rules";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "deploy-ops-rules-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("inspectProject", () => {
  test("detects bun runtime from bun.lockb", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp", scripts: { start: "bun run index.ts" } }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await writeFile(join(testDir, "index.ts"), 'Bun.serve({ port: 4000, fetch() { return new Response("ok"); } });');

    const config = await inspectProject(testDir);
    expect(config.runtime).toBe("bun");
    expect(config.entrypoint).toBe("index.ts");
    expect(config.port).toBe(4000);
    expect(config.dockerfile).toBeNull();
  });

  test("uses existing Dockerfile when present", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "Dockerfile"), "FROM node:20\nCMD node index.js");
    await writeFile(join(testDir, "index.ts"), "console.log('hi')");

    const config = await inspectProject(testDir);
    expect(config.dockerfile).toBe("Dockerfile");
  });

  test("finds entrypoint in src/ directory", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src/index.ts"), 'Bun.serve({ port: 3000, fetch() { return new Response("ok"); } });');

    const config = await inspectProject(testDir);
    expect(config.entrypoint).toBe("src/index.ts");
  });

  test("extracts port from .listen() call", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await writeFile(join(testDir, "index.ts"), 'const app = express();\napp.listen(8080);');

    const config = await inspectProject(testDir);
    expect(config.port).toBe(8080);
  });

  test("falls back to port 3000 when no port detected", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await writeFile(join(testDir, "index.ts"), 'console.log("hello")');

    const config = await inspectProject(testDir);
    expect(config.port).toBe(3000);
  });

  test("derives app name from directory", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await writeFile(join(testDir, "index.ts"), "console.log('hi')");

    const config = await inspectProject(testDir);
    expect(config.name).toBe(testDir.split("/").pop());
  });

  test("detects port from Bun.serve({ port: N })", async () => {
    await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "myapp" }));
    await writeFile(join(testDir, "bun.lockb"), "");
    await writeFile(join(testDir, "server.ts"), 'Bun.serve({\n  port: 5555,\n  fetch() { return new Response("ok"); }\n});');

    const config = await inspectProject(testDir);
    expect(config.port).toBe(5555);
    expect(config.entrypoint).toBe("server.ts");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/engine/rules.test.ts
```

Expected: FAIL — module `@/engine/rules` not found.

- [ ] **Step 3: Implement the rules engine**

Write `src/engine/rules.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/engine/rules.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/rules.ts tests/engine/rules.test.ts
git commit -m "feat: add static rules engine for project inspection"
```

---

### Task 4: Nginx Config Generator & Dockerfile Template

**Files:**
- Create: `src/engine/nginx.ts`
- Create: `tests/engine/nginx.test.ts`
- Create: `templates/Dockerfile.bun`
- Create: `templates/nginx.conf.tmpl`

- [ ] **Step 1: Write failing tests for nginx config generation**

Write `tests/engine/nginx.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { generateNginxConfig } from "@/engine/nginx";

describe("generateNginxConfig", () => {
  test("generates config with wildcard subdomain", () => {
    const config = generateNginxConfig({
      serverName: "myapp.ops.localhost",
      hostPort: 3001,
    });
    expect(config).toContain("server_name myapp.ops.localhost;");
    expect(config).toContain("proxy_pass http://127.0.0.1:3001;");
    expect(config).toContain("proxy_set_header Upgrade");
  });

  test("generates config with custom domain", () => {
    const config = generateNginxConfig({
      serverName: "api.example.com",
      hostPort: 3005,
    });
    expect(config).toContain("server_name api.example.com;");
    expect(config).toContain("proxy_pass http://127.0.0.1:3005;");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/engine/nginx.test.ts
```

Expected: FAIL — module `@/engine/nginx` not found.

- [ ] **Step 3: Create the Dockerfile template**

Write `templates/Dockerfile.bun`:

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE {{PORT}}
CMD ["bun", "run", "{{ENTRYPOINT}}"]
```

- [ ] **Step 4: Create the nginx config template**

Write `templates/nginx.conf.tmpl`:

```nginx
server {
    listen 80;
    server_name {{SERVER_NAME}};

    location / {
        proxy_pass http://127.0.0.1:{{HOST_PORT}};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

- [ ] **Step 5: Implement nginx config generator**

Write `src/engine/nginx.ts`:

```typescript
export interface NginxConfigOptions {
  serverName: string;
  hostPort: number;
}

export function generateNginxConfig(options: NginxConfigOptions): string {
  return `server {
    listen 80;
    server_name ${options.serverName};

    location / {
        proxy_pass http://127.0.0.1:${options.hostPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test tests/engine/nginx.test.ts
```

Expected: all 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/nginx.ts tests/engine/nginx.test.ts templates/Dockerfile.bun templates/nginx.conf.tmpl
git commit -m "feat: add nginx config generator and Dockerfile template"
```

---

### Task 5: Docker Build Engine

**Files:**
- Create: `src/engine/docker.ts`
- Create: `tests/engine/docker.test.ts`

- [ ] **Step 1: Write failing tests for Docker build**

Write `tests/engine/docker.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { generateDockerfile } from "@/engine/docker";

describe("generateDockerfile", () => {
  test("generates Dockerfile for bun project", () => {
    const result = generateDockerfile({ runtime: "bun", entrypoint: "src/index.ts", port: 3000 });
    expect(result).toContain("FROM oven/bun:1-alpine");
    expect(result).toContain("EXPOSE 3000");
    expect(result).toContain('CMD ["bun", "run", "src/index.ts"]');
    expect(result).toContain("bun install --frozen-lockfile --production");
  });

  test("uses correct port and entrypoint", () => {
    const result = generateDockerfile({ runtime: "bun", entrypoint: "server.ts", port: 8080 });
    expect(result).toContain("EXPOSE 8080");
    expect(result).toContain('CMD ["bun", "run", "server.ts"]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/engine/docker.test.ts
```

Expected: FAIL — module `@/engine/docker` not found.

- [ ] **Step 3: Implement Docker build engine**

Write `src/engine/docker.ts`:

```typescript
import { $ } from "bun";
import { writeFile, rm } from "fs/promises";
import { join } from "path";

interface DockerfileOptions {
  runtime: "bun" | "node";
  entrypoint: string;
  port: number;
}

export function generateDockerfile(options: DockerfileOptions): string {
  return `FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE ${options.port}
CMD ["bun", "run", "${options.entrypoint}"]
`;
}

export async function buildImage(
  projectDir: string,
  imageName: string,
  dockerfile: string | null,
  dockerfileOptions: DockerfileOptions
): Promise<string> {
  let generatedDockerfile = false;
  const dockerfilePath = join(projectDir, "Dockerfile");

  if (!dockerfile) {
    await writeFile(dockerfilePath, generateDockerfile(dockerfileOptions));
    generatedDockerfile = true;
  }

  try {
    await $`docker build -t ${imageName} ${projectDir}`.quiet();
  } finally {
    if (generatedDockerfile) {
      await rm(dockerfilePath, { force: true });
    }
  }

  return imageName;
}

export async function saveImage(imageName: string, outputPath: string): Promise<void> {
  await $`docker save ${imageName} -o ${outputPath}`.quiet();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/engine/docker.test.ts
```

Expected: all 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/docker.ts tests/engine/docker.test.ts
git commit -m "feat: add Docker image build and save functionality"
```

---

### Task 6: Provider Interface & Local Provider

**Files:**
- Create: `src/providers/provider.ts`
- Create: `src/providers/local.ts`
- Create: `tests/providers/local.test.ts`

- [ ] **Step 1: Write the provider interface**

Write `src/providers/provider.ts`:

```typescript
export interface Provider {
  readonly name: string;
  readonly baseDomain: string;

  /** Transfer a Docker image tarball to the target */
  transferImage(tarballPath: string): Promise<void>;

  /** Execute a command on the target, return stdout */
  exec(command: string): Promise<string>;

  /** Set up the provider (e.g., start mini-droplet) */
  setup(): Promise<void>;

  /** Tear down the provider (e.g., remove mini-droplet) */
  teardown(): Promise<void>;
}
```

- [ ] **Step 2: Write failing tests for local provider**

Write `tests/providers/local.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { LocalProvider } from "@/providers/local";

describe("LocalProvider", () => {
  test("has correct name and baseDomain", () => {
    const provider = new LocalProvider("ops.localhost");
    expect(provider.name).toBe("local");
    expect(provider.baseDomain).toBe("ops.localhost");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun test tests/providers/local.test.ts
```

Expected: FAIL — module `@/providers/local` not found.

- [ ] **Step 4: Implement local provider**

Write `src/providers/local.ts`:

```typescript
import { $ } from "bun";
import type { Provider } from "./provider";

const CONTAINER_NAME = "deploy-ops-mini-droplet";

export class LocalProvider implements Provider {
  readonly name = "local";
  readonly baseDomain: string;

  constructor(baseDomain: string) {
    this.baseDomain = baseDomain;
  }

  async setup(): Promise<void> {
    // Check if mini-droplet already exists
    const existing = await $`docker ps -a --filter name=${CONTAINER_NAME} --format "{{.ID}}"`.text();
    if (existing.trim()) {
      // Start it if stopped
      await $`docker start ${CONTAINER_NAME}`.quiet();
      return;
    }

    // Create mini-droplet with Docker-in-Docker + nginx
    await $`docker run -d \
      --name ${CONTAINER_NAME} \
      --privileged \
      -p 80:80 \
      docker:dind`.quiet();

    // Wait for Docker daemon inside to be ready
    let retries = 30;
    while (retries > 0) {
      try {
        await $`docker exec ${CONTAINER_NAME} docker info`.quiet();
        break;
      } catch {
        retries--;
        await Bun.sleep(1000);
      }
    }
    if (retries === 0) throw new Error("Mini-droplet Docker daemon failed to start");

    // Install nginx inside the mini-droplet
    await $`docker exec ${CONTAINER_NAME} sh -c "apk add --no-cache nginx && mkdir -p /etc/nginx/conf.d && nginx"`.quiet();
  }

  async teardown(): Promise<void> {
    await $`docker rm -f ${CONTAINER_NAME}`.quiet();
  }

  async transferImage(tarballPath: string): Promise<void> {
    await $`docker cp ${tarballPath} ${CONTAINER_NAME}:/tmp/image.tar`.quiet();
    await $`docker exec ${CONTAINER_NAME} docker load -i /tmp/image.tar`.quiet();
    await $`docker exec ${CONTAINER_NAME} rm /tmp/image.tar`.quiet();
  }

  async exec(command: string): Promise<string> {
    const result = await $`docker exec ${CONTAINER_NAME} sh -c ${command}`.text();
    return result;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test tests/providers/local.test.ts
```

Expected: all 1 test PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/provider.ts src/providers/local.ts tests/providers/local.test.ts
git commit -m "feat: add provider interface and local Docker-in-Docker provider"
```

---

### Task 7: DigitalOcean Provider

**Files:**
- Create: `src/providers/digitalocean.ts`

- [ ] **Step 1: Install SSH dependency**

```bash
bun add ssh2
bun add -d @types/ssh2
```

- [ ] **Step 2: Implement DigitalOcean provider**

Write `src/providers/digitalocean.ts`:

```typescript
import { Client } from "ssh2";
import { readFileSync } from "fs";
import { $ } from "bun";
import type { Provider } from "./provider";

export class DigitalOceanProvider implements Provider {
  readonly name = "digitalocean";
  readonly baseDomain: string;
  private host: string;
  private user: string;
  private sshKeyPath: string;

  constructor(config: { host: string; user: string; sshKey: string; baseDomain: string }) {
    this.host = config.host;
    this.user = config.user;
    this.sshKeyPath = config.sshKey;
    this.baseDomain = config.baseDomain;
  }

  async setup(): Promise<void> {
    // Verify connection works
    await this.exec("echo ok");
  }

  async teardown(): Promise<void> {
    // Nothing to tear down for remote provider
  }

  async transferImage(tarballPath: string): Promise<void> {
    const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");
    await $`scp -i ${resolvedKey} -o StrictHostKeyChecking=no ${tarballPath} ${this.user}@${this.host}:/tmp/image.tar`.quiet();
    await this.exec("docker load -i /tmp/image.tar && rm /tmp/image.tar");
  }

  async exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            let stdout = "";
            let stderr = "";

            stream.on("data", (data: Buffer) => {
              stdout += data.toString();
            });
            stream.stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
            stream.on("close", (code: number) => {
              conn.end();
              if (code !== 0) {
                reject(new Error(`Command failed (exit ${code}): ${stderr}`));
              } else {
                resolve(stdout);
              }
            });
          });
        })
        .on("error", reject)
        .connect({
          host: this.host,
          username: this.user,
          privateKey: readFileSync(resolvedKey),
        });
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/digitalocean.ts
git commit -m "feat: add DigitalOcean SSH/SCP provider"
```

---

### Task 8: CLI Entry Point & Init Command

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/init.ts`

- [ ] **Step 1: Create CLI entry point**

Write `src/cli/index.ts`:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./init";
import { deployCommand } from "./deploy";
import { lsCommand } from "./ls";
import { statusCommand } from "./status";
import { logsCommand } from "./logs";
import { stopCommand } from "./stop";
import { destroyCommand } from "./destroy";

const program = new Command();

program
  .name("deploy-ops")
  .description("Instant deployment of JS/TS projects to Docker containers")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(deployCommand);
program.addCommand(lsCommand);
program.addCommand(statusCommand);
program.addCommand(logsCommand);
program.addCommand(stopCommand);
program.addCommand(destroyCommand);

program.parse();
```

- [ ] **Step 2: Create init command**

Write `src/cli/init.ts`:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { writeConfig, readConfig } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import type { AppConfig } from "@/types";

const readline = await import("readline");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const initCommand = new Command("init")
  .description("Initialize deploy-ops configuration")
  .action(async () => {
    const cwd = process.cwd();

    const existing = await readConfig(cwd);
    if (existing) {
      const overwrite = await prompt("Config already exists. Overwrite? (y/N) ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    }

    const providerChoice = await prompt("Provider (local/digitalocean): ");

    let config: AppConfig;

    if (providerChoice === "local") {
      config = {
        provider: "local",
        local: { baseDomain: "ops.localhost" },
      };

      await writeConfig(cwd, config);
      console.log(chalk.green("✓") + " Config saved to .deploy-ops/config.json");

      console.log("Starting mini-droplet...");
      const provider = new LocalProvider(config.local!.baseDomain);
      await provider.setup();
      console.log(chalk.green("✓") + " Mini-droplet container started");
      console.log(chalk.green("✓") + " Nginx ready on localhost:80");
      console.log(chalk.green("✓") + " Deploy with: " + chalk.bold("deploy-ops deploy"));
    } else if (providerChoice === "digitalocean") {
      const host = await prompt("Droplet IP: ");
      const sshKey = await prompt("SSH key path (~/.ssh/id_ed25519): ") || "~/.ssh/id_ed25519";
      const user = await prompt("SSH user (root): ") || "root";
      const baseDomain = await prompt("Wildcard base domain: ");

      config = {
        provider: "digitalocean",
        digitalocean: { host, sshKey, user, baseDomain },
      };

      await writeConfig(cwd, config);
      console.log(chalk.green("✓") + " Config saved to .deploy-ops/config.json");

      // Verify connection
      console.log("Verifying connection...");
      const { DigitalOceanProvider } = await import("@/providers/digitalocean");
      const provider = new DigitalOceanProvider(config.digitalocean!);
      await provider.setup();
      console.log(chalk.green("✓") + " Connection verified");
      console.log(chalk.green("✓") + " Deploy with: " + chalk.bold("deploy-ops deploy"));
    } else {
      console.error(chalk.red("Unknown provider: " + providerChoice));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Create placeholder command files**

These are needed so `src/cli/index.ts` can import them. They'll be implemented in subsequent tasks.

Write `src/cli/deploy.ts`:

```typescript
import { Command } from "commander";

export const deployCommand = new Command("deploy")
  .description("Deploy the current project")
  .option("--name <name>", "Override app name")
  .option("--domain <domain>", "Use a custom domain")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

Write `src/cli/ls.ts`:

```typescript
import { Command } from "commander";

export const lsCommand = new Command("ls")
  .description("List all deployments")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

Write `src/cli/status.ts`:

```typescript
import { Command } from "commander";

export const statusCommand = new Command("status")
  .argument("<app>", "App name")
  .description("Show deployment status, resources, and warnings")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

Write `src/cli/logs.ts`:

```typescript
import { Command } from "commander";

export const logsCommand = new Command("logs")
  .argument("<app>", "App name")
  .description("Stream logs from a deployment")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

Write `src/cli/stop.ts`:

```typescript
import { Command } from "commander";

export const stopCommand = new Command("stop")
  .argument("<app>", "App name")
  .description("Stop a deployment")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

Write `src/cli/destroy.ts`:

```typescript
import { Command } from "commander";

export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .description("Remove a deployment completely")
  .action(async () => {
    console.log("Not yet implemented");
  });
```

- [ ] **Step 4: Test that CLI boots**

```bash
bun run src/cli/index.ts --help
```

Expected: shows help text with all 7 commands listed.

- [ ] **Step 5: Link the CLI for local use**

```bash
bun link
```

Now `deploy-ops` is available as a command.

- [ ] **Step 6: Commit**

```bash
git add src/cli/
git commit -m "feat: add CLI entry point and init command"
```

---

### Task 9: Deploy Command

**Files:**
- Modify: `src/cli/deploy.ts`

- [ ] **Step 1: Implement the deploy command**

Replace `src/cli/deploy.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { join } from "path";
import { tmpdir } from "os";
import { rm } from "fs/promises";
import { readConfig, readState, writeState, getNextPort } from "@/engine/state";
import { inspectProject } from "@/engine/rules";
import { buildImage, saveImage } from "@/engine/docker";
import { generateNginxConfig } from "@/engine/nginx";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";
import type { Provider } from "@/providers/provider";
import type { DeploymentRecord } from "@/types";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const deployCommand = new Command("deploy")
  .description("Deploy the current project")
  .option("--name <name>", "Override app name")
  .option("--domain <domain>", "Use a custom domain")
  .action(async (options) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const provider = getProvider(config);

    // 1. Inspect project
    console.log("Inspecting project...");
    const deployConfig = await inspectProject(cwd);
    const appName = options.name || deployConfig.name;

    console.log(`  Runtime: ${deployConfig.runtime}`);
    console.log(`  Entrypoint: ${deployConfig.entrypoint}`);
    console.log(`  Port: ${deployConfig.port}`);

    // 2. Build Docker image
    const imageTag = `deploy-ops-${appName}:${Date.now().toString(36)}`;
    console.log("\nBuilding image...");
    await buildImage(cwd, imageTag, deployConfig.dockerfile, {
      runtime: deployConfig.runtime,
      entrypoint: deployConfig.entrypoint,
      port: deployConfig.port,
    });
    console.log(chalk.green("  Built: " + imageTag));

    // 3. Save and transfer image
    const tarballPath = join(tmpdir(), `deploy-ops-${appName}.tar`);
    console.log("Shipping to target...");
    await saveImage(imageTag, tarballPath);
    await provider.transferImage(tarballPath);
    await rm(tarballPath, { force: true });
    console.log(chalk.green("  Transferred"));

    // 4. Handle re-deploy: stop and remove old container
    const state = await readState(cwd);
    const existing = state.deployments[appName];
    if (existing) {
      console.log("Replacing existing deployment...");
      try {
        await provider.exec(`docker stop ${existing.containerId}`);
        await provider.exec(`docker rm ${existing.containerId}`);
      } catch {
        // Container may already be gone
      }
    }

    // 5. Start container
    const hostPort = existing?.hostPort || await getNextPort(cwd);
    console.log("Starting container...");
    const containerId = (
      await provider.exec(
        `docker run -d --name deploy-ops-${appName} -p ${hostPort}:${deployConfig.port} ${imageTag}`
      )
    ).trim();
    console.log(chalk.green("  Started: " + containerId.slice(0, 12)));

    // 6. Configure nginx
    const domain = options.domain || `${appName}.${provider.baseDomain}`;
    const nginxConf = generateNginxConfig({ serverName: domain, hostPort });
    console.log("Configuring nginx...");
    await provider.exec(
      `cat > /etc/nginx/conf.d/deploy-ops-${appName}.conf << 'NGINX_EOF'\n${nginxConf}\nNGINX_EOF`
    );
    await provider.exec("nginx -s reload");
    console.log(chalk.green("  Configured"));

    // 7. Update state
    const now = new Date().toISOString();
    const record: DeploymentRecord = {
      name: appName,
      image: imageTag,
      port: deployConfig.port,
      hostPort,
      domain,
      containerId: containerId.slice(0, 12),
      status: "running",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.deployments[appName] = record;
    await writeState(cwd, state);

    console.log(`\n${chalk.green("✓")} Deployed: ${chalk.bold(appName)}`);
    console.log(`  URL: ${chalk.cyan("http://" + domain)}`);
    console.log(`  Container: ${containerId.slice(0, 12)}`);
  });
```

- [ ] **Step 2: Verify it compiles**

```bash
bun build src/cli/deploy.ts --target bun 2>&1 | head -5
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/deploy.ts
git commit -m "feat: implement deploy command with full pipeline"
```

---

### Task 10: Ls Command

**Files:**
- Modify: `src/cli/ls.ts`

- [ ] **Step 1: Implement the ls command**

Replace `src/cli/ls.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import type { Provider } from "@/providers/provider";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

function formatUptime(createdAt: string, status: string): string {
  if (status === "stopped") return "—";
  const diff = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export const lsCommand = new Command("ls")
  .description("List all deployments")
  .action(async () => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const deployments = Object.values(state.deployments);

    if (deployments.length === 0) {
      console.log("No deployments.");
      return;
    }

    // Reconcile status with live data
    const provider = getProvider(config);
    for (const dep of deployments) {
      try {
        const running = await provider.exec(`docker inspect -f '{{.State.Running}}' deploy-ops-${dep.name}`);
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }

    // Print table
    const nameWidth = Math.max(4, ...deployments.map((d) => d.name.length));
    const domainWidth = Math.max(6, ...deployments.map((d) => d.domain.length));

    console.log(
      chalk.bold(
        "NAME".padEnd(nameWidth + 2) +
        "STATUS".padEnd(10) +
        "DOMAIN".padEnd(domainWidth + 2) +
        "UPTIME"
      )
    );

    for (const dep of deployments) {
      const statusColor = dep.status === "running" ? chalk.green : chalk.yellow;
      console.log(
        dep.name.padEnd(nameWidth + 2) +
        statusColor(dep.status.padEnd(10)) +
        dep.domain.padEnd(domainWidth + 2) +
        formatUptime(dep.createdAt, dep.status)
      );
    }
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/ls.ts
git commit -m "feat: implement ls command with live status reconciliation"
```

---

### Task 11: Status Command

**Files:**
- Modify: `src/cli/status.ts`

- [ ] **Step 1: Implement the status command**

Replace `src/cli/status.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import type { Provider } from "@/providers/provider";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const statusCommand = new Command("status")
  .argument("<app>", "App name")
  .description("Show deployment status, resources, and warnings")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const provider = getProvider(config);
    const containerName = `deploy-ops-${app}`;

    // Get container info
    let isRunning = false;
    let restartCount = 0;
    let uptime = "—";

    try {
      const inspectJson = await provider.exec(
        `docker inspect ${containerName} --format '{{.State.Running}}|{{.RestartCount}}|{{.State.StartedAt}}'`
      );
      const [running, restarts, startedAt] = inspectJson.trim().split("|");
      isRunning = running === "true";
      restartCount = parseInt(restarts, 10) || 0;

      if (isRunning) {
        const diff = Date.now() - new Date(startedAt).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60) uptime = `${minutes}m`;
        else {
          const hours = Math.floor(minutes / 60);
          uptime = `${hours}h ${minutes % 60}m`;
        }
      }
    } catch {
      // Container doesn't exist
    }

    const statusColor = isRunning ? chalk.green : chalk.yellow;

    console.log(`Name:       ${chalk.bold(dep.name)}`);
    console.log(`Status:     ${statusColor(isRunning ? "running" : "stopped")}`);
    console.log(`Domain:     ${chalk.cyan("http://" + dep.domain)}`);
    console.log(`Container:  ${dep.containerId}`);
    console.log(`Uptime:     ${uptime}`);
    console.log(`Image:      ${dep.image}`);

    // Resources (only if running)
    if (isRunning) {
      try {
        const stats = await provider.exec(
          `docker stats ${containerName} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}'`
        );
        const [cpu, mem] = stats.trim().split("|");
        console.log(`\n${chalk.bold("Resources:")}`);
        console.log(`  CPU:      ${cpu}`);
        console.log(`  Memory:   ${mem}`);
      } catch {
        console.log(`\n${chalk.bold("Resources:")}  unavailable`);
      }
    }

    // Warnings
    const warnings: string[] = [];
    if (restartCount > 0) {
      warnings.push(`Container has restarted ${restartCount} time${restartCount > 1 ? "s" : ""}`);
    }

    try {
      const memStats = await provider.exec(
        `docker stats ${containerName} --no-stream --format '{{.MemPerc}}'`
      );
      const memPercent = parseFloat(memStats.trim().replace("%", ""));
      if (memPercent > 80) {
        warnings.push(`Memory usage at ${memPercent.toFixed(0)}% of limit`);
      }
    } catch {}

    console.log(`\n${chalk.bold("Warnings:")}`);
    if (warnings.length === 0) {
      console.log("  (none)");
    } else {
      for (const w of warnings) {
        console.log(chalk.yellow(`  ⚠ ${w}`));
      }
    }
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/status.ts
git commit -m "feat: implement status command with resources and warnings"
```

---

### Task 12: Logs, Stop, and Destroy Commands

**Files:**
- Modify: `src/cli/logs.ts`
- Modify: `src/cli/stop.ts`
- Modify: `src/cli/destroy.ts`

- [ ] **Step 1: Implement logs command**

Replace `src/cli/logs.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";
import { $ } from "bun";
import type { Provider } from "@/providers/provider";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const logsCommand = new Command("logs")
  .argument("<app>", "App name")
  .description("Stream logs from a deployment")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const containerName = `deploy-ops-${app}`;

    if (config.provider === "local") {
      // Stream logs directly — docker exec with docker logs -f
      const proc = Bun.spawn(["docker", "exec", "deploy-ops-mini-droplet", "docker", "logs", "-f", containerName], {
        stdout: "inherit",
        stderr: "inherit",
      });
      process.on("SIGINT", () => proc.kill());
      await proc.exited;
    } else {
      const do_config = config.digitalocean!;
      const sshKey = do_config.sshKey.replace("~", process.env.HOME || "");
      const proc = Bun.spawn(["ssh", "-i", sshKey, "-o", "StrictHostKeyChecking=no", `${do_config.user}@${do_config.host}`, `docker logs -f ${containerName}`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      process.on("SIGINT", () => proc.kill());
      await proc.exited;
    }
  });
```

- [ ] **Step 2: Implement stop command**

Replace `src/cli/stop.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";
import type { Provider } from "@/providers/provider";

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const stopCommand = new Command("stop")
  .argument("<app>", "App name")
  .description("Stop a deployment")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const provider = getProvider(config);
    const containerName = `deploy-ops-${app}`;

    // Stop container
    await provider.exec(`docker stop ${containerName}`);
    console.log(chalk.green("✓") + " Container stopped");

    // Disable nginx config (rename to .disabled)
    await provider.exec(
      `mv /etc/nginx/conf.d/deploy-ops-${app}.conf /etc/nginx/conf.d/deploy-ops-${app}.conf.disabled 2>/dev/null || true`
    );
    await provider.exec("nginx -s reload");
    console.log(chalk.green("✓") + " Nginx config disabled");

    // Update state
    dep.status = "stopped";
    dep.updatedAt = new Date().toISOString();
    await writeState(cwd, state);
  });
```

- [ ] **Step 3: Implement destroy command**

Replace `src/cli/destroy.ts` with:

```typescript
import { Command } from "commander";
import chalk from "chalk";
import { readConfig, readState, writeState } from "@/engine/state";
import { LocalProvider } from "@/providers/local";
import { DigitalOceanProvider } from "@/providers/digitalocean";
import type { Provider } from "@/providers/provider";

const readline = await import("readline");

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getProvider(config: any): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean);
}

export const destroyCommand = new Command("destroy")
  .argument("<app>", "App name")
  .description("Remove a deployment completely")
  .action(async (app: string) => {
    const cwd = process.cwd();
    const config = await readConfig(cwd);

    if (!config) {
      console.error(chalk.red("No config found. Run 'deploy-ops init' first."));
      process.exit(1);
    }

    const state = await readState(cwd);
    const dep = state.deployments[app];

    if (!dep) {
      console.error(chalk.red(`Deployment '${app}' not found.`));
      process.exit(1);
    }

    const confirm = await prompt(`Remove ${app} and all its data? (y/N) `);
    if (confirm.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }

    const provider = getProvider(config);
    const containerName = `deploy-ops-${app}`;

    // Remove container
    try {
      await provider.exec(`docker stop ${containerName}`);
    } catch {}
    try {
      await provider.exec(`docker rm ${containerName}`);
    } catch {}
    console.log(chalk.green("✓") + " Container removed");

    // Remove image
    try {
      await provider.exec(`docker rmi ${dep.image}`);
    } catch {}
    console.log(chalk.green("✓") + " Image removed");

    // Remove nginx config
    await provider.exec(`rm -f /etc/nginx/conf.d/deploy-ops-${app}.conf /etc/nginx/conf.d/deploy-ops-${app}.conf.disabled`);
    await provider.exec("nginx -s reload");
    console.log(chalk.green("✓") + " Nginx config removed");

    // Remove from state
    delete state.deployments[app];
    await writeState(cwd, state);
    console.log(chalk.green("✓") + " Removed from state");
  });
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/logs.ts src/cli/stop.ts src/cli/destroy.ts
git commit -m "feat: implement logs, stop, and destroy commands"
```

---

### Task 13: End-to-End Test with Local Provider

**Files:**
- Create: `test-app/index.ts`
- Create: `test-app/package.json`

This task manually tests the full deploy pipeline using the local provider.

- [ ] **Step 1: Create a test Bun app**

Create `test-app/package.json`:

```json
{
  "name": "test-app",
  "scripts": {
    "start": "bun run index.ts"
  }
}
```

Create `test-app/index.ts`:

```typescript
Bun.serve({
  port: 3000,
  fetch() {
    return new Response("Hello from deploy-ops test app!");
  },
});
console.log("Server started on port 3000");
```

- [ ] **Step 2: Initialize local provider from the test-app directory**

```bash
cd test-app
bun run ../src/cli/index.ts init
# Select: local
```

Expected: mini-droplet starts, config saved.

- [ ] **Step 3: Deploy the test app**

```bash
bun run ../src/cli/index.ts deploy
```

Expected: full pipeline runs — inspect, build, ship, start, configure nginx. URL printed.

- [ ] **Step 4: Verify the deployment works**

```bash
curl http://test-app.ops.localhost
```

Expected: `Hello from deploy-ops test app!`

- [ ] **Step 5: Test ls command**

```bash
bun run ../src/cli/index.ts ls
```

Expected: shows test-app as running with domain and uptime.

- [ ] **Step 6: Test status command**

```bash
bun run ../src/cli/index.ts status test-app
```

Expected: shows name, status, domain, resources, warnings.

- [ ] **Step 7: Test logs command**

```bash
bun run ../src/cli/index.ts logs test-app
# Ctrl+C after seeing output
```

Expected: shows "Server started on port 3000".

- [ ] **Step 8: Test stop command**

```bash
bun run ../src/cli/index.ts stop test-app
curl http://test-app.ops.localhost
```

Expected: container stopped, curl fails or returns nginx error.

- [ ] **Step 9: Test re-deploy**

```bash
bun run ../src/cli/index.ts deploy
curl http://test-app.ops.localhost
```

Expected: app re-deployed and working again.

- [ ] **Step 10: Test destroy command**

```bash
bun run ../src/cli/index.ts destroy test-app
# Confirm: y
bun run ../src/cli/index.ts ls
```

Expected: deployment removed, ls shows empty.

- [ ] **Step 11: Clean up test app**

```bash
cd ..
rm -rf test-app
```

- [ ] **Step 12: Commit any fixes made during testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```

---

### Task 14: Refactor Duplicate getProvider Helper

**Files:**
- Create: `src/providers/resolve.ts`
- Modify: `src/cli/deploy.ts`
- Modify: `src/cli/ls.ts`
- Modify: `src/cli/status.ts`
- Modify: `src/cli/stop.ts`
- Modify: `src/cli/destroy.ts`
- Modify: `src/cli/logs.ts`

- [ ] **Step 1: Extract shared getProvider function**

Write `src/providers/resolve.ts`:

```typescript
import type { AppConfig } from "@/types";
import type { Provider } from "./provider";
import { LocalProvider } from "./local";
import { DigitalOceanProvider } from "./digitalocean";

export function resolveProvider(config: AppConfig): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local!.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean!);
}
```

- [ ] **Step 2: Replace getProvider in all CLI commands**

In each of `deploy.ts`, `ls.ts`, `status.ts`, `stop.ts`, `destroy.ts`, `logs.ts`:

Remove the local `getProvider` function and its related imports (`LocalProvider`, `DigitalOceanProvider`). Add:

```typescript
import { resolveProvider } from "@/providers/resolve";
```

Replace all `getProvider(config)` calls with `resolveProvider(config)`.

- [ ] **Step 3: Run all tests**

```bash
bun test
```

Expected: all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/providers/resolve.ts src/cli/
git commit -m "refactor: extract shared resolveProvider helper"
```

---

### Task 15: Final Polish & README

**Files:**
- Modify: `package.json` — ensure scripts and metadata are complete

- [ ] **Step 1: Add scripts to package.json**

Add to `package.json`:

```json
{
  "scripts": {
    "test": "bun test",
    "dev": "bun run src/cli/index.ts",
    "typecheck": "bun x tsc --noEmit"
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors. Fix any that appear.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add scripts and finalize package.json"
```
