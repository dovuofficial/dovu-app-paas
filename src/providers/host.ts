import { $ } from "bun";
import type { Provider } from "./provider";

export class HostProvider implements Provider {
  readonly name = "host";
  readonly baseDomain: string;
  readonly nginxConfDir = "/etc/nginx/conf.d";
  readonly ssl: { certPath: string; keyPath: string };

  constructor(baseDomain: string) {
    this.baseDomain = baseDomain;
    this.ssl = {
      certPath: `/etc/letsencrypt/live/${baseDomain}/fullchain.pem`,
      keyPath: `/etc/letsencrypt/live/${baseDomain}/privkey.pem`,
    };
  }

  async setup(): Promise<void> {
    await this.exec("docker info > /dev/null 2>&1");
  }

  async teardown(): Promise<void> {}

  async transferImage(tarballPath: string): Promise<void> {
    await $`docker load -i ${tarballPath}`.quiet();
    await $`rm ${tarballPath}`.quiet();
  }

  async exec(command: string): Promise<string> {
    const result = await $`sh -c ${command}`.text();
    return result;
  }
}
