import type { AppConfig } from "@/types";
import type { Provider } from "./provider";
import { LocalProvider } from "./local";
import { DigitalOceanProvider } from "./digitalocean";

export function resolveProvider(config: AppConfig): Provider {
  if (config.provider === "local") {
    return new LocalProvider(config.local!.baseDomain);
  }
  return new DigitalOceanProvider(config.digitalocean!);
}
