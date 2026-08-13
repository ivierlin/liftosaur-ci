#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const versionFile = path.join(repositoryRoot, "runtime", "liftosaur.version");
const expectedRemote = "https://github.com/astashov/liftosaur.git";
const npmCli = process.env.npm_execpath
  ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const generatedRuntimeFiles = new Set([
  "src/generated/liftoscriptDoc.ts",
  "src/generated/liftoscriptExamples.ts",
  "src/generated/liftoscriptGrammar.ts",
  "src/generated/plannerGrammar.ts",
]);
const cacheFormat = 1;

function usage() {
  return `Usage: node scripts/setup-runtime.mjs [--destination <path>] [--skip-install]`;
}

function parseArgs(argv) {
  const options = { destination: null, skipInstall: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (argument === "--destination") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --destination");
      options.destination = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function run(command, args, { cwd, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = capture ? `: ${(result.stderr || result.stdout).trim()}` : "";
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  return result;
}

function git(destination, args, options = {}) {
  return run("git", ["-c", `safe.directory=${destination}`, "-C", destination, ...args], options);
}

function normalizeRemote(remote) {
  return remote.trim().replace(/\/$/, "").replace(/\.git$/, "");
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const revision = (await readFile(versionFile, "utf8")).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Pinned Liftosaur revision is invalid");

  const destination = path.resolve(
    options.destination
      ?? process.env.LIFTOSAUR_RUNTIME
      ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
  );
  const readyFile = `${destination}.liftosaur-ci-ready.json`;
  const readyState = `${JSON.stringify({
    cacheFormat,
    revision,
    nodeAbi: process.versions.modules,
    platform: process.platform,
    architecture: process.arch,
  }, null, 2)}\n`;
  await mkdir(path.dirname(destination), { recursive: true });

  let hasGeneratedChanges = false;
  if (await exists(destination)) {
    if (!(await exists(path.join(destination, ".git")))) {
      throw new Error(`Runtime destination is not a Git checkout: ${destination}`);
    }
    const remote = git(destination, ["remote", "get-url", "origin"], { capture: true });
    if (normalizeRemote(remote.stdout) !== normalizeRemote(expectedRemote)) {
      throw new Error(`Runtime checkout has unexpected origin: ${remote.stdout.trim()}`);
    }
    const status = git(destination, ["status", "--porcelain", "--untracked-files=all"], { capture: true });
    const statusLines = status.stdout.trim() ? status.stdout.trimEnd().split(/\r?\n/) : [];
    const unexpected = statusLines.filter((line) => {
      const generated = line.startsWith(" M ") && generatedRuntimeFiles.has(line.slice(3));
      if (generated) hasGeneratedChanges = true;
      return !generated;
    });
    if (unexpected.length > 0) {
      throw new Error(`Runtime checkout has local changes; refusing to modify it:\n${unexpected.join("\n")}`);
    }
  } else {
    run("git", ["clone", "-c", "core.longpaths=true", expectedRemote, destination]);
  }

  const known = git(destination, ["cat-file", "-e", `${revision}^{commit}`], {
    capture: true,
    allowFailure: true,
  });
  if (known.status !== 0) git(destination, ["fetch", "origin", revision]);
  const current = git(destination, ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  if (current !== revision) {
    if (hasGeneratedChanges) {
      git(destination, ["restore", "--source=HEAD", "--", ...generatedRuntimeFiles]);
    }
    git(destination, ["checkout", "--detach", revision]);
  }
  const actual = git(destination, ["rev-parse", "HEAD"], { capture: true }).stdout.trim();
  if (actual !== revision) throw new Error(`Runtime did not resolve to ${revision}`);

  if (!options.skipInstall) {
    const ready = await exists(readyFile)
      && await exists(path.join(destination, "node_modules", ".package-lock.json"))
      && (await Promise.all(
        [...generatedRuntimeFiles].map((file) => exists(path.join(destination, file)))
      )).every(Boolean)
      && await readFile(readyFile, "utf8") === readyState;
    if (ready) {
      console.log("Reusing cached Liftosaur runtime.");
    } else {
      run(process.execPath, [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: destination });
      run(process.execPath, [npmCli, "run", "build:markdown"], { cwd: destination });
      await writeFile(readyFile, readyState);
    }
  }

  console.log("Liftosaur runtime is ready.");
  console.log(`Revision: ${revision}`);
  console.log(`Destination: ${destination}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
