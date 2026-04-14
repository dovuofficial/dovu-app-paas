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
          env: { DATABASE_URL: "sqlite:./dev.db" },
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
        app1: { name: "app1", image: "", port: 3000, hostPort: 3001, domain: "", containerId: "", status: "running" as const, env: {}, createdAt: "", updatedAt: "" },
        app2: { name: "app2", image: "", port: 3000, hostPort: 3003, domain: "", containerId: "", status: "running" as const, env: {}, createdAt: "", updatedAt: "" },
      },
    };
    await writeState(testDir, state);
    const port = await getNextPort(testDir);
    expect(port).toBe(3004);
  });
});
