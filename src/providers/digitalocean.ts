import { Client } from "ssh2";
import { readFileSync } from "fs";
import { $ } from "bun";
import type { Provider } from "./provider";

export class DigitalOceanProvider implements Provider {
  readonly name = "digitalocean";
  readonly baseDomain: string;
  readonly nginxConfDir = "/etc/nginx/conf.d";
  readonly ssl: { certPath: string; keyPath: string } | null;
  private host: string;
  private user: string;
  private sshKeyPath: string;

  constructor(config: { host: string; user: string; sshKey: string; baseDomain: string }) {
    this.host = config.host;
    this.user = config.user;
    this.sshKeyPath = config.sshKey;
    this.baseDomain = config.baseDomain;
    // Wildcard cert for the base domain (created by certbot)
    const certDomain = config.baseDomain;
    this.ssl = {
      certPath: `/etc/letsencrypt/live/${certDomain}/fullchain.pem`,
      keyPath: `/etc/letsencrypt/live/${certDomain}/privkey.pem`,
    };
  }

  async setup(): Promise<void> {
    // Verify connection works
    await this.exec("echo ok");
  }

  async teardown(): Promise<void> {
    // Nothing to tear down for remote provider
  }

  async transferImage(tarballPath: string): Promise<void> {
    const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");
    const proc = Bun.spawn(
      ["scp", "-i", resolvedKey, "-o", "StrictHostKeyChecking=no", tarballPath, `${this.user}@${this.host}:/tmp/image.tar`],
      { stdout: "inherit", stderr: "inherit" }
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`SCP failed with exit code ${code}`);
    await this.exec("docker load -i /tmp/image.tar && rm /tmp/image.tar");
  }

  async transferFile(localPath: string, remotePath: string): Promise<void> {
    const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");
    const proc = Bun.spawn(
      ["scp", "-i", resolvedKey, "-o", "StrictHostKeyChecking=no", localPath, `${this.user}@${this.host}:${remotePath}`],
      { stdout: "inherit", stderr: "inherit" }
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`SCP failed with exit code ${code}`);
  }

  async exec(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const resolvedKey = this.sshKeyPath.replace("~", process.env.HOME || "");

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            let stdout = "";
            let stderr = "";

            stream.on("data", (data: Buffer) => {
              stdout += data.toString();
            });
            stream.stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
            stream.on("close", (code: number) => {
              conn.end();
              if (code !== 0) {
                reject(new Error(`Command failed (exit ${code}): ${stderr}`));
              } else {
                resolve(stdout);
              }
            });
          });
        })
        .on("error", reject)
        .connect({
          host: this.host,
          username: this.user,
          privateKey: readFileSync(resolvedKey),
        });
    });
  }
}
