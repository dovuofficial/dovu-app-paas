import { describe, test, expect } from "bun:test";
import { LocalProvider } from "@/providers/local";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("LocalProvider", () => {
  test("has correct name and baseDomain", () => {
    const provider = new LocalProvider("ops.localhost");
    expect(provider.name).toBe("local");
    expect(provider.baseDomain).toBe("ops.localhost");
  });
});

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
  }, 120_000);
});
