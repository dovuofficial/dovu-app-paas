import { test, expect, describe } from "bun:test";
import { buildDestroyCommands } from "@/cli/destroy";

describe("buildDestroyCommands", () => {
  test("returns commands derived from app name when no state exists", () => {
    const cmds = buildDestroyCommands("my-app", null);
    expect(cmds.containerName).toBe("dovu-app-paas-my-app");
    expect(cmds.image).toBeNull();
  });

  test("returns commands with image from state when state exists", () => {
    const cmds = buildDestroyCommands("my-app", {
      name: "my-app",
      image: "dovu-app-paas-my-app:abc123",
      port: 3000,
      hostPort: 3001,
      domain: "my-app.apps.dovu.ai",
      containerId: "abc123def456",
      status: "running",
      env: {},
      createdAt: "2026-04-15T00:00:00Z",
      updatedAt: "2026-04-15T00:00:00Z",
    });
    expect(cmds.containerName).toBe("dovu-app-paas-my-app");
    expect(cmds.image).toBe("dovu-app-paas-my-app:abc123");
  });
});
