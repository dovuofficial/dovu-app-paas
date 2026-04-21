import { describe, test, expect, beforeEach } from "bun:test";
import { receiveChunk, _clearAll, _bufferCount, _setTTL, _resetConfig } from "@/mcp/chunks";

beforeEach(() => {
  _clearAll();
  _resetConfig();
});

describe("receiveChunk — single chunk", () => {
  test("total=1, single chunk returns complete immediately with assembled=data", () => {
    const r = receiveChunk("site-a", 0, 1, "hello");
    expect(r.complete).toBe(true);
    expect(r.received).toBe(1);
    expect(r.total).toBe(1);
    expect(r.assembled).toBe("hello");
    expect(_bufferCount()).toBe(0);
  });
});

describe("receiveChunk — multi chunk happy path", () => {
  test("three chunks in order — intermediate calls return complete=false, final returns assembled", () => {
    const r1 = receiveChunk("site-b", 0, 3, "aaa");
    expect(r1.complete).toBe(false);
    expect(r1.received).toBe(1);
    expect(r1.assembled).toBeUndefined();

    const r2 = receiveChunk("site-b", 1, 3, "bbb");
    expect(r2.complete).toBe(false);
    expect(r2.received).toBe(2);

    const r3 = receiveChunk("site-b", 2, 3, "ccc");
    expect(r3.complete).toBe(true);
    expect(r3.received).toBe(3);
    expect(r3.assembled).toBe("aaabbbccc");
    expect(_bufferCount()).toBe(0);
  });

  test("chunks arriving out of order assemble correctly in index order", () => {
    receiveChunk("site-c", 2, 3, "ccc");
    receiveChunk("site-c", 0, 3, "aaa");
    const final = receiveChunk("site-c", 1, 3, "bbb");
    expect(final.complete).toBe(true);
    expect(final.assembled).toBe("aaabbbccc");
  });

  test("separate labels are isolated", () => {
    receiveChunk("site-d", 0, 2, "d0");
    receiveChunk("site-e", 0, 2, "e0");
    expect(_bufferCount()).toBe(2);
    const rd = receiveChunk("site-d", 1, 2, "d1");
    expect(rd.assembled).toBe("d0d1");
    const re = receiveChunk("site-e", 1, 2, "e1");
    expect(re.assembled).toBe("e0e1");
    expect(_bufferCount()).toBe(0);
  });
});

describe("receiveChunk — validation errors", () => {
  test("total < 1 rejects", () => {
    expect(() => receiveChunk("x", 0, 0, "hi")).toThrow(/Invalid chunk total/);
  });
  test("total > 1000 rejects", () => {
    expect(() => receiveChunk("x", 0, 1001, "hi")).toThrow(/Invalid chunk total/);
  });
  test("non-integer total rejects", () => {
    expect(() => receiveChunk("x", 0, 1.5, "hi")).toThrow(/Invalid chunk total/);
  });
  test("index negative rejects", () => {
    expect(() => receiveChunk("x", -1, 3, "hi")).toThrow(/Invalid chunk index/);
  });
  test("index >= total rejects", () => {
    expect(() => receiveChunk("x", 3, 3, "hi")).toThrow(/Invalid chunk index/);
  });
  test("non-integer index rejects", () => {
    expect(() => receiveChunk("x", 1.5, 3, "hi")).toThrow(/Invalid chunk index/);
  });
  test("total mismatch across chunks for same label rejects", () => {
    receiveChunk("site-f", 0, 3, "aa");
    expect(() => receiveChunk("site-f", 1, 4, "bb")).toThrow(/total mismatch/);
  });
});

describe("receiveChunk — TTL garbage collection", () => {
  test("buffer older than TTL is dropped on next activity", async () => {
    _setTTL(50); // 50ms
    receiveChunk("site-g", 0, 2, "aa");
    expect(_bufferCount()).toBe(1);

    await Bun.sleep(100);

    // Activity on a different label triggers gc(), should evict site-g
    receiveChunk("site-h", 0, 1, "hi");
    // site-g was evicted, site-h completed (total=1, immediate complete)
    expect(_bufferCount()).toBe(0);
  });

  test("sending the second chunk after TTL starts a fresh buffer (no cross-contamination)", async () => {
    _setTTL(50);
    receiveChunk("site-i", 0, 2, "first");
    await Bun.sleep(100);

    // Fresh upload for same label with different total — should not mismatch
    const r = receiveChunk("site-i", 0, 1, "fresh");
    expect(r.complete).toBe(true);
    expect(r.assembled).toBe("fresh");
  });
});

describe("receiveChunk — idempotent re-upload of same chunk", () => {
  test("re-sending the same index with same data is idempotent", () => {
    receiveChunk("site-j", 0, 3, "a");
    receiveChunk("site-j", 1, 3, "b");
    receiveChunk("site-j", 1, 3, "b"); // duplicate index 1
    const final = receiveChunk("site-j", 2, 3, "c");
    expect(final.complete).toBe(true);
    expect(final.assembled).toBe("abc");
  });
});
