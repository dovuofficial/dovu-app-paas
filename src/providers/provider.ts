export interface Provider {
  readonly name: string;
  readonly baseDomain: string;
  readonly nginxConfDir: string;

  /** Transfer a Docker image tarball to the target */
  transferImage(tarballPath: string): Promise<void>;

  /** Execute a command on the target, return stdout */
  exec(command: string): Promise<string>;

  /** Set up the provider (e.g., start mini-droplet) */
  setup(): Promise<void>;

  /** Tear down the provider (e.g., remove mini-droplet) */
  teardown(): Promise<void>;
}
