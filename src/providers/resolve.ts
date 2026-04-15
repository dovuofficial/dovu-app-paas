import type { AppConfig } from "@/types";
import type { Provider } from "./provider";
import { LocalProvider } from "./local";
import { DigitalOceanProvider } from "./digitalocean";
import { HostProvider } from "./host";

export function resolveProvider(config: AppConfig): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local!.baseDomain);
  }
  if (config.provider === "host") {
    return new HostProvider(config.host!.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean!);
}
