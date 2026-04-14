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
    expect(config.name).toBe(testDir.split("/").pop()!);
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
