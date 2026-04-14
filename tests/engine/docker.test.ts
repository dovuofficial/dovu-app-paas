import { describe, test, expect } from "bun:test";
import { generateDockerfile } from "@/engine/docker";

describe("generateDockerfile", () => {
  test("generates Dockerfile for bun project", () => {
    const result = generateDockerfile({ runtime: "bun", entrypoint: "src/index.ts", port: 3000 });
    expect(result).toContain("FROM oven/bun:1-alpine");
    expect(result).toContain("EXPOSE 3000");
    expect(result).toContain('CMD ["bun", "run", "src/index.ts"]');
    expect(result).toContain("bun install --frozen-lockfile --production");
  });

  test("uses correct port and entrypoint", () => {
    const result = generateDockerfile({ runtime: "bun", entrypoint: "server.ts", port: 8080 });
    expect(result).toContain("EXPOSE 8080");
    expect(result).toContain('CMD ["bun", "run", "server.ts"]');
  });
});
