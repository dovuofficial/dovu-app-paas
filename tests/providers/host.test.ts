import { describe, test, expect } from "bun:test";
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
