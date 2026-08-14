// Exploratory evaluator for docs/builtin-base-detection-evaluation.md.
// This is test-only evidence, not production detection behavior.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLiftosaurRuntime, pinnedRuntimeRevision } from "../src/runtime.mjs";
import {
  progressNominalLiftosaurSourceForTesting,
  validateLiftosaurSource,
} from "../src/validate-core.mjs";

const depths = [1, 4, 8, 16];
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const runtime = loadLiftosaurRuntime();
const runtimeRoot = runtime.root;
const builtinDirectory = path.join(runtimeRoot, "programs", "builtin");
const { PlannerProgram_evaluateFull } = runtime.require(
  "src/pages/planner/models/plannerProgram.ts"
);
const { Settings_build } = runtime.require("src/models/settings.ts");

function extractLiftoscript(markdown, filename) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) {
    throw new Error(`${filename} must contain exactly one Liftoscript block`);
  }
  return `${matches[0][1]}\n`;
}

function script(value) {
  return value?.replace(/\r\n/g, "\n").trim() || undefined;
}

function logic(value) {
  if (!value) return undefined;
  return {
    type: value.type,
    ...(script(value.script) ? { script: script(value.script) } : {}),
  };
}

function exerciseRecord(exercise) {
  return {
    name: exercise.name,
    equipment: exercise.equipment,
    label: exercise.label,
    exerciseVariations: exercise.exerciseVariations.map((variation) => ({
      name: variation.name,
      equipment: variation.exerciseType?.equipment,
    })),
    tags: exercise.tags,
    superset: exercise.superset?.name,
    notused: exercise.notused || undefined,
    progress: logic(exercise.progress),
    update: logic(exercise.update),
  };
}

