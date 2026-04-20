import { describe, test, expect } from "bun:test";
import { generatePlaceholderHtml } from "@/engine/warm";

describe("generatePlaceholderHtml", () => {
  test("includes the slot name in the page", () => {
    const html = generatePlaceholderHtml("cat-blog");
    expect(html).toContain("cat-blog");
  });

  test("is a valid HTML document (doctype + title + body)", () => {
    const html = generatePlaceholderHtml("anything");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>");
    expect(html).toContain("provisioning");
  });

  test("escapes the name to prevent HTML injection", () => {
    const html = generatePlaceholderHtml("evil<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
