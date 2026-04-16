#!/usr/bin/env bun
/**
 * Agent Training Harness
 *
 * Spawns Claude agents in batches of 5 to build and deploy microapps.
 * After each batch: checks endpoints, destroys successful deploys, logs failures.
 * Runs up to 20 batches (100 agents).
 *
 * Usage:
 *   bun harness/run.ts                        # run all 100 tasks, 5 concurrent, 20 batches
 *   bun harness/run.ts --batch-size 3         # 3 per batch
 *   bun harness/run.ts --batches 5            # only 5 batches
 *   bun harness/run.ts --start-batch 4        # resume from batch 4
 *   bun harness/run.ts --dry-run              # print prompts, don't spawn
 *   bun harness/run.ts --filter bun           # only tasks matching "bun"
 */

import { MATRIX, type Task } from "./matrix";
import { buildPrompt } from "./prompt";
import { parseArgs } from "util";

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "batch-size": { type: "string", default: "5" },
    batches: { type: "string", default: "20" },
    "start-batch": { type: "string", default: "1" },
    "dry-run": { type: "boolean", default: false },
    filter: { type: "string", default: "" },
    repo: { type: "string", default: "dovuofficial/dovu-app-paas" },
    "mcp-config": { type: "string", default: "harness/mcp-config.json" },
    model: { type: "string", default: "sonnet" },
  },
});

const BATCH_SIZE = parseInt(args["batch-size"]!, 10);
const MAX_BATCHES = parseInt(args.batches!, 10);
const START_BATCH = parseInt(args["start-batch"]!, 10);
const DRY_RUN = args["dry-run"]!;
const FILTER = args.filter!;
const REPO = args.repo!;
const MCP_CONFIG = args["mcp-config"]!;
const MODEL = args.model!;

const DROPLET_HOST = process.env.DROPLET_HOST || "YOUR_DROPLET_IP";
const DROPLET_USER = process.env.DROPLET_USER || "deploy";
const MAX_DISK_PERCENT = 90;

interface AgentResult {
  task: Task;
  exitCode: number;
  durationMs: number;
  output: string;
}

interface BatchReport {
  batch: number;
  results: AgentResult[];
  endpointChecks: { id: string; url: string; status: number | null }[];
  destroyed: string[];
  diskPercent: number;
}

// Filter tasks
let tasks = MATRIX;
if (FILTER) {
  tasks = tasks.filter(
    (t) =>
      t.id.includes(FILTER) ||
      t.framework.includes(FILTER) ||
      t.complexity.includes(FILTER)
  );
}

// Split into batches
const batches: Task[][] = [];
for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
  batches.push(tasks.slice(i, i + BATCH_SIZE));
}

console.log(`\n=== Agent Training Harness ===`);
console.log(`Total tasks: ${tasks.length} | Batch size: ${BATCH_SIZE} | Batches: ${Math.min(batches.length, MAX_BATCHES)} | Model: ${MODEL}`);
console.log(`Repo: ${REPO}`);
if (DRY_RUN) console.log(`Mode: DRY RUN\n`);
else console.log();

if (tasks.length === 0) {
  console.log("No tasks matched. Exiting.");
  process.exit(0);
}

if (DRY_RUN) {
  for (const task of tasks) {
    console.log(`=== ${task.id} (${task.framework}/${task.complexity}) ===`);
    console.log(buildPrompt(task, REPO));
    console.log();
  }
  process.exit(0);
}

// --- Utilities ---

