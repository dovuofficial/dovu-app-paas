import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtemp, writeFile, symlink, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { validateTarball, parseTarListingLine } from "@/engine/warm";
import { slugify } from "@/mcp/register";

let workDir: string;

async function makeTar(fn: (dir: string) => Promise<void>, tarName: string): Promise<string> {
  const stageDir = await mkdtemp(join(tmpdir(), "warm-sec-stage-"));
  await fn(stageDir);
  const tarPath = join(workDir, tarName);
  await $`tar -czf ${tarPath} -C ${stageDir} .`.quiet();
  await rm(stageDir, { recursive: true, force: true });
  return tarPath;
}

/**
 * Hand-craft a POSIX ustar tarball so we can embed a literal leading-slash
 * name ("/etc/passwd") — something neither GNU tar nor BSD tar will emit
 * by default. Self-contained: no new binary deps, no shelling out to
 * python, no `brew install gtar`.
 *
 * ustar header layout (512-byte block) per POSIX IEEE 1003.1:
 *   0-99    name (100 bytes)
 *   100-107 mode
 *   108-115 uid
 *   116-123 gid
 *   124-135 size (octal, NUL-terminated)
 *   136-147 mtime (octal)
 *   148-155 checksum (6 octal digits, NUL, space) — spaces while summing
 *   156     typeflag ('0' = regular file)
 *   157-256 linkname
 *   257-262 magic "ustar\0"
 *   263-264 version "00"
 *   ... rest zeroed
 *
 * The archive ends with two 512-byte zero blocks, then we gzip the whole
 * thing with Bun.gzipSync.
 */
function buildMaliciousUstarGzip(entryName: string, fileContent: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(entryName, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  const size = Buffer.byteLength(fileContent, "utf8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  // Checksum placeholder — 8 spaces during summation.
  header.write("        ", 148, 8, "ascii");
  header.write("0", 156, 1, "ascii"); // regular file
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  // Checksum field: 6 octal digits + NUL + space.
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  // Data block (padded to 512).
  const data = Buffer.alloc(Math.ceil(size / 512) * 512 || 512);
  Buffer.from(fileContent, "utf8").copy(data, 0);

  // Two empty blocks mark end-of-archive.
  const trailer = Buffer.alloc(1024);

  const tarBytes = Buffer.concat([header, data, trailer]);
  return Buffer.from(Bun.gzipSync(tarBytes));
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "warm-sec-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("validateTarball — acceptance", () => {
  test("accepts a clean static site archive", async () => {
    const tar = await makeTar(async (d) => {
      await writeFile(join(d, "index.html"), "<h1>hi</h1>");
      await mkdir(join(d, "css"));
      await writeFile(join(d, "css", "style.css"), "body{}");
    }, "clean.tar.gz");
    await expect(validateTarball(tar)).resolves.toBeUndefined();
  });
});

describe("validateTarball — rejection", () => {
  test("rejects entries containing .. as a path segment", async () => {
    // BSD tar's equivalent of GNU `--transform` is `-s ',from,to,'`.
    // Verified to emit a literal "../evil.txt" entry on macOS BSD tar 3.5.3.
    const stageDir = await mkdtemp(join(tmpdir(), "warm-traverse-"));
    await writeFile(join(stageDir, "a.txt"), "hi");
    const tarPath = join(workDir, "traverse.tar.gz");
    await $`tar -czf ${tarPath} -C ${stageDir} -s ,a.txt,../evil.txt, a.txt`.quiet();
    await rm(stageDir, { recursive: true, force: true });
    await expect(validateTarball(tarPath)).rejects.toThrow(/\.\./);
  });

  test("rejects entries with absolute paths", async () => {
    // Neither GNU tar nor BSD tar will emit a literal leading-slash name
    // via CLI flags (both strip leading slashes by default), so we
    // hand-build a POSIX ustar tarball containing "/etc/passwd" as an
    // entry name.
    const tarBytes = buildMaliciousUstarGzip("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\n");
    const tarPath = join(workDir, "abs.tar.gz");
    await writeFile(tarPath, tarBytes);
    await expect(validateTarball(tarPath)).rejects.toThrow(/absolute|^\//i);
  });

  test("rejects symlink entries", async () => {
    const tar = await makeTar(async (d) => {
      await symlink("/etc/passwd", join(d, "evil"));
      await writeFile(join(d, "real.txt"), "ok");
    }, "symlink.tar.gz");
    await expect(validateTarball(tar)).rejects.toThrow(/symlink|link/i);
  });
});

describe("parseTarListingLine — cross-tar parser", () => {
  // Guard against a regression in the GNU-vs-BSD branch of the parser.
  // The validator must reject symlinks correctly on macOS BSD tar, where
  // owner and group are separate columns and there's a leading "0" column
  // — very different shape from GNU tar's merged "owner/group".
  test("parses canned BSD tar -tzvf output (separate owner + group columns)", () => {
    const bsdLine = "lrwxr-xr-x  0 hecate wheel       0 Apr 20 10:03 evil -> /etc/passwd";
    const parsed = parseTarListingLine(bsdLine);
    expect(parsed).not.toBeNull();
    expect(parsed!.perms.startsWith("l")).toBe(true);
    expect(parsed!.name).toBe("evil");
  });
});

describe("slugify — adversarial inputs (spec §Security.4)", () => {
  const cases = [
    "foo; rm -rf /",
    "foo}",
    "foo\n} evil",
    "../bar",
    "foo bar",
    "foo/bar",
    "foo`id`",
    "foo$(id)",
  ];
  for (const input of cases) {
    test(`output of slugify(${JSON.stringify(input)}) matches /^[a-z0-9-]+$/`, () => {
      const out = slugify(input);
      expect(out).toMatch(/^[a-z0-9-]+$/);
    });
  }
});
