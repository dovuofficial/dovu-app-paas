export interface DeploymentConfig {
  name: string;
  runtime: "bun" | "node" | "php";
  framework: "none" | "nextjs" | "laravel";
  entrypoint: string;
  port: number;
  dockerfile: string | null; // null = generate one
}

export interface DeploymentRecord {
  name: string;
  image: string;
  port: number;
  hostPort: number;
  domain: string;
  containerId: string;
  status: "running" | "stopped";
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface StateFile {
  deployments: Record<string, DeploymentRecord>;
}

export interface LocalProviderConfig {
  baseDomain: string;
}

export interface DigitalOceanProviderConfig {
  host: string;
  sshKey: string;
  user: string;
  baseDomain: string;
}

export interface HostProviderConfig {
  baseDomain: string;
}

export interface AppConfig {
  provider: "local" | "digitalocean" | "host";
  local?: LocalProviderConfig;
  digitalocean?: DigitalOceanProviderConfig;
  host?: HostProviderConfig;
}
