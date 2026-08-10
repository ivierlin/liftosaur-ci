import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseLiftosaurMergeDocument } from "../src/frontend.mjs";
import { mergeLiftosaurSources } from "../src/merge.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);
const builtinDirectory = path.join(runtime, "programs", "builtin");

function extractLiftoscript(markdown, filename) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(matches.length, 1, `${filename} must contain exactly one Liftoscript block`);
  return `${matches[0][1]}\n`;
}

function incrementStateValue(value) {
  const match = /^(-?[0-9]+(?:\.[0-9]+)?)(lb|kg|%)?$/.exec(value);
  if (!match) return undefined;
  return `${Number(match[1]) + 1}${match[2] ?? ""}`;
}

function firstMutableCustomState(source) {
  for (const match of source.matchAll(/progress:\s*custom\(([^)\n]*)\)/g)) {
    const first = /^\s*([A-Za-z][A-Za-z0-9_]*):\s*([^,\s)]+)/.exec(match[1]);
    if (!first) continue;
    const next = incrementStateValue(first[2]);
    if (next === undefined) continue;
    const valueStart = match.index + match[0].indexOf(first[2]);
    return {
      key: first[1],
      value: first[2],
      next,
      start: valueStart,
      end: valueStart + first[2].length,
      argumentsEnd: match.index + match[0].lastIndexOf(")"),
    };
  }
  return undefined;
}

function replaceRange(source, start, end, replacement) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .sort();
assert.ok(filenames.length > 0, "Pinned Liftosaur runtime has no built-in programs");

const programs = await Promise.all(filenames.map(async (filename) => ({
  filename,
  source: extractLiftoscript(
    await readFile(path.join(builtinDirectory, filename), "utf8"),
    filename
  ),
})));

for (const { filename, source } of programs) {
  test(`built-in corpus processes unchanged source: ${filename}`, async () => {
    const document = parseLiftosaurMergeDocument(source);
    assert.ok(document.manifest.length > 0);
    const result = await mergeLiftosaurSources({ base: source, active: source, candidate: source });
    assert.equal(result.report.status, "merged");
    assert.ok(result.source);
  });

  const state = firstMutableCustomState(source);
  if (!state) continue;

  test(`built-in corpus merges fake progression: ${filename}`, async () => {
    const active = replaceRange(source, state.start, state.end, state.next);
    const candidate = replaceRange(source, state.argumentsEnd, state.argumentsEnd, ", ciProbe: 0");
    const result = await mergeLiftosaurSources({ base: source, active, candidate });

    assert.equal(result.report.status, "merged");
    assert.match(result.source, new RegExp(`${state.key}: ${state.next.replace(".", "\\.")}`));
    assert.match(result.source, /ciProbe: 0/);
  });

  test(`built-in corpus rejects conflicting fake progression: ${filename}`, async () => {
    const active = replaceRange(source, state.start, state.end, state.next);
    const candidateValue = incrementStateValue(state.next);
    const candidate = replaceRange(source, state.start, state.end, candidateValue);
    const result = await mergeLiftosaurSources({ base: source, active, candidate });

    assert.equal(result.source, null);
    assert.equal(result.report.status, "conflict");
  });
}
