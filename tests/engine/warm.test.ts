import { describe, test, expect } from "bun:test";
import { generatePlaceholderHtml, generateStaticNginxConfig } from "@/engine/warm";

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
