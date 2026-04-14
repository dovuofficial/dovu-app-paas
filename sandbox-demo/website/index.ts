import { join } from "path";

const PUBLIC_DIR = join(import.meta.dir, "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Default to index.html for root
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    const filePath = join(PUBLIC_DIR, pathname);

    // Prevent path traversal outside public/
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      // Try serving index.html as fallback for SPA-style routes
      const indexFile = Bun.file(join(PUBLIC_DIR, "index.html"));
      const indexExists = await indexFile.exists();
      if (indexExists) {
        return new Response(indexFile, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    return new Response(file, {
      headers: { "Content-Type": getMimeType(filePath) },
    });
  },
});

console.log(`deploy-ops website running at http://localhost:${server.port}`);
