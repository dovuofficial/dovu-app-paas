# Instant Provisioning — Static Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add instant-provisioning for static sites via a new `prewarm` MCP tool plus a warm-slot fast path in `deploy`/`destroy`, following the design in `docs/superpowers/specs/2026-04-20-instant-provisioning-static-design.md`.

**Architecture:** Two coexisting deploy paths. The existing container path is unchanged. A new warm-slot path, taken when a `kind: "static-slot"` record exists in state, skips Docker entirely — nginx serves files directly from a host directory, deploy is an atomic symlink swap across revision dirs (`{label}-initial`, `{label}-rev-{ts}`). A new `warm.ts` engine module holds pure helpers plus per-slot orchestration; `register.ts` stays thin. The `Provider` interface gains a generic `transferFile` method used by the warm-slot deploy and implementable across host/local/digitalocean providers.

**Tech Stack:** Bun + TypeScript, `bun:test`, `@modelcontextprotocol/sdk`, nginx (host), SSH/SCP (digitalocean provider).

---

## File structure

**New files:**
- `src/engine/warm.ts` — placeholder HTML generator, static nginx config generator, tarball validator, three orchestration helpers (`provisionStaticSlot`, `deployStaticSlot`, `destroyStaticSlot`).
- `tests/engine/warm.test.ts` — unit tests for pure helpers and orchestration (using a fake provider).
- `tests/engine/warm-security.test.ts` — security-specific unit tests (path traversal, symlink rejection, name sanitisation).

**Modified files:**
- `src/types.ts` — extend `DeploymentRecord` with `kind?`, widened `status`, `currentRevision?`.
- `src/providers/provider.ts` — add `transferFile(localPath, remotePath)` to the interface.
- `src/providers/host.ts` — implement `transferFile` via `cp` (same host).
- `src/providers/local.ts` — implement `transferFile` via `docker cp` (into DinD).
- `src/providers/digitalocean.ts` — implement `transferFile` via `scp` (same pattern as `transferImage`).
- `src/mcp/register.ts` — register the new `prewarm` tool; branch `deploy` / `destroy` / `ls` / `status` / `logs` on `kind: "static-slot"`.
- `src/mcp/tools.ts` — extend `formatDeploymentList` / `formatStatus` for static slots.
- `tests/mcp/register.test.ts` — unchanged pattern; only `slugify` tests are here — extend with a prewarm smoke test against a fake provider if one is needed, otherwise rely on orchestration tests in `tests/engine/warm.test.ts`.
- `tests/mcp/tools.test.ts` — add cases for static-slot formatting.
- `tests/providers/host.test.ts` — add `transferFile` test (runs `cp` locally).
- `tests/providers/local.test.ts` — add `transferFile` test (skipped if no Docker available, mirroring existing patterns).

**Out of scope for this plan (see spec "Out of scope for v1"):**
- CLI `prewarm` command (MCP only in v1).
- Phase B warm containers (Bun/Node).
- Rollback / name-change tools.

---

## Task 1: Extend DeploymentRecord types

**Files:**
- Modify: `src/types.ts` (extend `DeploymentRecord`)

- [ ] **Step 1: Modify types**

Edit `src/types.ts`. Replace the existing `DeploymentRecord` interface with:

```ts
export interface DeploymentRecord {
  name: string;
  image?: string;              // optional for static-slot
  port?: number;               // optional for static-slot
  hostPort?: number;           // optional for static-slot
  domain: string;
  containerId?: string;        // optional for static-slot
  status: "running" | "stopped" | "provisioned";
  env?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  kind?: "container" | "static-slot";   // undefined = "container" (backward compat)
  currentRevision?: string;    // only for static-slot, e.g. "initial" or "rev-1a2b3c"
}
```

