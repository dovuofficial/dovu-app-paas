import { describe, test, expect } from "bun:test";
import { generateNginxConfig } from "@/engine/nginx";

describe("generateNginxConfig", () => {
  test("generates config with wildcard subdomain", () => {
    const config = generateNginxConfig({
      serverName: "myapp.ops.localhost",
      hostPort: 3001,
    });
    expect(config).toContain("server_name myapp.ops.localhost;");
    expect(config).toContain("proxy_pass http://127.0.0.1:3001;");
    expect(config).toContain("proxy_set_header Upgrade");
  });

  test("generates config with custom domain", () => {
    const config = generateNginxConfig({
      serverName: "api.example.com",
      hostPort: 3005,
    });
    expect(config).toContain("server_name api.example.com;");
    expect(config).toContain("proxy_pass http://127.0.0.1:3005;");
  });
});
