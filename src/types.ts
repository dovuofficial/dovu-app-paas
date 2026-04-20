export interface DeploymentConfig {
  name: string;
  runtime: "bun" | "node" | "php";
  framework: "none" | "nextjs" | "laravel" | "static";
  entrypoint: string;
  port: number;
  dockerfile: string | null; // null = generate one
}

export interface DeploymentRecord {
  name: string;
  image?: string;              // optional for static-slot
  port?: number;               // optional for static-slot
  hostPort?: number;           // optional for static-slot
  domain: string;
  containerId?: string;        // optional for static-slot
  status: "running" | "stopped" | "provisioned";
  env?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  kind?: "container" | "static-slot";   // undefined = "container" (backward compat)
  currentRevision?: string;    // only for static-slot, e.g. "initial" or "rev-1a2b3c"
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