(Widens `status`, makes container-specific fields optional, adds `kind` and `currentRevision`.)

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: existing container-using code still compiles (fields are all optional/widened). If TypeScript complains about `record.image` or similar in existing code, fix it by adding non-null assertions or early returns only in the **container** code paths (not in warm-slot code, which won't exist yet).

If any existing test fails because of the `env` → `env?` change, restore `env` to required and keep only the other changes. `env` is widely used; keep it required.

- [ ] **Step 3: Run existing tests**

Run: `bun test`

Expected: all existing tests pass (no behavioural changes yet).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "Extend DeploymentRecord with kind, currentRevision, provisioned status"
```

---

## Task 2: Placeholder HTML generator

**Files:**
- Create: `src/engine/warm.ts` (start the module — just this function for now)
- Create: `tests/engine/warm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/warm.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { generatePlaceholderHtml } from "@/engine/warm";

describe("generatePlaceholderHtml", () => {
  test("includes the slot name in the page", () => {
    const html = generatePlaceholderHtml("cat-blog");
    expect(html).toContain("cat-blog");
  });

  test("is a valid HTML document (doctype + title + body)", () => {
    const html = generatePlaceholderHtml("anything");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>");
    expect(html).toContain("provisioning");
  });

  test("escapes the name to prevent HTML injection", () => {
    const html = generatePlaceholderHtml("evil<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/engine/warm.test.ts`

Expected: FAIL — module or function not found.

- [ ] **Step 3: Create `src/engine/warm.ts` with just this function**

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generatePlaceholderHtml(name: string): string {
  const safe = escapeHtml(name);
  return `<!doctype html>
<meta charset="utf-8">
<title>${safe} — provisioning…</title>
<style>body{font:16px system-ui;max-width:40ch;margin:10vh auto;padding:1rem;color:#444}</style>
<h1>${safe}</h1>
<p>This app is being provisioned. The agent is working on it — check back in a moment.</p>
`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/engine/warm.test.ts`

Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm.test.ts
git commit -m "Add generatePlaceholderHtml with HTML escaping"
```

---

## Task 3: Static nginx config generator

**Files:**
- Modify: `src/engine/warm.ts` (add `generateStaticNginxConfig`)
- Modify: `tests/engine/warm.test.ts` (add tests)

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/warm.test.ts`:

```ts
import { generateStaticNginxConfig } from "@/engine/warm";

describe("generateStaticNginxConfig", () => {
  test("SSL variant contains server_name, root, try_files, SPA fallback", () => {
    const cfg = generateStaticNginxConfig({
      serverName: "cat-blog.apps.dovu.ai",
      sitePath: "/opt/deploy-ops/sites/cat-blog",
      ssl: { certPath: "/ssl/cert.pem", keyPath: "/ssl/key.pem" },
    });
    expect(cfg).toContain("server_name cat-blog.apps.dovu.ai;");
    expect(cfg).toContain("root /opt/deploy-ops/sites/cat-blog;");
    expect(cfg).toContain("try_files $uri $uri/ /index.html;");
    expect(cfg).toContain("listen 443 ssl;");
    expect(cfg).toContain("ssl_certificate /ssl/cert.pem;");
    expect(cfg).toContain("ssl_certificate_key /ssl/key.pem;");
  });

  test("SSL variant redirects HTTP to HTTPS", () => {
    const cfg = generateStaticNginxConfig({
      serverName: "cat-blog.apps.dovu.ai",
      sitePath: "/opt/deploy-ops/sites/cat-blog",
      ssl: { certPath: "/ssl/cert.pem", keyPath: "/ssl/key.pem" },
    });
    expect(cfg).toContain("return 301 https://$host$request_uri;");
  });

  test("non-SSL variant listens on 80 without ssl block", () => {
    const cfg = generateStaticNginxConfig({
      serverName: "cat-blog.ops.localhost",
      sitePath: "/opt/deploy-ops/sites/cat-blog",
    });
    expect(cfg).toContain("listen 80;");
    expect(cfg).not.toContain("ssl_certificate");
    expect(cfg).not.toContain("443");
  });

  test("includes disable_symlinks on from=$document_root", () => {
    const cfg = generateStaticNginxConfig({
      serverName: "x.apps.test",
      sitePath: "/opt/deploy-ops/sites/x",
    });
    expect(cfg).toContain("disable_symlinks on from=$document_root;");
  });

  test("includes dotfile deny block", () => {
    const cfg = generateStaticNginxConfig({
      serverName: "x.apps.test",
      sitePath: "/opt/deploy-ops/sites/x",
    });
    // regex literal may be escaped differently across formatters; just assert the shape
    expect(cfg).toMatch(/location ~ \/\\\.\s*\{[^}]*deny all;/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/engine/warm.test.ts`

Expected: FAIL on the `generateStaticNginxConfig` tests.

- [ ] **Step 3: Implement the function**

Append to `src/engine/warm.ts`:

```ts
export interface StaticNginxOptions {
  serverName: string;
  sitePath: string;
  ssl?: { certPath: string; keyPath: string };
}

export function generateStaticNginxConfig(options: StaticNginxOptions): string {
  const commonBody = `    root ${options.sitePath};
    index index.html;

    disable_symlinks on from=$document_root;

    location ~ /\\. {
        deny all;
        return 404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
`;

  if (options.ssl) {
    return `server {
    listen 80;
    server_name ${options.serverName};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${options.serverName};

    ssl_certificate ${options.ssl.certPath};
    ssl_certificate_key ${options.ssl.keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

${commonBody}}
`;
  }

  return `server {
    listen 80;
    server_name ${options.serverName};

${commonBody}}
`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/engine/warm.test.ts`

Expected: PASS (all tests including the three new ones).

- [ ] **Step 5: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm.test.ts
git commit -m "Add generateStaticNginxConfig with disable_symlinks and dotfile deny"
```

---

## Task 4: Tarball validator — security

**Files:**
- Modify: `src/engine/warm.ts` (add `validateTarball`)
- Create: `tests/engine/warm-security.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/warm-security.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtemp, writeFile, symlink, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { validateTarball } from "@/engine/warm";

let workDir: string;

async function makeTar(fn: (dir: string) => Promise<void>, tarName: string): Promise<string> {
  const stageDir = await mkdtemp(join(tmpdir(), "warm-sec-stage-"));
  await fn(stageDir);
  const tarPath = join(workDir, tarName);
  await $`tar -czf ${tarPath} -C ${stageDir} .`.quiet();
  await rm(stageDir, { recursive: true, force: true });
  return tarPath;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "warm-sec-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("validateTarball — acceptance", () => {
  test("accepts a clean static site archive", async () => {
    const tar = await makeTar(async (d) => {
      await writeFile(join(d, "index.html"), "<h1>hi</h1>");
      await mkdir(join(d, "css"));
      await writeFile(join(d, "css", "style.css"), "body{}");
    }, "clean.tar.gz");
    await expect(validateTarball(tar)).resolves.toBeUndefined();
  });
});

describe("validateTarball — rejection", () => {
  test("rejects entries containing .. as a path segment", async () => {
    // Create a tar with a .. entry using --transform trickery
    const stageDir = await mkdtemp(join(tmpdir(), "warm-traverse-"));
    await writeFile(join(stageDir, "a.txt"), "hi");
    const tarPath = join(workDir, "traverse.tar.gz");
    await $`tar -czf ${tarPath} -C ${stageDir} --transform=s,a.txt,../evil.txt, a.txt`.quiet();
    await rm(stageDir, { recursive: true, force: true });
    await expect(validateTarball(tarPath)).rejects.toThrow(/\.\./);
  });

  test("rejects entries with absolute paths", async () => {
    const stageDir = await mkdtemp(join(tmpdir(), "warm-abs-"));
    await writeFile(join(stageDir, "a.txt"), "hi");
    const tarPath = join(workDir, "abs.tar.gz");
    await $`tar -czf ${tarPath} -C ${stageDir} --transform=s,a.txt,/etc/passwd, a.txt`.quiet();
    await rm(stageDir, { recursive: true, force: true });
    await expect(validateTarball(tarPath)).rejects.toThrow(/absolute|^\//i);
  });

  test("rejects symlink entries", async () => {
    const tar = await makeTar(async (d) => {
      await symlink("/etc/passwd", join(d, "evil"));
      await writeFile(join(d, "real.txt"), "ok");
    }, "symlink.tar.gz");
    await expect(validateTarball(tar)).rejects.toThrow(/symlink|link/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/engine/warm-security.test.ts`

Expected: FAIL — `validateTarball` not exported.

- [ ] **Step 3: Implement `validateTarball`**

Append to `src/engine/warm.ts`:

```ts
import { $ } from "bun";

export async function validateTarball(localPath: string): Promise<void> {
  // Use tar long listing — format columns:
  //   drwxr-xr-x root/root 0 2026-04-20 12:00 path/to/entry
  //   lrwxrwxrwx root/root 0 2026-04-20 12:00 evil -> /etc/passwd
  const result = await $`tar -tzvf ${localPath}`.quiet();
  if (result.exitCode !== 0) {
    throw new Error(`Tarball is unreadable: ${result.stderr.toString()}`);
  }
  const lines = result.stdout.toString().split("\n").filter((l) => l.length > 0);

  for (const line of lines) {
    const cols = line.split(/\s+/);
    const perms = cols[0] ?? "";
    // Name column is everything after col 5; symlinks show "name -> target"
    const rest = cols.slice(5).join(" ");
    const name = rest.split(" -> ")[0] ?? rest;

    if (perms.startsWith("l")) {
      throw new Error(`Tarball rejected: symlink entry "${name}" is not allowed`);
    }
    if (perms.startsWith("h")) {
      throw new Error(`Tarball rejected: hardlink entry "${name}" is not allowed`);
    }
    if (name.startsWith("/")) {
      throw new Error(`Tarball rejected: absolute path "${name}" is not allowed`);
    }
    if (name.split("/").includes("..")) {
      throw new Error(`Tarball rejected: path traversal in "${name}"`);
    }
  }
}
```

Note: GNU tar marks hardlinks with `h` permission prefix in `-tzvf` output (on some platforms it's the first char, on others the second — the check above handles the common case; if a cross-platform issue appears, extend with a regex on the perms column).

- [ ] **Step 4: Run tests**

Run: `bun test tests/engine/warm-security.test.ts`

Expected: PASS (all four tests).

If the `..` or absolute-path tests behave unexpectedly on macOS vs Linux (BSD tar vs GNU tar), adjust the tar invocation in the fixture creation (not the validator). GNU tar is available on both macOS (`gtar`) and Linux; fall back to explicit `gtar` if needed and document in a comment.

- [ ] **Step 5: Add name-sanitisation security tests**

Append to `tests/engine/warm-security.test.ts`:

```ts
import { slugify } from "@/mcp/register";

describe("slugify — adversarial inputs (spec §Security.4)", () => {
  const cases = [
    "foo; rm -rf /",
    "foo}",
    "foo\n} evil",
    "../bar",
    "foo bar",
    "foo/bar",
    "foo`id`",
    "foo$(id)",
  ];
  for (const input of cases) {
    test(`output of slugify(${JSON.stringify(input)}) matches /^[a-z0-9-]+$/`, () => {
      const out = slugify(input);
      expect(out).toMatch(/^[a-z0-9-]+$/);
    });
  }
});
```

- [ ] **Step 6: Run security tests**

Run: `bun test tests/engine/warm-security.test.ts`

Expected: PASS (existing `slugify` already filters to `[a-z0-9-]`, these just lock it in as a security invariant).

- [ ] **Step 7: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm-security.test.ts
git commit -m "Add validateTarball and slugify adversarial security tests"
```

---

## Task 5: Provider.transferFile interface + HostProvider implementation

**Files:**
- Modify: `src/providers/provider.ts` (add method to interface)
- Modify: `src/providers/host.ts` (implement)
- Modify: `tests/providers/host.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Append to `tests/providers/host.test.ts`:

```ts
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("HostProvider.transferFile", () => {
  test("copies a local file to the target path", async () => {
    const provider = new HostProvider("apps.dovu.ai");
    const srcDir = await mkdtemp(join(tmpdir(), "host-src-"));
    const dstDir = await mkdtemp(join(tmpdir(), "host-dst-"));
    const src = join(srcDir, "a.txt");
    const dst = join(dstDir, "b.txt");
    await writeFile(src, "hello");

    await provider.transferFile(src, dst);

    const content = await readFile(dst, "utf-8");
    expect(content).toBe("hello");

    await rm(srcDir, { recursive: true, force: true });
    await rm(dstDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/providers/host.test.ts`

Expected: FAIL — `transferFile` not defined.

- [ ] **Step 3: Add the interface method**

Edit `src/providers/provider.ts`. Add before the closing brace of the `Provider` interface:

```ts
  /** Transfer an arbitrary local file to an arbitrary remote path */
  transferFile(localPath: string, remotePath: string): Promise<void>;
```

- [ ] **Step 4: Implement on HostProvider**

Edit `src/providers/host.ts`. Add a method inside the class (after `transferImage`):

```ts
  async transferFile(localPath: string, remotePath: string): Promise<void> {
    await $`cp ${localPath} ${remotePath}`.quiet();
  }
```

- [ ] **Step 5: Run test**

Run: `bun test tests/providers/host.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify typecheck (expect errors in other providers)**

Run: `bun run typecheck`

Expected: ERRORS in `src/providers/local.ts` and `src/providers/digitalocean.ts` — "Class does not implement transferFile". This is expected and will be fixed in Task 6 and Task 7. Do not commit yet.

- [ ] **Step 7: Commit (anticipating the follow-up tasks)**

Commit the interface + host impl; local/DO will follow immediately.

```bash
git add src/providers/provider.ts src/providers/host.ts tests/providers/host.test.ts
git commit -m "Add Provider.transferFile interface + HostProvider implementation"
```

---

## Task 6: LocalProvider.transferFile

**Files:**
- Modify: `src/providers/local.ts`
- Modify: `tests/providers/local.test.ts`

- [ ] **Step 1: Inspect existing local.test.ts**

Run: `bun x cat tests/providers/local.test.ts`

Note: existing tests may require Docker / a running DinD container. Follow the same pattern; if existing tests use a "skip if docker missing" guard, reuse it. If they always run `setup()`/`teardown()` unconditionally, add the new test at the end so it fails early when Docker is unavailable but does not interfere.

- [ ] **Step 2: Write the failing test**

Append to `tests/providers/local.test.ts` (or wherever the `LocalProvider` describe block lives, inside the same describe):

```ts
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("LocalProvider.transferFile", () => {
  test("copies a local file into the mini-droplet container", async () => {
    const provider = new LocalProvider("ops.localhost");
    await provider.setup();
    try {
      const srcDir = await mkdtemp(join(tmpdir(), "local-src-"));
      const src = join(srcDir, "a.txt");
      await writeFile(src, "hello-local");

      const remotePath = "/root/transfer-test.txt";
      await provider.transferFile(src, remotePath);

      const content = await provider.exec(`cat ${remotePath}`);
      expect(content.trim()).toBe("hello-local");

      await provider.exec(`rm ${remotePath}`);
      await rm(srcDir, { recursive: true, force: true });
    } finally {
      // Leave the mini-droplet up — existing tests may depend on it
    }
  });
});
```

If existing tests wrap all setup/teardown at the file level (e.g. `beforeAll/afterAll`), piggyback on them rather than calling `setup()` manually here.

- [ ] **Step 3: Run tests to verify failure**

Run: `bun test tests/providers/local.test.ts`

Expected: FAIL — `transferFile` not defined on `LocalProvider`. (Or TypeScript error, same thing.)

- [ ] **Step 4: Implement on LocalProvider**

Edit `src/providers/local.ts`. Add inside the class (after `transferImage`):

```ts
  async transferFile(localPath: string, remotePath: string): Promise<void> {
    // Mirror transferImage's handling: use docker cp, but no docker load
    await $`docker cp ${localPath} ${CONTAINER_NAME}:${remotePath}`.quiet();
  }
```

- [ ] **Step 5: Run test**

Run: `bun test tests/providers/local.test.ts`

Expected: PASS (assuming Docker is running locally). If Docker is not available, the test will fail with a connection error — that matches existing behaviour and is acceptable for CI environments without Docker.

- [ ] **Step 6: Commit**

```bash
git add src/providers/local.ts tests/providers/local.test.ts
git commit -m "Add LocalProvider.transferFile via docker cp"
```

---

## Task 7: DigitalOceanProvider.transferFile

**Files:**
- Modify: `src/providers/digitalocean.ts`

No automated test — requires a real SSH host and key. Manual verification via smoke test at end of plan.

- [ ] **Step 1: Implement on DigitalOceanProvider**

Edit `src/providers/digitalocean.ts`. Add inside the class (after `transferImage`):

```ts
  async transferFile(localPath: string, remotePath: string): Promise<void> {
    const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");
    const proc = Bun.spawn(
      ["scp", "-i", resolvedKey, "-o", "StrictHostKeyChecking=no", localPath, `${this.user}@${this.host}:${remotePath}`],
      { stdout: "inherit", stderr: "inherit" }
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`SCP failed with exit code ${code}`);
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: PASS (all three providers now implement `transferFile`).

- [ ] **Step 3: Run full test suite**

Run: `bun test`

Expected: all tests pass (no behaviour changes to non-warm paths).

- [ ] **Step 4: Commit**

```bash
git add src/providers/digitalocean.ts
git commit -m "Add DigitalOceanProvider.transferFile via scp"
```

---

## Task 8: Fake provider + `provisionStaticSlot`

**Files:**
- Modify: `src/engine/warm.ts` (add `provisionStaticSlot`)
- Modify: `tests/engine/warm.test.ts` (add fake provider + tests)

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/warm.test.ts`:

```ts
import type { Provider } from "@/providers/provider";
import { provisionStaticSlot } from "@/engine/warm";

class FakeProvider implements Provider {
  readonly name = "fake";
  readonly baseDomain = "apps.test";
  readonly nginxConfDir = "/etc/nginx/conf.d";
  readonly ssl = { certPath: "/ssl/cert.pem", keyPath: "/ssl/key.pem" };

  execCalls: string[] = [];
  transferCalls: Array<{ local: string; remote: string }> = [];

  async setup() {}
  async teardown() {}
  async transferImage() {}
  async transferFile(local: string, remote: string) {
    this.transferCalls.push({ local, remote });
  }
  async exec(command: string): Promise<string> {
    this.execCalls.push(command);
    return "";
  }
}

describe("provisionStaticSlot", () => {
  test("runs mkdir, writes placeholder, creates symlink, writes nginx conf, reloads", async () => {
    const provider = new FakeProvider();
    await provisionStaticSlot(provider, "cat-blog");

    const calls = provider.execCalls;
    // Expected order: mkdir -initial, write placeholder, ln -sfn, write nginx conf, nginx reload
    expect(calls[0]).toContain("mkdir -p /opt/deploy-ops/sites/cat-blog-initial");
    expect(calls[1]).toContain("cat-blog-initial/index.html");
    expect(calls[1]).toContain("base64 -d"); // placeholder written via base64 pipe
    expect(calls[2]).toContain("ln -sfn cat-blog-initial /opt/deploy-ops/sites/cat-blog");
    expect(calls[3]).toContain("/etc/nginx/conf.d/dovu-app-paas-cat-blog.conf");
    expect(calls[3]).toContain("base64 -d");
    expect(calls[4]).toContain("nginx -s reload");
    expect(calls).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/engine/warm.test.ts`

Expected: FAIL — `provisionStaticSlot` not exported.

- [ ] **Step 3: Implement `provisionStaticSlot`**

Append to `src/engine/warm.ts`:

```ts
const SITES_ROOT = "/opt/deploy-ops/sites";

function pipeWrite(contents: string, remotePath: string): string {
  const b64 = Buffer.from(contents).toString("base64");
  return `echo '${b64}' | base64 -d > ${remotePath}`;
}

export async function provisionStaticSlot(
  provider: Provider,
  label: string
): Promise<void> {
  const initialDir = `${SITES_ROOT}/${label}-initial`;
  const symlinkPath = `${SITES_ROOT}/${label}`;
  const nginxConfPath = `${provider.nginxConfDir}/dovu-app-paas-${label}.conf`;

  const serverName = `${label}.${provider.baseDomain}`;
  const placeholder = generatePlaceholderHtml(label);
  const nginxConf = generateStaticNginxConfig({
    serverName,
    sitePath: symlinkPath,
    ssl: provider.ssl ?? undefined,
  });

  await provider.exec(`mkdir -p ${initialDir}`);
  await provider.exec(pipeWrite(placeholder, `${initialDir}/index.html`));
  await provider.exec(`ln -sfn ${label}-initial ${symlinkPath}`);
  await provider.exec(pipeWrite(nginxConf, nginxConfPath));
  await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
}
```

Add the `Provider` import at the top if not already imported:

```ts
import type { Provider } from "@/providers/provider";
```

- [ ] **Step 4: Run test**

Run: `bun test tests/engine/warm.test.ts`

Expected: PASS. If assertions on `calls[4]` fail because of the `2>/dev/null || sudo systemctl reload nginx` suffix, relax the assertion to `expect(calls[4]).toContain("nginx") && expect(calls[4]).toContain("reload")`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm.test.ts
git commit -m "Add provisionStaticSlot orchestrator with FakeProvider test"
```

---

## Task 9: `deployStaticSlot`

**Files:**
- Modify: `src/engine/warm.ts` (add `deployStaticSlot`)
- Modify: `tests/engine/warm.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/warm.test.ts`:

```ts
import { deployStaticSlot } from "@/engine/warm";
import { $ } from "bun";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function makeCleanTarballBase64(): Promise<string> {
  const stageDir = await mkdtemp(join(tmpdir(), "clean-stage-"));
  await writeFile(join(stageDir, "index.html"), "<h1>real</h1>");
  const tarPath = join(tmpdir(), `clean-${Date.now()}.tar.gz`);
  await $`tar -czf ${tarPath} -C ${stageDir} .`.quiet();
  const buf = await readFile(tarPath);
  await rm(stageDir, { recursive: true, force: true });
  await rm(tarPath, { force: true });
  return buf.toString("base64");
}

describe("deployStaticSlot", () => {
  test("validates, transfers, extracts, swaps symlink, cleans old revs", async () => {
    const provider = new FakeProvider();
    const b64 = await makeCleanTarballBase64();

    const result = await deployStaticSlot(provider, "cat-blog", b64);

    expect(provider.transferCalls).toHaveLength(1);
    expect(provider.transferCalls[0].remote).toMatch(/^\/tmp\/cat-blog-rev-.*\.tar\.gz$/);

    const calls = provider.execCalls;
    // ordered: mkdir rev, tar extract, ln -sfn, rm tar, cleanup find
    expect(calls[0]).toMatch(/mkdir -p \/opt\/deploy-ops\/sites\/cat-blog-rev-/);
    expect(calls[1]).toMatch(/tar --no-same-owner --no-same-permissions -xzf .* -C \/opt\/deploy-ops\/sites\/cat-blog-rev-/);
    expect(calls[2]).toMatch(/ln -sfn cat-blog-rev-.* \/opt\/deploy-ops\/sites\/cat-blog/);
    expect(calls[3]).toMatch(/rm -rf \/tmp\/cat-blog-rev-.*\.tar\.gz/);
    expect(calls[4]).toMatch(/find .*cat-blog-rev-/);
    // no docker calls, no nginx reload
    expect(calls.every((c) => !c.includes("docker"))).toBe(true);
    expect(calls.every((c) => !c.includes("nginx -s reload"))).toBe(true);

    expect(result.revision).toMatch(/^rev-/);
  });

  test("rejects malicious tarball before any target-side call", async () => {
    const provider = new FakeProvider();

    // Build a tar with path traversal
    const stageDir = await mkdtemp(join(tmpdir(), "evil-"));
    await writeFile(join(stageDir, "a.txt"), "hi");
    const tarPath = join(tmpdir(), `evil-${Date.now()}.tar.gz`);
    await $`tar -czf ${tarPath} -C ${stageDir} --transform=s,a.txt,../evil.txt, a.txt`.quiet();
    const b64 = (await readFile(tarPath)).toString("base64");
    await rm(stageDir, { recursive: true, force: true });
    await rm(tarPath, { force: true });

    await expect(deployStaticSlot(provider, "cat-blog", b64)).rejects.toThrow(/\.\./);
    expect(provider.transferCalls).toHaveLength(0);
    expect(provider.execCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/engine/warm.test.ts`

Expected: FAIL — `deployStaticSlot` not exported.

- [ ] **Step 3: Implement `deployStaticSlot`**

Append to `src/engine/warm.ts`:

```ts
import { writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface DeployStaticResult {
  revision: string;
}

export async function deployStaticSlot(
  provider: Provider,
  label: string,
  sourceB64: string
): Promise<DeployStaticResult> {
  // 1. Decode to local tmp
  const ts = Date.now().toString(36);
  const revision = `rev-${ts}`;
  const localTar = join(tmpdir(), `${label}-${revision}.tar.gz`);
  await writeFile(localTar, Buffer.from(sourceB64.replace(/\s/g, ""), "base64"));

  try {
    // 2. Validate before doing anything remote
    await validateTarball(localTar);

    const remoteTar = `/tmp/${label}-${revision}.tar.gz`;
    const revDir = `${SITES_ROOT}/${label}-${revision}`;
    const symlinkPath = `${SITES_ROOT}/${label}`;

    // 3. Transfer
    await provider.transferFile(localTar, remoteTar);

    // 4. Extract on target
    await provider.exec(`mkdir -p ${revDir}`);
    await provider.exec(
      `tar --no-same-owner --no-same-permissions -xzf ${remoteTar} -C ${revDir}`
    );

    // 5. Atomic symlink swap
    await provider.exec(`ln -sfn ${label}-${revision} ${symlinkPath}`);

    // 6. Remove the transferred tarball
    await provider.exec(`rm -rf ${remoteTar}`);

    // 7. Fire-and-forget cleanup of old revs (except the current one)
    await provider.exec(
      `find ${SITES_ROOT} -maxdepth 1 -type d -name '${label}-rev-*' ! -name '${label}-${revision}' -exec rm -rf {} + 2>/dev/null || true`
    );

    return { revision };
  } finally {
    await rm(localTar, { force: true });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/engine/warm.test.ts`

Expected: PASS (both new tests; earlier tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm.test.ts
git commit -m "Add deployStaticSlot with tarball validation and atomic symlink swap"
```

---

## Task 10: `destroyStaticSlot`

**Files:**
- Modify: `src/engine/warm.ts` (add `destroyStaticSlot`)
- Modify: `tests/engine/warm.test.ts` (add test)

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/warm.test.ts`:

```ts
import { destroyStaticSlot } from "@/engine/warm";

describe("destroyStaticSlot", () => {
  test("removes symlink, all rev dirs, initial dir, and nginx conf, then reloads", async () => {
    const provider = new FakeProvider();
    await destroyStaticSlot(provider, "cat-blog");

    const joined = provider.execCalls.join("\n");
    expect(joined).toContain("rm -rf /opt/deploy-ops/sites/cat-blog");
    expect(joined).toContain("cat-blog-*");  // glob removes -initial + all -rev-*
    expect(joined).toContain("rm -f /etc/nginx/conf.d/dovu-app-paas-cat-blog.conf");
    expect(joined).toContain("nginx");
    // no docker calls
    expect(provider.execCalls.every((c) => !c.includes("docker"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/engine/warm.test.ts`

Expected: FAIL — `destroyStaticSlot` not exported.

- [ ] **Step 3: Implement `destroyStaticSlot`**

Append to `src/engine/warm.ts`:

```ts
export async function destroyStaticSlot(
  provider: Provider,
  label: string
): Promise<void> {
  await provider.exec(
    `rm -rf ${SITES_ROOT}/${label} ${SITES_ROOT}/${label}-*`
  );
  await provider.exec(
    `rm -f ${provider.nginxConfDir}/dovu-app-paas-${label}.conf`
  );
  await provider.exec("nginx -s reload 2>/dev/null || sudo systemctl reload nginx");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/engine/warm.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/warm.ts tests/engine/warm.test.ts
git commit -m "Add destroyStaticSlot orchestrator"
```

---

## Task 11: Register `prewarm` MCP tool

**Files:**
- Modify: `src/mcp/register.ts` (register new tool; extend imports)

- [ ] **Step 1: Read current register.ts tool-registration patterns**

Run: `bun x cat src/mcp/register.ts | head -60`

Confirm: tools are registered via `server.tool(name, description, schema, handler)`. Handlers call `getConfigOrError()`, `resolveProvider(config!)`, etc. Follow the same pattern.

- [ ] **Step 2: Add imports and the prewarm tool**

Edit `src/mcp/register.ts`. Add to the imports at the top:

```ts
import { provisionStaticSlot } from "@/engine/warm";
```

Inside the `registerTools` function, before `server.tool("deploy", ...)`, add:

```ts
  server.tool(
    "prewarm",
    `Pre-provision a static site slot. Allocates a subdomain, writes a placeholder page, and makes the URL live immediately. Call this the moment the user declares intent to build a static site. A later deploy() call will swap in the real content.

v1 supports framework: "static" only. Bun/Node warm containers come in Phase B.`,
    {
      name: z.string().describe("App name (slugified into subdomain)"),
      framework: z.literal("static").describe("Runtime to warm. v1: only 'static' is supported"),
      deployer: z.string().optional().describe("Optional deployer name (prefixes subdomain)"),
    },
    async ({ name, framework, deployer }) => {
      const { config, error } = getConfigOrError();
      if (error) return { content: [{ type: "text", text: error }] };

      if (framework !== "static") {
        return {
          content: [{ type: "text", text: `Framework '${framework}' is not supported yet. v1 supports 'static' only.` }],
          isError: true,
        };
      }

      const provider = resolveProvider(config!);
      const appName = slugify(name);
      const deployerSlug = deployer ? slugify(deployer) : null;
      const label = deployerSlug ? `${appName}-${deployerSlug}` : appName;

      // Idempotent: return existing URL if slot/deployment exists
      const state = await readState(cwd);
      const existing = state.deployments[label];
      if (existing) {
        const url = provider.ssl
          ? `https://${existing.domain}`
          : `http://${existing.domain}`;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ url, slot: label, placeholder: existing.status === "provisioned", existing: true }, null, 2),
          }],
        };
      }

      const domain = `${label}.${provider.baseDomain}`;

      try {
        await provisionStaticSlot(provider, label);

        const now = new Date().toISOString();
        state.deployments[label] = {
          name: label,
          domain,
          status: "provisioned",
          kind: "static-slot",
          currentRevision: "initial",
          env: {},
          createdAt: now,
          updatedAt: now,
        };
        await writeState(cwd, state);

        const url = provider.ssl ? `https://${domain}` : `http://${domain}`;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ url, slot: label, placeholder: true }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "prewarm failed", message }, null, 2) }],
          isError: true,
        };
      }
    }
  );
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`

Expected: PASS. If `status: "provisioned"` triggers a type error on the state.deployments record assignment, that means Task 1 didn't widen the type — go back and check.

- [ ] **Step 4: Run all tests**

Run: `bun test`

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/register.ts
git commit -m "Register prewarm MCP tool for static-slot provisioning"
```

---

## Task 12: Deploy tool — warm-slot fast path

**Files:**
- Modify: `src/mcp/register.ts` (branch deploy handler)

- [ ] **Step 1: Add the fast-path branch at the top of the deploy handler**

Edit `src/mcp/register.ts`. Add to the imports:

```ts
import { deployStaticSlot } from "@/engine/warm";
```

Find the `server.tool("deploy", ...)` registration. Inside the handler, immediately after `const provider = resolveProvider(config!);`, insert the fast-path check (replace the existing `const steps: string[] = [];` line only if this block falls through):

```ts
      // --- Warm-slot fast path ---
      if (name) {
        const label = deployer
          ? `${slugify(name)}-${slugify(deployer)}`
          : slugify(name);
        const state = await readState(cwd);
        const slot = state.deployments[label];
        if (slot?.kind === "static-slot") {
          if (!source) {
            return {
              content: [{ type: "text", text: "Error: 'source' is required when deploying into a warm static slot" }],
              isError: true,
            };
          }
          try {
            const { revision } = await deployStaticSlot(provider, label, source);
            const now = new Date().toISOString();
            slot.status = "running";
            slot.currentRevision = revision;
            slot.updatedAt = now;
            await writeState(cwd, state);
            const url = provider.ssl ? `https://${slot.domain}` : `http://${slot.domain}`;
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  url,
                  appName: label,
                  revision,
                  steps: ["Validated", "Transferred", "Extracted", "Swapped"],
                }, null, 2),
              }],
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "warm-slot deploy failed", message }, null, 2),
              }],
              isError: true,
            };
          }
        }
      }
      // --- End warm-slot fast path. Falls through to existing container path. ---
