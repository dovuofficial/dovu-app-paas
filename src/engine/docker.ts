import { $ } from "bun";
import { writeFile, readFile, rm } from "fs/promises";
import { join } from "path";

interface DockerfileOptions {
  runtime: "bun" | "node" | "php";
  framework: "none" | "nextjs" | "laravel" | "static";
  entrypoint: string;
  port: number;
}

function generateStaticDockerfile(options: DockerfileOptions): string {
  return `FROM oven/bun:1-alpine
WORKDIR /app
COPY . .
EXPOSE ${options.port}
CMD ["bun", "run", "${options.entrypoint}"]
`;
}

function generateBunDockerfile(options: DockerfileOptions): string {
  return `FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || true
COPY . .
EXPOSE ${options.port}
CMD ["bun", "run", "${options.entrypoint}"]
`;
}

function generateNextjsDockerfile(options: DockerfileOptions): string {
  return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \\
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
    elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \\
    else npm install; fi

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE ${options.port}
ENV PORT=${options.port}
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
`;
}

function generateLaravelDockerfile(options: DockerfileOptions): string {
  return `FROM php:8.4-cli

RUN apt-get update && apt-get install -y \\
    unzip curl sqlite3 libsqlite3-dev \\
    && docker-php-ext-install pdo_sqlite \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json composer.lock* ./
RUN composer install --no-dev --no-scripts --no-autoloader

COPY . .
RUN composer dump-autoload --optimize

RUN touch database/database.sqlite 2>/dev/null || true
RUN php artisan config:clear 2>/dev/null || true

EXPOSE ${options.port}
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=${options.port}"]
`;
}

function generateNodeDockerfile(options: DockerfileOptions): string {
  return `FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* yarn.lock* ./
RUN npm install --production 2>/dev/null || true
COPY . .
EXPOSE ${options.port}
CMD ["node", "${options.entrypoint}"]
`;
}

export function generateDockerfile(options: DockerfileOptions): string {
  switch (options.framework) {
    case "nextjs":
      return generateNextjsDockerfile(options);
    case "laravel":
      return generateLaravelDockerfile(options);
    case "static":
      return generateStaticDockerfile(options);
    default:
      if (options.runtime === "node") return generateNodeDockerfile(options);
      return generateBunDockerfile(options);
  }
}

export async function buildImage(
  projectDir: string,
  imageName: string,
  dockerfile: string | null,
  dockerfileOptions: DockerfileOptions,
  platform?: string
): Promise<string> {
  let generatedDockerfile = false;
  let generatedPackageJson = false;
  const dockerfilePath = join(projectDir, "Dockerfile");
  const packageJsonPath = join(projectDir, "package.json");

  // Auto-generate package.json if missing (required for Docker COPY)
  if (!dockerfile && dockerfileOptions.framework !== "static") {
    try {
      await readFile(packageJsonPath, "utf-8");
    } catch {
      await writeFile(
        packageJsonPath,
        JSON.stringify(
          {
            name: "app",
            private: true,
            scripts: { start: `bun run ${dockerfileOptions.entrypoint}` },
          },
          null,
          2
        )
      );
      generatedPackageJson = true;
    }
  }

  if (!dockerfile) {
    await writeFile(dockerfilePath, generateDockerfile(dockerfileOptions));
    generatedDockerfile = true;
  }

  try {
    const cacheTag = `${imageName.split(":")[0]}:latest`;
    const args = [
      "docker", "build",
      ...(platform ? ["--platform", platform] : []),
      "--cache-from", cacheTag,
      "--build-arg", "BUILDKIT_INLINE_CACHE=1",
      "-t", imageName,
      "-t", cacheTag,
      projectDir,
    ];
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, DOCKER_BUILDKIT: "1" },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      const output = stderr || stdout;
      // Extract the last meaningful lines for the error message
      const lastLines = output.trim().split("\n").slice(-15).join("\n");
      throw new Error(`Docker build failed:\n${lastLines}`);
    }
  } finally {
    if (generatedDockerfile) {
      await rm(dockerfilePath, { force: true });
    }
    if (generatedPackageJson) {
      await rm(packageJsonPath, { force: true });
    }
  }

  return imageName;
}

export async function saveImage(imageName: string, outputPath: string): Promise<void> {
  await $`docker save ${imageName} -o ${outputPath}`.quiet();
}
