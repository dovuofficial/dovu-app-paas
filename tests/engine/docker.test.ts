import { describe, test, expect } from "bun:test";
import { generateDockerfile } from "@/engine/docker";

describe("generateDockerfile", () => {
  test("generates Dockerfile for bun project", () => {
    const result = generateDockerfile({ runtime: "bun", framework: "none", entrypoint: "src/index.ts", port: 3000 });
    expect(result).toContain("FROM oven/bun:1-alpine");
    expect(result).toContain("EXPOSE 3000");
    expect(result).toContain('CMD ["bun", "run", "src/index.ts"]');
    expect(result).toContain("bun install --frozen-lockfile --production");
  });

  test("uses correct port and entrypoint", () => {
    const result = generateDockerfile({ runtime: "bun", framework: "none", entrypoint: "server.ts", port: 8080 });
    expect(result).toContain("EXPOSE 8080");
    expect(result).toContain('CMD ["bun", "run", "server.ts"]');
  });

  test("generates Dockerfile for Next.js project", () => {
    const result = generateDockerfile({ runtime: "node", framework: "nextjs", entrypoint: "package.json", port: 3000 });
    expect(result).toContain("FROM node:20-alpine");
    expect(result).toContain("npm run build");
    expect(result).toContain(".next/standalone");
    expect(result).toContain('CMD ["node", "server.js"]');
  });

  test("generates Dockerfile for Laravel project", () => {
    const result = generateDockerfile({ runtime: "php", framework: "laravel", entrypoint: "artisan", port: 8000 });
    expect(result).toContain("FROM php:8.3-cli");
    expect(result).toContain("composer install");
    expect(result).toContain("artisan");
    expect(result).toContain("EXPOSE 8000");
  });
});