```

Do **not** modify the existing container-path code — let it fall through unchanged when no warm-slot record matches.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `bun test`

Expected: all existing tests pass (existing deploy tests exercise the container path, which is untouched).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/register.ts
git commit -m "Add warm-slot fast path to deploy tool"
```

---

## Task 13: Destroy tool — warm-slot branch

**Files:**
- Modify: `src/mcp/register.ts` (branch destroy handler)

- [ ] **Step 1: Add the branch before the existing destroy body**

Edit `src/mcp/register.ts`. Add to the imports:

```ts
import { destroyStaticSlot } from "@/engine/warm";
```

Find the `server.tool("destroy", ...)` registration. Inside the handler, immediately after `const { config, error } = getConfigOrError(); if (error) return ...;` and after `const provider = resolveProvider(config!);`, **insert** (do not replace) the warm-slot branch as the first thing the handler does after provider resolution:

```ts
      const state = await readState(cwd);
      const dep = state.deployments[app];

      // --- Warm-slot branch: early return, container path below is untouched ---
      if (dep?.kind === "static-slot") {
        const results: string[] = [];
        try {
          await destroyStaticSlot(provider, app);
          results.push("Static slot removed (dir + nginx conf + reload)");
        } catch (err) {
          results.push(`Static slot removal failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        delete state.deployments[app];
        await writeState(cwd, state);
        results.push("Removed from state");
        return { content: [{ type: "text", text: `Destroyed '${app}':\n${results.map(r => `  - ${r}`).join("\n")}` }] };
      }
      // --- End warm-slot branch ---
