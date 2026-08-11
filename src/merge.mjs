import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalizeLiftosaurSource } from "./source-format.mjs";
import {
  BLOCK_MARKER,
  LIFTOSAUR_MERGE_FRONTEND,
  parseLiftosaurMergeDocument,
  projectLiftosaurSource,
  restoreProjectedSource,
} from "./frontend.mjs";

export {
  LIFTOSAUR_MERGE_FRONTEND,
  projectLiftosaurSource,
  restoreProjectedSource,
} from "./frontend.mjs";

function gitManagedBodies(source) {
  const normalized = canonicalizeLiftosaurSource(source);
  return [
    ...(normalized.match(/\{~[^~]*~\}/g) ?? []),
    ...(normalized.match(/\{\s*\.\.\.[^{}]*\}/g) ?? []),
  ].sort();
}

function assertLiveProgramLogicUnchanged(base, active) {
  const baseBodies = gitManagedBodies(base);
  const activeBodies = gitManagedBodies(active);
  if (baseBodies.length === activeBodies.length
    && baseBodies.every((body, index) => body === activeBodies[index])) {
    return;
  }
  throw new Error(
    "Live Liftosaur program contains changes inside Git-managed { ... } bodies. "
    + "Commit those changes in Git or discard them in Liftosaur before updating."
  );
}

