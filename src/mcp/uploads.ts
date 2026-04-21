/**
 * File-backed upload store for the MCP server's `/upload` endpoint.
 *
 * Purpose: let agents get a tarball to the server without feeding its bytes
 * through the LLM's tool-call emission path. The agent does one `curl -X POST`
 * in Bash, receives an uploadId, then calls deploy({ name, uploadId }) — a
 * tiny tool-call arg. Uploads of any size (up to nginx's body limit) finish
 * in a few hundred ms instead of tens of seconds.
 *
 * Bytes are written to /tmp/mcp-uploads/{upl_<uuid>}.bin. A 15-minute TTL
 * reaps orphans; the normal flow consumes (reads + deletes) the upload as
 * part of deploy.
 */

import { mkdir, writeFile, readFile, unlink, readdir, stat } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

let uploadsDir = process.env.MCP_UPLOADS_DIR || "/tmp/mcp-uploads";
export const UPLOAD_TTL_MS = 15 * 60 * 1000;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function getUploadsDir(): string {
  return uploadsDir;
}

/** Test-only: override the directory uploads are persisted to. */
export function _setUploadsDir(dir: string): void {
  uploadsDir = dir;
}

async function ensureDir(): Promise<void> {
  await mkdir(uploadsDir, { recursive: true });
}

function pathFor(uploadId: string): string | null {
  // Defence in depth: only accept our prefixed form, no separators, no traversal.
  if (!/^upl_[a-f0-9-]{36}$/.test(uploadId)) return null;
  return join(uploadsDir, `${uploadId}.bin`);
}

export async function storeUpload(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new Error("Upload is empty");
  }
  if (bytes.byteLength > UPLOAD_MAX_BYTES) {
    throw new Error(
      `Upload too large: ${bytes.byteLength} bytes (max ${UPLOAD_MAX_BYTES})`,
    );
  }
  await ensureDir();
  const uploadId = `upl_${randomUUID()}`;
  const p = pathFor(uploadId)!;
  await writeFile(p, bytes);
  return uploadId;
}

export async function readUpload(uploadId: string): Promise<Buffer | null> {
  const p = pathFor(uploadId);
  if (!p) return null;
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

export async function consumeUpload(uploadId: string): Promise<Buffer | null> {
  const bytes = await readUpload(uploadId);
  if (!bytes) return null;
  const p = pathFor(uploadId);
  if (p) {
    try {
      await unlink(p);
    } catch {}
  }
  return bytes;
}

/** Remove uploads older than the TTL. Returns count removed. */
export async function gcUploads(nowMs = Date.now()): Promise<number> {
  await ensureDir();
  let removed = 0;
  let files: string[];
  try {
    files = await readdir(uploadsDir);
  } catch {
    return 0;
  }
  for (const f of files) {
    const p = join(uploadsDir, f);
    try {
      const s = await stat(p);
      if (nowMs - s.mtimeMs > UPLOAD_TTL_MS) {
        await unlink(p);
        removed++;
      }
    } catch {}
  }
  return removed;
}