```

Leave the rest of the existing destroy handler (container stop/rm, image rm, nginx cleanup, state update, source dir cleanup) exactly as it is. The existing handler also reads state later via `const state = await readState(cwd);` — find that line and remove it (we now read state above); update the line that uses `state.deployments[app]` to use the existing `dep` variable.

- [ ] **Step 2: Run typecheck + tests**

Run: `bun run typecheck && bun test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/register.ts
git commit -m "Add warm-slot branch to destroy tool"
```

---

## Task 14: ls / status / logs — warm-slot handling

**Files:**
- Modify: `src/mcp/register.ts` (branch ls/status/logs handlers)
- Modify: `src/mcp/tools.ts` (extend formatters)
- Modify: `tests/mcp/tools.test.ts` (add cases)

- [ ] **Step 1: Extend formatters with tests first**

Append to `tests/mcp/tools.test.ts`:

```ts
describe("formatDeploymentList — static-slot", () => {
  test("reports static slot status and omits containerId", () => {
    const result = formatDeploymentList({
      "site": {
        name: "site",
        domain: "site.apps.test",
        status: "running",
        kind: "static-slot",
        currentRevision: "rev-abc",
        env: {},
        createdAt: "2026-04-20T00:00:00Z",
        updatedAt: "2026-04-20T00:00:00Z",
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("site");
    expect(result[0].status).toBe("running");
    expect(result[0].containerId).toBe("—"); // or empty string, whichever formatter chooses
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/mcp/tools.test.ts`

Expected: FAIL on the new test only — `containerId` is `undefined`, current formatter doesn't handle it.

- [ ] **Step 3: Fix `formatDeploymentList`**

Edit `src/mcp/tools.ts`. Change the `containerId` line in `formatDeploymentList`:

```ts
    containerId: dep.containerId ?? "—",
```

- [ ] **Step 4: Run test**

Run: `bun test tests/mcp/tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Branch ls for reconciliation**

Edit `src/mcp/register.ts`. Find the `server.tool("ls", ...)` reconciliation loop. Replace:

```ts
    // Reconcile live status
    const provider = resolveProvider(config!);
    for (const dep of Object.values(deployments)) {
      try {
        const running = await provider.exec(`docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`);
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }
```

with:

```ts
    // Reconcile live status
    const provider = resolveProvider(config!);
    for (const dep of Object.values(deployments)) {
      if (dep.kind === "static-slot") {
        try {
          // symlink resolves to an existing directory?
          await provider.exec(`test -d /opt/deploy-ops/sites/${dep.name}`);
          dep.status = dep.currentRevision === "initial" ? "provisioned" : "running";
        } catch {
          dep.status = "stopped";
        }
        continue;
      }
      try {
        const running = await provider.exec(`docker inspect -f '{{.State.Running}}' dovu-app-paas-${dep.name}`);
        dep.status = running.trim() === "true" ? "running" : "stopped";
      } catch {
        dep.status = "stopped";
      }
    }
```

- [ ] **Step 6: Branch status for static slots**

In the same file, find the `server.tool("status", ...)` handler. After the `const dep = state.deployments[app];` check and "not found" guard, insert:

```ts
      if (dep.kind === "static-slot") {
        const provider = resolveProvider(config!);
        let alive = false;
        try {
          await provider.exec(`test -d /opt/deploy-ops/sites/${app}`);
          alive = true;
        } catch {}
        const result = {
          name: dep.name,
          domain: dep.domain,
          running: alive,
          kind: "static-slot" as const,
          currentRevision: dep.currentRevision ?? null,
          warnings: [] as string[],
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
```

- [ ] **Step 7: Branch logs for static slots**

Find the `server.tool("logs", ...)` handler. After the "Deployment not found" guard, insert:

```ts
      if (state.deployments[app].kind === "static-slot") {
        return {
          content: [{
            type: "text",
            text: "Static sites have no container logs. Check nginx access logs on the droplet at /var/log/nginx/access.log.",
          }],
        };
      }
```

- [ ] **Step 8: Run all tests**

Run: `bun test`

Expected: PASS.

- [ ] **Step 9: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/mcp/register.ts src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "Branch ls, status, logs on static-slot kind"
```

---

## Task 15: Manual smoke test

**Files:** none; validates end-to-end on the local provider.

This task requires Docker running locally. It verifies the warm path actually works.

- [ ] **Step 1: Ensure local provider is initialised**

Run: `bun run src/cli/index.ts init`

Choose `local` when prompted. Confirm the mini-droplet (`dovu-app-paas-mini-droplet`) is running:

```bash
docker ps --filter name=dovu-app-paas-mini-droplet
```

- [ ] **Step 2: Register the MCP server locally and call prewarm**

Start the MCP server (`bun run src/mcp/index.ts`) in one terminal, connect via an MCP client (e.g., Claude Code with a local MCP config), and call `prewarm({name: "smoke-static", framework: "static"})`.

Open the returned URL (e.g., `http://smoke-static.ops.localhost`) in a browser. Expect the placeholder page showing "smoke-static — provisioning…". Note the timing: prewarm should complete in < 3 seconds.

- [ ] **Step 3: Prepare a tar.gz of a small static site**

```bash
mkdir /tmp/smoke-static
cat > /tmp/smoke-static/index.html <<'EOF'
<!doctype html><title>smoke ok</title><h1>deployed</h1>
EOF
tar -czf /tmp/smoke-static.tar.gz -C /tmp/smoke-static .
base64 -w0 < /tmp/smoke-static.tar.gz > /tmp/smoke-static.b64
```

Copy the base64 string and call `deploy({name: "smoke-static", source: "<base64>"})` via the MCP client.

- [ ] **Step 4: Verify the swap**

Reload the URL. Expect "deployed" instead of the placeholder. Deploy round-trip should be < 3 seconds.

- [ ] **Step 5: Repeat with different content to verify revision rotation**

Edit `/tmp/smoke-static/index.html`, re-tar, re-base64, call `deploy` again. Reload the URL. Expect updated content. Check the droplet:

```bash
docker exec dovu-app-paas-mini-droplet ls /opt/deploy-ops/sites/
```

Expect: `smoke-static` (symlink), `smoke-static-initial` (original), and exactly one `smoke-static-rev-*` directory (older revs cleaned up).

- [ ] **Step 6: Verify dotfile/symlink security in practice**

Check that `http://smoke-static.ops.localhost/.env` returns 404 (even if no `.env` exists, the deny rule should short-circuit before default nginx behaviour). This confirms the nginx hardening is in effect.

- [ ] **Step 7: Destroy**

Call `destroy({app: "smoke-static"})`. Reload the URL — expect browser failure / 502 / nginx default. Check:

```bash
docker exec dovu-app-paas-mini-droplet ls /opt/deploy-ops/sites/
docker exec dovu-app-paas-mini-droplet ls /etc/nginx/http.d/
```

Expect: no `smoke-static*` entries anywhere.

- [ ] **Step 8: No commit** — this is a verification task. If any step failed, open a follow-up issue and iterate.

---

## Post-implementation checklist

- [ ] `bun test` passes on clean checkout.
- [ ] `bun run typecheck` passes.
- [ ] Manual smoke test (Task 15) completed on local provider.
- [ ] `prewarm` → `deploy` round-trip under 5 seconds on local.
- [ ] `destroy` leaves no orphan files or nginx configs.
- [ ] Existing container-based deploys still work (regression check: pick any one existing harness task and run it end-to-end).
- [ ] (Optional) Run the remote-droplet end-to-end validation from the spec's "Harness test" section — add `static-warm-t-01` to `harness/matrix.ts` and run once. Not required to ship; deferred because it needs a live droplet + MCP config.
