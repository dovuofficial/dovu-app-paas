import { test, expect, describe, afterEach } from "bun:test";
import { resolveConfig } from "@/mcp/config";

describe("resolveConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns config from env vars when all are set", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    process.env.DEPLOY_OPS_SSH_KEY = "~/.ssh/id_ed25519";
    process.env.DEPLOY_OPS_DOMAIN = "apps.example.com";
    delete process.env.DEPLOY_OPS_USER;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toEqual({
      provider: "digitalocean",
      digitalocean: {
        host: "1.2.3.4",
        sshKey: "~/.ssh/id_ed25519",
        user: "deploy",
        baseDomain: "apps.example.com",
      },
    });
  });

  test("uses DEPLOY_OPS_USER when set", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    process.env.DEPLOY_OPS_SSH_KEY = "~/.ssh/id_ed25519";
    process.env.DEPLOY_OPS_DOMAIN = "apps.example.com";
    process.env.DEPLOY_OPS_USER = "admin";

    const config = resolveConfig("/tmp/nonexistent");
    expect(config!.digitalocean!.user).toBe("admin");
  });

  test("returns null when env vars are partial and no project config", () => {
    process.env.DEPLOY_OPS_HOST = "1.2.3.4";
    delete process.env.DEPLOY_OPS_SSH_KEY;
    delete process.env.DEPLOY_OPS_DOMAIN;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toBeNull();
  });

  test("returns null when no env vars and no project config", () => {
    delete process.env.DEPLOY_OPS_HOST;
    delete process.env.DEPLOY_OPS_SSH_KEY;
    delete process.env.DEPLOY_OPS_DOMAIN;

    const config = resolveConfig("/tmp/nonexistent");
    expect(config).toBeNull();
  });
});
