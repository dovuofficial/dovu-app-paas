import { test, expect, describe } from "bun:test";
import { formatDeploymentList, formatStatus } from "@/mcp/tools";

describe("formatDeploymentList", () => {
  test("returns empty array when no deployments", () => {
    const result = formatDeploymentList({});
    expect(result).toEqual([]);
  });

  test("returns formatted deployment entries", () => {
    const result = formatDeploymentList({
      "my-app": {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "running",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-app");
    expect(result[0].domain).toBe("my-app.apps.dovu.ai");
    expect(result[0].status).toBe("running");
  });
});

describe("formatStatus", () => {
  test("formats running container stats", () => {
    const result = formatStatus(
      {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "running",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
      { running: true, cpu: "0.50%", memory: "45MiB / 256MiB", restartCount: 0, uptime: "2h 30m" }
    );
    expect(result.name).toBe("my-app");
    expect(result.running).toBe(true);
    expect(result.cpu).toBe("0.50%");
    expect(result.memory).toBe("45MiB / 256MiB");
  });

  test("formats stopped container", () => {
    const result = formatStatus(
      {
        name: "my-app",
        image: "dovu-app-paas-my-app:abc",
        port: 3000,
        hostPort: 3001,
        domain: "my-app.apps.dovu.ai",
        containerId: "abc123",
        status: "stopped",
        env: {},
        createdAt: "2026-04-15T00:00:00Z",
        updatedAt: "2026-04-15T00:00:00Z",
      },
      { running: false, cpu: null, memory: null, restartCount: 0, uptime: null }
    );
    expect(result.running).toBe(false);
    expect(result.cpu).toBeNull();
  });
});
