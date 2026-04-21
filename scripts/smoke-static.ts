#!/usr/bin/env bun
/**
 * End-to-end smoke test for the static-site warm-slot path.
 *
 * Exercises the full lifecycle against a real LocalProvider (DinD mini-droplet):
 *   1. setup mini-droplet
 *   2. prewarm slot → HTTP probe → expect placeholder
 *   3. deploy v1 → HTTP probe → expect v1 content
 *   4. deploy v2 → HTTP probe → expect v2 (symlink swap)
 *   5. list rev dirs → expect exactly one (cleanup happened)
 *   6. dotfile probe → expect 404
 *   7. destroy → HTTP probe → expect error (site gone)
 *   8. verify dirs + nginx conf removed
 *
 * Fails loud, cleans up in finally regardless.
 *
 * Requires: Docker running, port 80 free.
 */
import { LocalProvider } from "@/providers/local";
import { provisionStaticSlot, deployStaticSlot, destroyStaticSlot } from "@/engine/warm";
import { $ } from "bun";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";

const SLUG = `smoke-static-${Date.now().toString(36)}`;
const URL = `http://${SLUG}.ops.localhost`;

async function makeTarB64(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "smoke-"));
  for (const [relPath, body] of Object.entries(files)) {
    const full = join(dir, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  const tar = join(tmpdir(), `${SLUG}-tmp.tar.gz`);
  await $`tar -czf ${tar} -C ${dir} .`.quiet();
  const buf = await readFile(tar);
  await rm(dir, { recursive: true, force: true });
  await rm(tar, { force: true });
  return buf.toString("base64");
}

async function probe(path = ""): Promise<{ status: number; body: string }> {
  const resp = await fetch(URL + path, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  return { status: resp.status, body: await resp.text() };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  console.log(`\n=== Smoke test: ${SLUG} ===`);
  console.log(`URL: ${URL}\n`);

  const provider = new LocalProvider("ops.localhost");

  let slotOk = false;
  try {
    console.log(`[1/8] LocalProvider.setup() — starts mini-droplet DinD + nginx`);
    await provider.setup();
    console.log(`      ✓ mini-droplet ready\n`);

    console.log(`[2/8] provisionStaticSlot(${SLUG})`);
    await provisionStaticSlot(provider, SLUG);
    slotOk = true;
    console.log(`      ✓ provisioned\n`);

    // Give nginx a beat to settle after reload
    await Bun.sleep(500);

    console.log(`[3/8] GET ${URL} — expect placeholder`);
    const p1 = await probe();
    console.log(`      HTTP ${p1.status}`);
    assert(p1.status === 200, `expected 200, got ${p1.status}`);
    assert(p1.body.includes("provisioning"), `placeholder text missing. body[0..120]: ${p1.body.slice(0, 120)}`);
    assert(p1.body.includes(SLUG), `slot name missing from placeholder`);
    console.log(`      ✓ placeholder served (contains slot name + "provisioning")\n`);

    console.log(`[4/8] deployStaticSlot v1 — simple HTML`);
    const v1 = await makeTarB64({
      "index.html": `<!doctype html><title>v1</title><h1 id="marker">v1-content</h1>`,
    });
    const r1 = await deployStaticSlot(provider, SLUG, v1);
    console.log(`      revision: ${r1.revision}`);
    await Bun.sleep(200);
    const p2 = await probe();
    assert(p2.status === 200, `expected 200, got ${p2.status}`);
    assert(p2.body.includes("v1-content"), `v1 content missing. body[0..120]: ${p2.body.slice(0, 120)}`);
    assert(!p2.body.includes("provisioning"), `still serving placeholder after deploy`);
    console.log(`      ✓ v1 served\n`);

    console.log(`[5/8] deployStaticSlot v2 — different HTML + nested asset`);
    const v2 = await makeTarB64({
      "index.html": `<!doctype html><title>v2</title><link rel="stylesheet" href="/css/style.css"><h1 id="marker">v2-content</h1>`,
      "css/style.css": `body { color: rebeccapurple; }`,
      ".env": `SECRET=should-never-be-served`,
    });
    const r2 = await deployStaticSlot(provider, SLUG, v2);
    console.log(`      revision: ${r2.revision} (prev was ${r1.revision})`);
    assert(r2.revision !== r1.revision, `revision didn't change across deploys`);
    await Bun.sleep(200);
    const p3 = await probe();
    assert(p3.body.includes("v2-content"), `v2 content missing`);
    const p3css = await probe("/css/style.css");
    assert(p3css.status === 200 && p3css.body.includes("rebeccapurple"), `nested asset missing`);
    console.log(`      ✓ v2 served (incl. nested CSS asset)\n`);

    console.log(`[6/8] Revision cleanup: exactly one rev dir should remain`);
    const lsOut = await provider.exec(`ls -1 /opt/deploy-ops/sites/ 2>/dev/null | grep '${SLUG}' || true`);
    const entries = lsOut.trim().split("\n").filter(Boolean).sort();
    console.log(`      entries: ${entries.join(", ")}`);
    const revs = entries.filter((e) => e.includes("-rev-"));
    assert(revs.length === 1, `expected exactly 1 rev dir, got ${revs.length}: ${revs}`);
    assert(revs[0] === `${SLUG}-${r2.revision}`, `wrong rev dir kept`);
    assert(entries.includes(`${SLUG}-initial`), `initial dir should still exist`);
    assert(entries.includes(SLUG), `symlink should still exist`);
    console.log(`      ✓ old rev cleaned, current rev + initial + symlink present\n`);

    console.log(`[7/8] Security: dotfile deny`);
    const pEnv = await probe("/.env");
    console.log(`      GET ${URL}/.env → HTTP ${pEnv.status}`);
    assert(pEnv.status === 404, `expected 404 for /.env, got ${pEnv.status} — dotfile deny not working`);
    assert(!pEnv.body.includes("should-never-be-served"), `.env contents leaked!`);
    console.log(`      ✓ dotfile deny working (.env returned 404, no leak)\n`);

    console.log(`[8/8] destroyStaticSlot`);
    await destroyStaticSlot(provider, SLUG);
    slotOk = false;
    await Bun.sleep(200);
    const pGone = await probe().catch((e) => ({ status: -1, body: String(e) }));
    console.log(`      after destroy: HTTP ${pGone.status}`);
    assert(pGone.status !== 200 || !pGone.body.includes("v2-content"), `site still serving after destroy`);
    const lsOut2 = await provider.exec(`ls -1 /opt/deploy-ops/sites/ 2>/dev/null | grep '${SLUG}' || true`);
    assert(lsOut2.trim() === "", `leftover entries after destroy: ${lsOut2.trim()}`);
    const confCheck = await provider
      .exec(`ls /etc/nginx/conf.d/dovu-app-paas-${SLUG}.conf 2>/dev/null || echo MISSING`)
      .catch(() => "MISSING");
    assert(confCheck.trim() === "MISSING", `nginx conf still present`);
    console.log(`      ✓ destroyed cleanly — no leftover dirs or nginx conf\n`);

    console.log(`=== SMOKE PASS ===\n`);
  } catch (err) {
    console.error(`\n=== SMOKE FAIL ===`);
    if (err && typeof err === "object") {
      const anyErr = err as any;
      console.error(`message: ${anyErr.message ?? "(none)"}`);
      if (anyErr.stderr) console.error(`stderr: ${anyErr.stderr.toString()}`);
      if (anyErr.stdout) console.error(`stdout: ${anyErr.stdout.toString()}`);
      if (anyErr.exitCode !== undefined) console.error(`exitCode: ${anyErr.exitCode}`);
      if (anyErr.stack) console.error(`\nstack:\n${anyErr.stack}`);
    } else {
      console.error(String(err));
    }
    if (slotOk) {
      console.log(`\nCleaning up slot ${SLUG}...`);
      try {
        await destroyStaticSlot(provider, SLUG);
      } catch {}
    }
    process.exit(1);
  }
}

await main();