function structuralFingerprint(source) {
  const evaluated = PlannerProgram_evaluateFull(source, Settings_build());
  if (!evaluated.evaluatedWeeks.success) {
    throw new Error(
      `Liftosaur structural evaluation failed: ${evaluated.evaluatedWeeks.error}`
    );
  }
  const records = evaluated.evaluatedWeeks.data.map((week) => ({
    name: week.name,
    days: week.days.map((day) => ({
      name: day.name,
      exercises: day.exercises.map(exerciseRecord),
    })),
  }));
  const canonical = JSON.stringify(records);
  return {
    canonical,
    records,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

function firstDifference(left, right, trail = []) {
  if (Object.is(left, right)) return undefined;
  if (typeof left !== "object" || left == null || typeof right !== "object" || right == null) {
    return { path: trail.join("."), original: left, observed: right };
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const difference = firstDifference(left[key], right[key], [...trail, key]);
    if (difference) return difference;
  }
  return undefined;
}

function collisions(items) {
  const byFingerprint = new Map();
  for (const item of items) {
    const group = byFingerprint.get(item.sha256) ?? [];
    group.push(item);
    byFingerprint.set(item.sha256, group);
  }
  return [...byFingerprint.values()].filter((group) => group.length > 1);
}

const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .sort();
const results = [];
const currentFingerprints = [];

for (const filename of filenames) {
  const originalSource = extractLiftoscript(
    await readFile(path.join(builtinDirectory, filename), "utf8"),
    filename
  );
  const original = structuralFingerprint(originalSource);
  currentFingerprints.push({ filename, sha256: original.sha256 });
  const matches = {};
  let pristineSerializationMatches;
  let pristineFirstDifference;
  let progressedFirstDifference;
  let source = originalSource;
  let context;
  let day = 1;
  let failure;
  try {
    const validation = validateLiftosaurSource(originalSource);
    const pristine = structuralFingerprint(validation.serializedSource);
    pristineSerializationMatches = pristine.canonical === original.canonical;
    if (!pristineSerializationMatches) {
      pristineFirstDifference = firstDifference(original.records, pristine.records);
    }
    for (let exposure = 1; exposure <= depths.at(-1); exposure += 1) {
      const progressed = progressNominalLiftosaurSourceForTesting(source, day, context);
      source = progressed.serializedSource;
      context = progressed.context;
      day = progressed.nextDay;
      if (depths.includes(exposure)) {
        const progressedFingerprint = structuralFingerprint(source);
        matches[exposure] = progressedFingerprint.canonical === original.canonical;
        if (!matches[exposure] && !progressedFirstDifference) {
          progressedFirstDifference = firstDifference(
            original.records,
            progressedFingerprint.records
          );
        }
      }
    }
  } catch (error) {
    failure = {
      stage: error?.stage ?? "structural-evaluation",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  results.push({
    filename,
    pristineSerializationMatches,
    pristineFirstDifference,
    matches,
    progressedFirstDifference,
    ...(failure ? { failure } : {}),
  });
}

const historyPaths = execFileSync(
  "git",
  [
    "-c", `safe.directory=${runtimeRoot}`, "-C", runtimeRoot,
    "log", "--format=", "--name-only", "--", "programs/builtin",
  ],
  { encoding: "utf8" }
).split(/\r?\n/).filter((value) => value.endsWith(".md"));
const historyFiles = [...new Set(historyPaths)].sort();
const historyItems = [];
let historicalBodies = 0;
let historicalParseFailures = 0;
for (const filename of historyFiles) {
  const revisions = execFileSync(
    "git",
    [
      "-c", `safe.directory=${runtimeRoot}`, "-C", runtimeRoot,
      "log", "--format=%H", "--", filename,
    ],
    { encoding: "utf8" }
  ).trim().split(/\r?\n/).filter(Boolean);
  const seen = new Set();
  for (const revision of revisions) {
    let markdown;
    try {
      markdown = execFileSync(
        "git",
        [
          "-c", `safe.directory=${runtimeRoot}`, "-C", runtimeRoot,
          "show", `${revision}:${filename}`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      continue;
    }
    historicalBodies += 1;
    let fingerprint;
    try {
      fingerprint = structuralFingerprint(extractLiftoscript(markdown, `${revision}:${filename}`));
    } catch {
      historicalParseFailures += 1;
      continue;
    }
    if (seen.has(fingerprint.sha256)) continue;
    seen.add(fingerprint.sha256);
    historyItems.push({ filename, revision, sha256: fingerprint.sha256 });
  }
}

const sensitivitySource = `# Week 1
## Day A
template / used: none / 3x5 / update: custom() {~
  weights += 5lb
~}
Squat / ...template / progress: custom() {~
  weights += 5lb
~} / superset: push
## Day B
Deadlift / 1x5 / progress: custom() {~
  weights += 5lb
~}
`;
const sensitivityEdits = {
  exerciseSubstitution: sensitivitySource.replace(
    "Squat / ...template",
    "Overhead Press / ...template"
  ),
  dayScheme: sensitivitySource.replace("## Day B", "## Day C"),
  progressLogic: sensitivitySource.replace(
    "weights += 5lb\n~} / superset",
    "weights += 10lb\n~} / superset"
  ),
  reusableDefinition: sensitivitySource.replace(
    "template / used: none / 3x5",
    "template / used: none / 4x5"
  ),
  authorProperty: sensitivitySource.replace("superset: push", "superset: pull"),
};
const sensitivityBaseline = structuralFingerprint(sensitivitySource).canonical;
const sensitivity = Object.fromEntries(Object.entries(sensitivityEdits).map(([name, edited]) => [
  name,
  structuralFingerprint(edited).canonical !== sensitivityBaseline,
]));

const summary = Object.fromEntries(depths.map((depth) => [depth, {
  executable: results.filter((result) => Object.hasOwn(result.matches, depth)).length,
  matched: results.filter((result) => result.matches[depth] === true).length,
  mismatched: results.filter((result) => result.matches[depth] === false).length,
}]));
process.stdout.write(`${JSON.stringify({
  runtimeRevision: pinnedRuntimeRevision,
  corpus: filenames.length,
  pristineSerialization: {
    executable: results.filter((result) => typeof result.pristineSerializationMatches === "boolean").length,
    matched: results.filter((result) => result.pristineSerializationMatches === true).length,
    mismatched: results.filter((result) => result.pristineSerializationMatches === false).length,
  },
  summary,
  currentCollisions: collisions(currentFingerprints),
  historical: {
    files: historyFiles.length,
    bodies: historicalBodies,
    parseFailures: historicalParseFailures,
    uniqueRevisions: historyItems.length,
    collisions: collisions(historyItems),
  },
  sensitivity,
  results,
}, null, 2)}\n`);
