import type { DeploymentRecord } from "@/types";

export interface ContainerStats {
  running: boolean;
  cpu: string | null;
  memory: string | null;
  restartCount: number;
  uptime: string | null;
}

export interface DeploymentListEntry {
  name: string;
  domain: string;
  status: string;
  containerId: string | undefined;
}

export interface StatusResult {
  name: string;
  domain: string;
  running: boolean;
  containerId: string | undefined;
  image: string | undefined;
  cpu: string | null;
  memory: string | null;
  restartCount: number;
  uptime: string | null;
  warnings: string[];
}

export function formatDeploymentList(
  deployments: Record<string, DeploymentRecord>
): DeploymentListEntry[] {
  return Object.values(deployments).map((dep) => ({
    name: dep.name,
    domain: dep.domain,
    status: dep.status,
    containerId: dep.containerId,
  }));
}

export function formatStatus(
  dep: DeploymentRecord,
  stats: ContainerStats
): StatusResult {
  const warnings: string[] = [];
  if (stats.restartCount > 0) {
    warnings.push(`Container has restarted ${stats.restartCount} time${stats.restartCount > 1 ? "s" : ""}`);
  }
  if (stats.memory) {
    const match = stats.memory.match(/([\d.]+)MiB\s*\/\s*([\d.]+)MiB/);
    if (match) {
      const used = parseFloat(match[1]);
      const limit = parseFloat(match[2]);
      if (limit > 0 && (used / limit) > 0.8) {
        warnings.push(`Memory usage at ${((used / limit) * 100).toFixed(0)}% of limit`);
      }
    }
  }

  return {
    name: dep.name,
    domain: dep.domain,
    running: stats.running,
    containerId: dep.containerId,
    image: dep.image,
    cpu: stats.cpu,
    memory: stats.memory,
    restartCount: stats.restartCount,
    uptime: stats.uptime,
    warnings,
  };
}
