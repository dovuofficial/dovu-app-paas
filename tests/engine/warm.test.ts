import { describe, test, expect } from "bun:test";
import { generatePlaceholderHtml, generateStaticNginxConfig, provisionStaticSlot, deployStaticSlot, destroyStaticSlot } from "@/engine/warm";
import type { Provider } from "@/providers/provider";
import { $ } from "bun";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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
    expect(provider.transferCalls[0].remote).toMatch(/^\/opt\/deploy-ops\/sites\/\.staging-cat-blog-rev-.*\.tar\.gz$/);

    const calls = provider.execCalls;
    // ordered: mkdir rev, tar extract, chmod a+rX, ln -sfn, rm tar, cleanup find
    expect(calls[0]).toMatch(/mkdir -p \/opt\/deploy-ops\/sites\/cat-blog-rev-/);
    expect(calls[1]).toMatch(/tar --no-same-owner --no-same-permissions -xzf .* -C \/opt\/deploy-ops\/sites\/cat-blog-rev-/);
    expect(calls[2]).toMatch(/chmod -R a\+rX \/opt\/deploy-ops\/sites\/cat-blog-rev-/);
    expect(calls[3]).toMatch(/ln -sfn cat-blog-rev-.* \/opt\/deploy-ops\/sites\/cat-blog/);
    expect(calls[4]).toMatch(/rm -rf \/opt\/deploy-ops\/sites\/\.staging-cat-blog-rev-.*\.tar\.gz/);
    expect(calls[5]).toMatch(/find .*cat-blog-rev-/);
    // no docker calls, no nginx reload
    expect(calls.every((c) => !c.includes("docker"))).toBe(true);
    expect(calls.every((c) => !c.includes("nginx -s reload"))).toBe(true);

    expect(result.revision).toMatch(/^rev-/);
  });

  test("rejects malicious tarball before any target-side call", async () => {
    const provider = new FakeProvider();

    // Build a tar with path traversal. BSD tar (macOS default) uses
    // `-s ',from,to,'` as the equivalent of GNU's `--transform=s,from,to,`.
    // Verified to emit a literal "../evil.txt" entry on BSD tar 3.5.3.
    const stageDir = await mkdtemp(join(tmpdir(), "evil-"));
    await writeFile(join(stageDir, "a.txt"), "hi");
    const tarPath = join(tmpdir(), `evil-${Date.now()}.tar.gz`);
    await $`tar -czf ${tarPath} -C ${stageDir} -s ,a.txt,../evil.txt, a.txt`.quiet();
    const b64 = (await readFile(tarPath)).toString("base64");
    await rm(stageDir, { recursive: true, force: true });
    await rm(tarPath, { force: true });

    await expect(deployStaticSlot(provider, "cat-blog", b64)).rejects.toThrow(/\.\./);
    expect(provider.transferCalls).toHaveLength(0);
    expect(provider.execCalls).toHaveLength(0);
  });
});

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
