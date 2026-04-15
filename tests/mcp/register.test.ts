import { describe, test, expect } from "bun:test";
import { slugify } from "@/mcp/register";

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Alice Smith")).toBe("alice-smith");
  });

  test("removes special characters", () => {
    expect(slugify("Matt's App!")).toBe("matt-s-app");
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  test("collapses multiple hyphens", () => {
    expect(slugify("a---b")).toBe("a-b");
  });

  test("handles simple name", () => {
    expect(slugify("alice")).toBe("alice");
  });
});
