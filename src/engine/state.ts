import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { AppConfig, StateFile } from "@/types";

const CONFIG_DIR = ".dovu-app-paas";
const CONFIG_FILE = "config.json";
const STATE_FILE = "state.json";

function configPath(baseDir: string): string {
  return join(baseDir, CONFIG_DIR, CONFIG_FILE);
}

function statePath(baseDir: string): string {
  return join(baseDir, CONFIG_DIR, STATE_FILE);
}

async function ensureDir(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, CONFIG_DIR), { recursive: true });
}

export async function readConfig(baseDir: string): Promise<AppConfig | null> {
  try {
    const data = await readFile(configPath(baseDir), "utf-8");
    return JSON.parse(data) as AppConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(baseDir: string, config: AppConfig): Promise<void> {
  await ensureDir(baseDir);
  await writeFile(configPath(baseDir), JSON.stringify(config, null, 2) + "\n");
}

export async function readState(baseDir: string): Promise<StateFile> {
  try {
    const data = await readFile(statePath(baseDir), "utf-8");
    return JSON.parse(data) as StateFile;
  } catch {
    return { deployments: {} };
  }
}

export async function writeState(baseDir: string, state: StateFile): Promise<void> {
  await ensureDir(baseDir);
  await writeFile(statePath(baseDir), JSON.stringify(state, null, 2) + "\n");
}

export async function getNextPort(baseDir: string): Promise<number> {
  const state = await readState(baseDir);
  const ports = Object.values(state.deployments).map((d) => d.hostPort);
  if (ports.length === 0) return 3001;
  return Math.max(...ports) + 1;
}
