import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const runtimeDir = join(root, "data", "runtime");

export function statusPath(taskId) {
  return join(runtimeDir, `${taskId}.json`);
}

export function writeTaskStatus(taskId, payload) {
  mkdirSync(runtimeDir, { recursive: true });
  const next = {
    taskId,
    updatedAt: new Date().toISOString(),
    ...payload,
  };
  writeFileSync(statusPath(taskId), JSON.stringify(next, null, 2));
  return next;
}

export function readTaskStatus(taskId) {
  const path = statusPath(taskId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
