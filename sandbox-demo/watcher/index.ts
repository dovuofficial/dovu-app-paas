#!/usr/bin/env bun
/**
 * dovu-app-paas watcher
 *
 * Watches a project directory for file changes and automatically triggers
 * `dovu-app-paas deploy` (or the local CLI) when changes are detected.
 *
 * Usage:
 *   bun run index.ts [path-to-project]
 *
 * If no path is provided, watches the current working directory.
 */

import { watch } from "fs";
import { resolve, relative } from "path";

// ─── ANSI colors ─────────────────────────────────────────────────────────────
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;

// ─── Config ───────────────────────────────────────────────────────────────────
const DEBOUNCE_MS = 500;

const IGNORED_DIRS = new Set(["node_modules", ".dovu-app-paas", ".git"]);

function isIgnored(filePath: string, watchRoot: string): boolean {
  const rel = relative(watchRoot, filePath);
  const parts = rel.split("/");

  // Ignore hidden/ignored directories anywhere in the path
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }

  // Ignore *.tar files
  if (rel.endsWith(".tar")) return true;

  return false;
}

// ─── Deploy ───────────────────────────────────────────────────────────────────
async function runDeploy(projectDir: string): Promise<void> {
  console.log(cyan("\n▶  Running dovu-app-paas deploy..."));

  // Prefer the globally installed `dovu-app-paas` binary; fall back to the
  // local CLI source so this works straight from the repo without installing.
  const cliPath = resolve(import.meta.dir, "../../src/cli/index.ts");
  const useLocalCli = await Bun.file(cliPath).exists();

  const cmd = useLocalCli
    ? ["bun", "run", cliPath, "deploy"]
    : ["dovu-app-paas", "deploy"];

  const proc = Bun.spawn(cmd, {
    cwd: projectDir,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    console.log(green("\n✓  Deploy complete"));
  } else {
    console.error(`\x1b[31m✗  Deploy failed (exit ${exitCode})\x1b[0m`);
  }
}

// ─── Watcher ──────────────────────────────────────────────────────────────────
function startWatcher(projectDir: string): void {
  const absDir = resolve(projectDir);

  console.log(cyan("dovu-app-paas watcher"));
  console.log(dim(`  Watching: ${absDir}`));
  console.log(dim(`  Debounce: ${DEBOUNCE_MS}ms`));
  console.log(dim(`  Ignoring: node_modules/, .dovu-app-paas/, .git/, *.tar`));
  console.log(dim("  Press Ctrl+C to stop\n"));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let deploying = false;

  const handleChange = (eventType: string, filename: string | null) => {
    if (!filename) return;

    const fullPath = resolve(absDir, filename);

    if (isIgnored(fullPath, absDir)) return;

    const relPath = relative(absDir, fullPath);

    // Clear any pending debounce
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;

      if (deploying) {
        console.log(yellow("  (deploy already in progress, skipping)"));
        return;
      }

      console.log(yellow(`\n⚡  Change detected: ${relPath}`));

      deploying = true;
      try {
        await runDeploy(absDir);
      } finally {
        deploying = false;
      }
    }, DEBOUNCE_MS);
  };

  watch(
    absDir,
    { recursive: true },
    handleChange,
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const targetArg = process.argv[2];
const targetDir = targetArg ? resolve(targetArg) : process.cwd();

// Verify the target exists and is a directory
const stat = await Bun.file(targetDir).stat().catch(() => null);
if (!stat || !stat.isDirectory()) {
  console.error(`\x1b[31mError: '${targetDir}' is not a valid directory\x1b[0m`);
  process.exit(1);
}

startWatcher(targetDir);
