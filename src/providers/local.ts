import { $ } from "bun";
import type { Provider } from "./provider";

const CONTAINER_NAME = "deploy-ops-mini-droplet";

export class LocalProvider implements Provider {
  readonly name = "local";
  readonly baseDomain: string;

  constructor(baseDomain: string) {
    this.baseDomain = baseDomain;
  }

  async setup(): Promise<void> {
    // Check if mini-droplet already exists
    const existing = await $`docker ps -a --filter name=${CONTAINER_NAME} --format "{{.ID}}"`.text();
    if (existing.trim()) {
      // Start it if stopped
      await $`docker start ${CONTAINER_NAME}`.quiet();
      return;
    }

    // Create mini-droplet with Docker-in-Docker + nginx
    await $`docker run -d \
      --name ${CONTAINER_NAME} \
      --privileged \
      -p 80:80 \
      docker:dind`.quiet();

    // Wait for Docker daemon inside to be ready
    let retries = 30;
    while (retries > 0) {
      try {
        await $`docker exec ${CONTAINER_NAME} docker info`.quiet();
        break;
      } catch {
        retries--;
        await Bun.sleep(1000);
      }
    }
    if (retries === 0) throw new Error("Mini-droplet Docker daemon failed to start");

    // Install nginx inside the mini-droplet
    await $`docker exec ${CONTAINER_NAME} sh -c "apk add --no-cache nginx && mkdir -p /etc/nginx/conf.d && nginx"`.quiet();
  }

  async teardown(): Promise<void> {
    await $`docker rm -f ${CONTAINER_NAME}`.quiet();
  }

  async transferImage(tarballPath: string): Promise<void> {
    await $`docker cp ${tarballPath} ${CONTAINER_NAME}:/tmp/image.tar`.quiet();
    await $`docker exec ${CONTAINER_NAME} docker load -i /tmp/image.tar`.quiet();
    await $`docker exec ${CONTAINER_NAME} rm /tmp/image.tar`.quiet();
  }

  async exec(command: string): Promise<string> {
    const result = await $`docker exec ${CONTAINER_NAME} sh -c ${command}`.text();
    return result;
  }
}