async function ssh(cmd: string): Promise<string> {
  const proc = Bun.spawn(["ssh", "-o", "ConnectTimeout=10", `${DROPLET_USER}@${DROPLET_HOST}`, cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function checkDisk(): Promise<number> {
  const out = await ssh("df --output=pcent / | tail -1");
  return parseInt(out.replace("%", "").trim(), 10) || 0;
}

async function checkEndpoint(url: string): Promise<number | null> {
  // Try root first, then common API paths
  for (const path of ["", "/health", "/api"]) {
    try {
      const resp = await fetch(url + path, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
      if (resp.status >= 200 && resp.status < 400) return resp.status;
    } catch {}
  }
  // Final attempt — return whatever root gives us
  try {
    const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return resp.status;
  } catch {
    return null;
  }
}

async function destroyApp(appId: string): Promise<void> {
  const containerName = `dovu-app-paas-${appId}`;
  await ssh(`docker stop ${containerName} 2>/dev/null; docker rm ${containerName} 2>/dev/null`);
  // Remove image
  await ssh(`docker images --format '{{.Repository}}:{{.Tag}}' | grep 'dovu-app-paas-${appId}:' | xargs -r docker rmi 2>/dev/null`);
  // Remove nginx config
  await ssh(`rm -f /etc/nginx/conf.d/dovu-app-paas-${appId}.conf 2>/dev/null`);
}

async function pruneDocker(): Promise<void> {
  await ssh("docker system prune -af 2>/dev/null");
}

async function reloadNginx(): Promise<void> {
  await ssh("nginx -s reload 2>/dev/null || sudo systemctl reload nginx 2>/dev/null");
}

async function getDeployedApps(): Promise<{ name: string; domain: string }[]> {
  const stateJson = await ssh("cat /opt/deploy-ops/workspace/.dovu-app-paas/state.json 2>/dev/null");
  if (!stateJson) return [];
  try {
    const state = JSON.parse(stateJson);
    return Object.values(state.deployments || {}).map((d: any) => ({
      name: d.name,
      domain: d.domain,
    }));
  } catch {
    return [];
  }
}

// Spawn a single agent
async function runAgent(task: Task): Promise<AgentResult> {
  const prompt = buildPrompt(task, REPO);
  const start = Date.now();

  const cliArgs = [
    "claude",
    "-p", prompt,
    "--model", MODEL,
    "--allowedTools", "mcp__deploy-ops__deploy", "mcp__deploy-ops__status", "mcp__deploy-ops__logs", "mcp__deploy-ops__ls", "Bash", "Read", "Write", "Edit", "Glob",
    "--dangerously-skip-permissions",
    "--max-budget-usd", "1.00",
    "--no-session-persistence",
  ];

  if (MCP_CONFIG) {
    cliArgs.push("--mcp-config", MCP_CONFIG);
  }

  console.log(`  [START] ${task.id} (${task.framework}/${task.complexity})`);

  const proc = Bun.spawn(cliArgs, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  const durationMs = Date.now() - start;
  const durationMin = (durationMs / 60_000).toFixed(1);

  const status = exitCode === 0 ? "DONE" : "FAIL";
  console.log(`  [${status}] ${task.id} — ${durationMin}m (exit ${exitCode})`);

  return { task, exitCode, durationMs, output };
}

// Run a batch of tasks in parallel
async function runBatch(batch: Task[]): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  const active = new Set<Promise<AgentResult>>();

  for (const task of batch) {
    const promise = runAgent(task).then((result) => {
      active.delete(promise);
      results.push(result);
      return result;
    });
    active.add(promise);
  }

  // Wait for all to finish
  await Promise.all(active);
  return results;
}

// --- Main Loop ---

const allReports: BatchReport[] = [];
const startTime = Date.now();
let totalSucceeded = 0;
let totalFailed = 0;

const endBatch = Math.min(START_BATCH - 1 + MAX_BATCHES, batches.length);

for (let batchIdx = START_BATCH - 1; batchIdx < endBatch; batchIdx++) {
  const batchNum = batchIdx + 1;
  const batch = batches[batchIdx];

  console.log(`\n${"=".repeat(60)}`);
  console.log(`BATCH ${batchNum}/${endBatch} — ${batch.length} agents`);
  console.log(`${"=".repeat(60)}`);

  // 1. Check disk before starting
  const diskBefore = await checkDisk();
  console.log(`Disk: ${diskBefore}%`);
  if (diskBefore >= MAX_DISK_PERCENT) {
    console.log(`[STOP] Disk at ${diskBefore}% — pruning Docker...`);
    await pruneDocker();
    const diskAfter = await checkDisk();
    console.log(`Disk after prune: ${diskAfter}%`);
    if (diskAfter >= MAX_DISK_PERCENT) {
      console.log(`[STOP] Still at ${diskAfter}% — stopping harness.`);
      break;
    }
  }

  // 2. Run the batch
  const results = await runBatch(batch);

  // 3. Wait for containers to stabilize (nginx reload + container boot)
  await Bun.sleep(15_000);

  // 4. Check endpoints
  console.log(`\n  Checking endpoints...`);
  const deployedApps = await getDeployedApps();
  const endpointChecks: { id: string; url: string; status: number | null }[] = [];

  for (const result of results) {
    const app = deployedApps.find((a) => a.name === result.task.id);
    if (app) {
      const url = `https://${app.domain}`;
      const status = await checkEndpoint(url);
      endpointChecks.push({ id: result.task.id, url, status });
      const icon = status === 200 ? "+" : "x";
      console.log(`  [${icon}] ${result.task.id} → ${url} (${status ?? "unreachable"})`);
    } else {
      endpointChecks.push({ id: result.task.id, url: "not deployed", status: null });
      console.log(`  [x] ${result.task.id} → not found in state`);
    }
  }

  // 5. Destroy successful deploys to free resources
  const succeeded = endpointChecks.filter((c) => c.status === 200);
  const failed = endpointChecks.filter((c) => c.status !== 200);
  const destroyed: string[] = [];

  if (succeeded.length > 0) {
    console.log(`\n  Cleaning up ${succeeded.length} successful deploys...`);
    for (const s of succeeded) {
      await destroyApp(s.id);
      destroyed.push(s.id);
      console.log(`  [cleanup] ${s.id} destroyed`);
    }
    await reloadNginx();
  }

  // 6. Also destroy failed deploys to free resources
  if (failed.length > 0) {
    console.log(`\n  Cleaning up ${failed.length} failed deploys...`);
    for (const f of failed) {
      await destroyApp(f.id);
      console.log(`  [cleanup] ${f.id} destroyed`);
    }
    await reloadNginx();
  }

  // 7. Prune after batch
  await pruneDocker();

  totalSucceeded += succeeded.length;
  totalFailed += failed.length;

  const report: BatchReport = {
    batch: batchNum,
    results,
    endpointChecks,
    destroyed,
    diskPercent: await checkDisk(),
  };
  allReports.push(report);

  // 8. Batch summary
  console.log(`\n  Batch ${batchNum} summary: ${succeeded.length} ok, ${failed.length} failed | Disk: ${report.diskPercent}%`);
  console.log(`  Running total: ${totalSucceeded} ok, ${totalFailed} failed`);
}

// --- Final Report ---

const totalMin = ((Date.now() - startTime) / 60_000).toFixed(1);

console.log(`\n${"=".repeat(60)}`);
console.log(`HARNESS COMPLETE`);
console.log(`${"=".repeat(60)}`);
console.log(`Total time: ${totalMin}m`);
console.log(`Agents: ${totalSucceeded + totalFailed}`);
console.log(`Succeeded: ${totalSucceeded}`);
console.log(`Failed: ${totalFailed}`);
console.log(`Success rate: ${((totalSucceeded / (totalSucceeded + totalFailed)) * 100).toFixed(0)}%`);

// Failures by framework
const failuresByFramework = new Map<string, string[]>();
for (const report of allReports) {
  for (const check of report.endpointChecks) {
    if (check.status !== 200) {
      const task = MATRIX.find((t) => t.id === check.id);
      if (task) {
        const list = failuresByFramework.get(task.framework) || [];
        list.push(task.id);
        failuresByFramework.set(task.framework, list);
      }
    }
  }
}

if (failuresByFramework.size > 0) {
  console.log(`\nFailures by framework:`);
  for (const [fw, ids] of [...failuresByFramework.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${fw}: ${ids.length} failures (${ids.join(", ")})`);
  }
}

// Save full report
const reportData = {
  timestamp: new Date().toISOString(),
  totalDurationMs: Date.now() - startTime,
  batchSize: BATCH_SIZE,
  model: MODEL,
  totalSucceeded,
  totalFailed,
  successRate: ((totalSucceeded / (totalSucceeded + totalFailed)) * 100).toFixed(1) + "%",
  batches: allReports.map((r) => ({
    batch: r.batch,
    diskPercent: r.diskPercent,
    results: r.endpointChecks.map((c) => ({
      id: c.id,
      url: c.url,
      httpStatus: c.status,
      success: c.status === 200,
    })),
  })),
  failuresByFramework: Object.fromEntries(failuresByFramework),
};

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const reportPath = `harness/reports/${ts}-full-run.json`;
await Bun.write(reportPath, JSON.stringify(reportData, null, 2));
console.log(`\nReport saved: ${reportPath}`);
