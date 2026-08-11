#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBuiltinSnapshot } from "../src/report.mjs";
import { validateLiftosaurSource } from "../src/validate.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);
const builtinDirectory = path.join(runtime, "programs", "builtin");
const outputDirectory = path.join(repositoryRoot, "test", "fixtures", "builtin-snapshots");
const knownFailures = new Set(["gzcl-ggbb.md"]);

function extractLiftoscript(markdown, filename) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) throw new Error(`${filename} must contain exactly one Liftoscript block`);
  return `${matches[0][1]}\n`;
}

await mkdir(outputDirectory, { recursive: true });
const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md") && !knownFailures.has(filename))
  .sort();

for (const filename of filenames) {
  const markdown = await readFile(path.join(builtinDirectory, filename), "utf8");
  const source = extractLiftoscript(markdown, filename);
  const snapshot = createBuiltinSnapshot(source, validateLiftosaurSource(source));
  await writeFile(
    path.join(outputDirectory, `${filename}.expected.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8"
  );
}

console.log(`Updated ${filenames.length} reviewed built-in snapshots.`);
