import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtemp, rm, utimes, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  storeUpload,
  readUpload,
  consumeUpload,
  gcUploads,
  UPLOAD_TTL_MS,
  UPLOAD_MAX_BYTES,
  _setUploadsDir,
} from "@/mcp/uploads";

const testDir = await mkdtemp(join(tmpdir(), "mcp-uploads-test-"));
_setUploadsDir(testDir);

beforeEach(async () => {
  for (const f of await readdir(testDir).catch(() => [])) {
    await rm(join(testDir, f), { force: true });
  }
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("storeUpload", () => {
  test("stores bytes and returns a prefixed uploadId", async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00]); // gzip magic
    const id = await storeUpload(bytes);
    expect(id).toMatch(/^upl_[a-f0-9-]{36}$/);
    const read = await readUpload(id);
    expect(read).not.toBeNull();
    expect(read!.equals(Buffer.from(bytes))).toBe(true);
  });

  test("rejects empty upload", async () => {
    await expect(storeUpload(new Uint8Array())).rejects.toThrow(/empty/);
  });

  test("rejects upload over max size", async () => {
    const tooBig = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    await expect(storeUpload(tooBig)).rejects.toThrow(/too large/);
  });
});

describe("readUpload / consumeUpload", () => {
  test("readUpload returns null for unknown id", async () => {
    expect(await readUpload("upl_00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  test("readUpload refuses malformed ids (path-traversal defence)", async () => {
    expect(await readUpload("../evil")).toBeNull();
    expect(await readUpload("upl_../etc/passwd")).toBeNull();
    expect(await readUpload("no-prefix-uuid")).toBeNull();
    expect(await readUpload("upl_")).toBeNull();
  });

  test("consumeUpload returns bytes and deletes the file", async () => {
    const id = await storeUpload(new Uint8Array([1, 2, 3]));
    const first = await consumeUpload(id);
    expect(first).not.toBeNull();
    expect(first!.equals(Buffer.from([1, 2, 3]))).toBe(true);
    // Second read should miss.
    expect(await readUpload(id)).toBeNull();
  });
});

describe("gcUploads", () => {
  test("removes files older than TTL, keeps fresh ones", async () => {
    const fresh = await storeUpload(new Uint8Array([1, 2, 3]));
    const old = await storeUpload(new Uint8Array([4, 5, 6]));
    // Backdate the 'old' file beyond TTL.
    const oldPath = join(testDir, `${old}.bin`);
    const past = new Date(Date.now() - UPLOAD_TTL_MS - 60_000);
    await utimes(oldPath, past, past);

    const removed = await gcUploads();
    expect(removed).toBe(1);
    expect(await readUpload(fresh)).not.toBeNull();
    expect(await readUpload(old)).toBeNull();
  });

  test("no-op on empty dir", async () => {
    expect(await gcUploads()).toBe(0);
  });
});
