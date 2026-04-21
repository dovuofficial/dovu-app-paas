import { describe, test, expect } from "bun:test";
import { generatePlaceholderHtml, generateStaticNginxConfig, provisionStaticSlot } from "@/engine/warm";
import type { Provider } from "@/providers/provider";

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
