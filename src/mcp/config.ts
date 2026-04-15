import { readFileSync } from "fs";
import { join } from "path";
import type { AppConfig } from "@/types";

export function resolveConfig(cwd: string): AppConfig | null {
  // 1. Try env vars first
  const host = process.env.DEPLOY_OPS_HOST;
  const sshKey = process.env.DEPLOY_OPS_SSH_KEY;
  const domain = process.env.DEPLOY_OPS_DOMAIN;
  const user = process.env.DEPLOY_OPS_USER || "deploy";

  if (host && sshKey && domain) {
    return {
      provider: "digitalocean",
      digitalocean: { host, sshKey, user, baseDomain: domain },
    };
  }

  // 2. Fall back to project config file
  try {
    const configPath = join(cwd, ".dovu-app-paas", "config.json");
    const data = readFileSync(configPath, "utf-8");
    return JSON.parse(data) as AppConfig;
  } catch {
    return null;
  }
}
