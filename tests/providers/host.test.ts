import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { HostProvider } from "@/providers/host";

describe("HostProvider", () => {
  test("has correct name and baseDomain", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.name).toBe("host");
    expect(provider.baseDomain).toBe("apps.dovu.ai");
  });

  test("has correct nginxConfDir", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.nginxConfDir).toBe("/etc/nginx/conf.d");
  });

  test("has SSL config derived from baseDomain", () => {
    const provider = new HostProvider("apps.dovu.ai");
    expect(provider.ssl).toEqual({
      certPath: "/etc/letsencrypt/live/apps.dovu.ai/fullchain.pem",
      keyPath: "/etc/letsencrypt/live/apps.dovu.ai/privkey.pem",
    });
  });

  test("exec runs shell commands and returns stdout", async () => {
    const provider = new HostProvider("apps.dovu.ai");
    const result = await provider.exec("echo hello");
    expect(result.trim()).toBe("hello");
  });
});

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