function gitMergeFiles(activePath, basePath, candidatePath) {
  const result = spawnSync(
    "git",
    [
      "merge-file",
      "-p",
      "--diff3",
      "-L",
      "active",
      "-L",
      "base",
      "-L",
      "candidate",
      activePath,
      basePath,
      candidatePath,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.error) throw result.error;
  if (result.status === 0) {
    return { conflict: false, source: result.stdout };
  }
  if (result.status > 0 && result.stdout.includes("<<<<<<< active")) {
    return { conflict: true, source: result.stdout };
  }
  throw new Error(
    `git merge-file failed with exit code ${result.status}: ${result.stderr.trim()}`
  );
}
async function gitMergeSources({ base, active, candidate }, directory, prefix) {
  const paths = {
    base: path.join(directory, `${prefix}-base.liftoscript`),
    active: path.join(directory, `${prefix}-active.liftoscript`),
    candidate: path.join(directory, `${prefix}-candidate.liftoscript`),
  };
  await Promise.all(Object.entries(paths).map(([name, file]) =>
    writeFile(file, { base, active, candidate }[name], "utf8")
  ));
  return gitMergeFiles(paths.active, paths.base, paths.candidate);
}

async function mergeRelocatedBlocks(sources, directory) {
  const extracted = {
    base: parseLiftosaurMergeDocument(sources.base),
    active: parseLiftosaurMergeDocument(sources.active),
    candidate: parseLiftosaurMergeDocument(sources.candidate),
  };
  const order = await gitMergeSources({
    base: extracted.base.order,
    active: extracted.active.order,
    candidate: extracted.candidate.order,
  }, directory, "block-order");
  if (order.conflict) {
    return { conflict: true, source: order.source, extracted, stage: "block-order" };
  }

  const mergedBlocks = new Map();
  const mergedKeys = order.source
    .split("\n")
    .filter((line) => line.startsWith(`${BLOCK_MARKER} `))
    .map((line) => line.slice(BLOCK_MARKER.length + 1));
  const candidateKeys = [...extracted.candidate.blocks.keys()];
  if (JSON.stringify(mergedKeys) !== JSON.stringify(candidateKeys)) {
    return {
      conflict: true,
      source: "Merged block order cannot be represented by the candidate layout",
      extracted,
      stage: "candidate-layout",
    };
  }
  const allKeys = new Set([
    ...extracted.base.blocks.keys(),
    ...extracted.active.blocks.keys(),
    ...extracted.candidate.blocks.keys(),
  ]);
  const blockEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

  for (const key of allKeys) {
    const base = extracted.base.blocks.get(key);
    const active = extracted.active.blocks.get(key);
    const candidate = extracted.candidate.blocks.get(key);
    if (base !== undefined && candidate === undefined && active !== undefined
      && !blockEqual(active, base)) {
      return {
        conflict: true,
        source: `Candidate removed an actively changed block: ${key}`,
        extracted,
        stage: "block-removal",
        blockKey: key,
      };
    }
    if (base !== undefined && active === undefined && candidate !== undefined
      && !blockEqual(candidate, base)) {
      return {
        conflict: true,
        source: `Active removed a candidate-changed block: ${key}`,
        extracted,
        stage: "block-removal",
        blockKey: key,
      };
    }
  }

  for (let index = 0; index < mergedKeys.length; index += 1) {
    const key = mergedKeys[index];
    const raw = {
      base: extracted.base.blocks.get(key),
      active: extracted.active.blocks.get(key),
      candidate: extracted.candidate.blocks.get(key),
    };
    const prefix = await gitMergeSources({
      base: raw.base?.prefix ?? "",
      active: raw.active?.prefix ?? "",
      candidate: raw.candidate?.prefix ?? "",
    }, directory, `block-${index}-prefix`);
    if (prefix.conflict) {
      return {
        conflict: true,
        source: `${BLOCK_MARKER} ${key}\n${prefix.source}`,
        extracted,
        stage: "block-prefix",
        blockKey: key,
      };
    }
    const projected = {
      base: projectLiftosaurSource(raw.base?.body ?? ""),
      active: projectLiftosaurSource(raw.active?.body ?? ""),
      candidate: projectLiftosaurSource(raw.candidate?.body ?? ""),
    };
    const merged = await gitMergeSources({
      base: projected.base.source,
      active: projected.active.source,
      candidate: projected.candidate.source,
    }, directory, `block-${index}`);
    if (merged.conflict) {
      return {
        conflict: true,
        source: `${BLOCK_MARKER} ${key}\n${merged.source}`,
        extracted,
        stage: "block-content",
        blockKey: key,
      };
    }
    const preferred = projected.candidate.stateOrders.length > 0
      ? projected.candidate.stateOrders
      : projected.active.stateOrders.length > 0
        ? projected.active.stateOrders
        : projected.base.stateOrders;
    mergedBlocks.set(key, [
      prefix.source.trimEnd(),
      restoreProjectedSource(merged.source, preferred).trimEnd(),
    ].filter(Boolean).join("\n"));
  }

  const restored = extracted.candidate.manifest
    .split("\n")
    .flatMap((line) => {
      if (!line.startsWith(`${BLOCK_MARKER} `)) return [line];
      const key = line.slice(BLOCK_MARKER.length + 1);
      if (!mergedBlocks.has(key)) throw new Error(`Merged block is missing: ${key}`);
      return mergedBlocks.get(key).split("\n");
    })
    .join("\n");
  return {
    conflict: false,
    source: canonicalizeLiftosaurSource(restored),
    extracted,
    stage: "merged",
  };
}

export async function mergeLiftosaurSources({ base, active, candidate }) {
  const initialBlocks = {
    base: parseLiftosaurMergeDocument(base),
    active: parseLiftosaurMergeDocument(active),
    candidate: parseLiftosaurMergeDocument(candidate),
  };
  assertLiveProgramLogicUnchanged(base, active);
  const blockOrderChanged = initialBlocks.active.order !== initialBlocks.base.order
    || initialBlocks.candidate.order !== initialBlocks.base.order;
  const projected = {
    base: projectLiftosaurSource(base),
    active: projectLiftosaurSource(active),
    candidate: projectLiftosaurSource(candidate),
  };
  const directory = await mkdtemp(path.join(tmpdir(), "liftosaur-merge."));
  try {
    let merged = blockOrderChanged
      ? await mergeRelocatedBlocks({ base, active, candidate }, directory)
      : await gitMergeSources({
        base: projected.base.source,
        active: projected.active.source,
        candidate: projected.candidate.source,
      }, directory, "source");
    let blockFallback = null;
    if (blockOrderChanged || merged.conflict) {
      if (!blockOrderChanged) {
        merged = await mergeRelocatedBlocks({ base, active, candidate }, directory);
      }
      blockFallback = {
        used: true,
        base: merged.extracted.base.blocks.size,
        active: merged.extracted.active.blocks.size,
        candidate: merged.extracted.candidate.blocks.size,
        stage: merged.stage,
        ...(merged.blockKey ? { blockKey: merged.blockKey } : {}),
      };
    }
    const report = {
      strategy: "git-three-way-with-liftosaur-projection",
      frontend: LIFTOSAUR_MERGE_FRONTEND,
      status: merged.conflict ? "conflict" : "merged",
      projectedStateBlocks: {
        base: projected.base.stateBlockCount,
        active: projected.active.stateBlockCount,
        candidate: projected.candidate.stateBlockCount,
      },
      projectedStatements: {
        base: projected.base.statementCount,
        active: projected.active.statementCount,
        candidate: projected.candidate.statementCount,
      },
      blockFallback,
    };
    if (merged.conflict) {
      return { source: null, conflictSource: merged.source, report };
    }
    return {
      source: blockFallback
        ? merged.source
        : restoreProjectedSource(merged.source, projected.candidate.stateOrders),
      conflictSource: null,
      report,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
