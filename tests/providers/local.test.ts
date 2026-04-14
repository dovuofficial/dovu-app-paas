import { describe, test, expect } from "bun:test";
import { LocalProvider } from "@/providers/local";

describe("LocalProvider", () => {
  test("has correct name and baseDomain", () => {
    const provider = new LocalProvider("ops.localhost");
    expect(provider.name).toBe("local");
    expect(provider.baseDomain).toBe("ops.localhost");
  });
});
