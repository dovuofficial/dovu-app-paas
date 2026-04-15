import { describe, test, expect } from "bun:test";
import { resolveProvider } from "@/providers/resolve";
import type { AppConfig } from "@/types";

describe("resolveProvider", () => {
  test("resolves host provider", () => {
    const config: AppConfig = {
      provider: "host",
      host: { baseDomain: "apps.dovu.ai" },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("host");
    expect(provider.baseDomain).toBe("apps.dovu.ai");
  });

  test("resolves local provider", () => {
    const config: AppConfig = {
      provider: "local",
      local: { baseDomain: "ops.localhost" },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("local");
  });

  test("resolves digitalocean provider", () => {
    const config: AppConfig = {
      provider: "digitalocean",
      digitalocean: {
        host: "1.2.3.4",
        sshKey: "~/.ssh/id_ed25519",
        user: "deploy",
        baseDomain: "apps.dovu.ai",
      },
    };
    const provider = resolveProvider(config);
    expect(provider.name).toBe("digitalocean");
  });
});
