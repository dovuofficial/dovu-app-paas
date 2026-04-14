import { $ } from "bun";
import { writeFile, rm } from "fs/promises";
import { join } from "path";

interface DockerfileOptions {
  runtime: "bun" | "node";
  entrypoint: string;
  port: number;
}

export function generateDockerfile(options: DockerfileOptions): string {
  return `FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE ${options.port}
CMD ["bun", "run", "${options.entrypoint}"]
`;
}

export async function buildImage(
  projectDir: string,
  imageName: string,
  dockerfile: string | null,
  dockerfileOptions: DockerfileOptions
): Promise<string> {
  let generatedDockerfile = false;
  const dockerfilePath = join(projectDir, "Dockerfile");

  if (!dockerfile) {
    await writeFile(dockerfilePath, generateDockerfile(dockerfileOptions));
    generatedDockerfile = true;
  }

  try {
    await $`docker build -t ${imageName} ${projectDir}`.quiet();
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
