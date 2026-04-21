/**
 * In-memory chunk buffer for multi-part source uploads via MCP.
 *
 * Agents stream a large base64 payload as many small chunks — each chunk is
 * a separate `deploy` tool call with a `chunk: { index, total, data }` arg.
 * Small per-call payloads avoid the slow per-token emission that chokes
 * agents on large tool arguments.
 *
 * Buffers live in memory only, keyed by the deployment label. A 5-minute
 * inactivity TTL prevents leaks when an agent dies mid-upload, and a crude
 * MAX_BUFFERS cap stops a runaway client from exhausting memory.
 *
 * Diagnostics: each received chunk and the assembled payload are hashed
 * (SHA-256, first 16 hex chars) and included in the receipt. This lets
 * clients pinpoint wire corruption without reaching into server logs.
 */

import { createHash } from "crypto";

interface ChunkBuffer {
  chunks: Map<number, string>;
  total: number;
  lastActivity: number;
}

function sha16(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

const DEFAULT_BUFFER_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BUFFERS = 32;

let BUFFER_TTL_MS = DEFAULT_BUFFER_TTL_MS;
let MAX_BUFFERS = DEFAULT_MAX_BUFFERS;

const buffers = new Map<string, ChunkBuffer>();

function gc(): void {
  const now = Date.now();
  for (const [key, buf] of buffers) {
    if (now - buf.lastActivity > BUFFER_TTL_MS) buffers.delete(key);
  }
  if (buffers.size > MAX_BUFFERS) {
    const sorted = Array.from(buffers.entries()).sort(
      (a, b) => a[1].lastActivity - b[1].lastActivity,
    );
    while (buffers.size > MAX_BUFFERS && sorted.length > 0) {
      const [key] = sorted.shift()!;
      buffers.delete(key);
    }
  }
}

export interface ChunkReceipt {
  received: number;
  total: number;
  complete: boolean;
  assembled?: string;
  /** SHA-256 of this chunk's data (first 16 hex chars). Always set. */
  chunkSha?: string;
  /** Length of this chunk's data. Always set. */
  chunkLen?: number;
  /** SHA-256 of the full assembled payload, only on the final (complete) chunk. */
  assembledSha?: string;
  /** Length of the full assembled payload, only on the final (complete) chunk. */
  assembledLen?: number;
}

export function receiveChunk(
  key: string,
  index: number,
  total: number,
  data: string,
): ChunkReceipt {
  if (!Number.isInteger(total) || total < 1 || total > 1000) {
    throw new Error(`Invalid chunk total: ${total} (must be 1–1000)`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new Error(`Invalid chunk index: ${index} (must be 0–${total - 1})`);
  }

  gc();

  let buf = buffers.get(key);
  if (!buf) {
    buf = { chunks: new Map(), total, lastActivity: Date.now() };
    buffers.set(key, buf);
  }
  if (buf.total !== total) {
    throw new Error(
      `Chunk total mismatch for "${key}": got ${total}, buffer expected ${buf.total}`,
    );
  }

  buf.chunks.set(index, data);
  buf.lastActivity = Date.now();

  const chunkSha = sha16(data);
  const chunkLen = data.length;

  // Stderr log so operators can see every chunk as it lands on the server.
  console.error(
    `[chunks] key=${key} idx=${index}/${total - 1} len=${chunkLen} sha=${chunkSha}`,
  );

  if (buf.chunks.size < total) {
    return { received: buf.chunks.size, total, complete: false, chunkSha, chunkLen };
  }

  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = buf.chunks.get(i);
    if (chunk === undefined) {
      throw new Error(`Chunk buffer inconsistent for "${key}": missing index ${i}`);
    }
    parts.push(chunk);
  }
  buffers.delete(key);
  const assembled = parts.join("");
  const assembledSha = sha16(assembled);
  const assembledLen = assembled.length;
  console.error(
    `[chunks] key=${key} ASSEMBLED len=${assembledLen} sha=${assembledSha}`,
  );
  return {
    received: total,
    total,
    complete: true,
    assembled,
    chunkSha,
    chunkLen,
    assembledSha,
    assembledLen,
  };
}

// Test-only helpers
export function _clearAll(): void {
  buffers.clear();
}

export function _bufferCount(): number {
  return buffers.size;
}

export function _setTTL(ms: number): void {
  BUFFER_TTL_MS = ms;
}

export function _resetConfig(): void {
  BUFFER_TTL_MS = DEFAULT_BUFFER_TTL_MS;
  MAX_BUFFERS = DEFAULT_MAX_BUFFERS;
}
