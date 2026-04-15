import { $ } from "bun";
import { writeFile, rm } from "fs/promises";
import { join } from "path";

interface DockerfileOptions {
  runtime: "bun" | "node" | "php";
  framework: "none" | "nextjs" | "laravel";
  entrypoint: string;
  port: number;
}

function generateBunDockerfile(options: DockerfileOptions): string {
  return `FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
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

export function generateDockerfile(options: DockerfileOptions): string {
  switch (options.framework) {
    case "nextjs":
      return generateNextjsDockerfile(options);
    case "laravel":
      return generateLaravelDockerfile(options);
    default:
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
  const dockerfilePath = join(projectDir, "Dockerfile");

  if (!dockerfile) {
    await writeFile(dockerfilePath, generateDockerfile(dockerfileOptions));
    generatedDockerfile = true;
  }

  try {
    if (platform) {
      await $`docker build --platform ${platform} -t ${imageName} ${projectDir}`.quiet();
    } else {
      await $`docker build -t ${imageName} ${projectDir}`.quiet();
    }
  } finally {
    if (generatedDockerfile) {
      await rm(dockerfilePath, { force: true });
    }
  }

  return imageName;
}

export async function saveImage(imageName: string, outputPath: string): Promise<void> {
  await $`docker save ${imageName} -o ${outputPath}`.quiet();
}
