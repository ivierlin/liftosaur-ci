import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.dirname(sourceDirectory);
export const pinnedRuntimeRevision = readFileSync(
  path.join(repositoryRoot, "runtime", "liftosaur.version"),
  "utf8"
).trim();

let runtimeAdapter;

export function loadLiftosaurRuntime() {
  if (runtimeAdapter) return runtimeAdapter;

  const root = path.resolve(
    process.env.LIFTOSAUR_RUNTIME
      ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
  );
  const packageFile = path.join(root, "package.json");
  if (!existsSync(packageFile)) {
    throw new Error(
      `Pinned Liftosaur runtime is unavailable at ${root}; run npm run setup:runtime`
    );
  }

  const revision = spawnSync(
    "git",
    ["-c", `safe.directory=${root}`, "-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true }
  );
  if (revision.status !== 0 || revision.stdout.trim() !== pinnedRuntimeRevision) {
    throw new Error(`Liftosaur runtime must be pinned at ${pinnedRuntimeRevision}`);
  }

  const runtimeRequire = createRequire(packageFile);
  runtimeRequire("ts-node").register({
    project: path.join(root, "tsconfig.json"),
  });
  runtimeAdapter = Object.freeze({
    root,
    revision: pinnedRuntimeRevision,
    require(relativePath) {
      return runtimeRequire(path.join(root, relativePath));
    },
  });
  return runtimeAdapter;
}
