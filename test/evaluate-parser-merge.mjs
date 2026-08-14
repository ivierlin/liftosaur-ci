import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeLiftosaurSources } from "../src/merge.mjs";
import { projectLiftosaurSource } from "../src/frontend.mjs";
import { canonicalizeLiftosaurSource } from "../src/source-format.mjs";
import {
  progressNominalLiftosaurSourceForTesting,
  validateLiftosaurSource,
} from "../src/validate-core.mjs";

const depths = [1, 4, 8, 16];
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.resolve(process.env.LIFTOSAUR_RUNTIME
  ?? path.join(root, ".private", "liftosaur-runtime"));
const builtinDirectory = path.join(runtime, "programs", "builtin");

function extractLiftoscript(markdown, filename) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) throw new Error(`${filename}: expected one Liftoscript block`);
  return `${matches[0][1]}\n`;
}

const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .sort();
const results = [];
const inventory = new Map();

function projectedAtoms(source) {
  const atoms = new Map();
  let statement = "";
  const lines = projectLiftosaurSource(source).source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith("__LIFTOSAUR_CI_STATEMENT__ ")) statement = lines[index];
    if (!lines[index].startsWith("__LIFTOSAUR_CI_ATOM__ ")) continue;
    atoms.set(`${statement}\0${lines[index]}`, lines[index + 1]);
  }
  return atoms;
}

function inventoryClass(key) {
  if (key.includes("CurrentVariation")) return "current markers / variations";
  if (key.includes("Weight")) return "weights";
  if (key.includes("Percentage")) return "percentages";
  if (key.includes("Rpe")) return "RPE";
  if (key.includes("Timer")) return "timers";
  if (key.includes("SetPart") && key.includes("Rep")) return "sets / reps / min reps";
  if (key.includes("FunctionArgument")) return "progress / function arguments";
  if (key.includes("ReuseSection")) return "reuse representation";
  if (key.includes("ExerciseProperty")) return "properties";
  return "other parser fragments";
}

for (const filename of filenames) {
  const base = extractLiftoscript(
    await readFile(path.join(builtinDirectory, filename), "utf8"),
    filename
  );
  let active = base;
  let context;
  let day = 1;
  const roundTrip = {};
  let failure;
  try {
    const serializedBaseline = validateLiftosaurSource(base).serializedSource;
    for (let exposure = 1; exposure <= depths.at(-1); exposure += 1) {
      const progressed = progressNominalLiftosaurSourceForTesting(active, day, context);
      active = progressed.serializedSource;
      context = progressed.context;
      day = progressed.nextDay;
      if (!depths.includes(exposure)) continue;
      if (exposure === 1) {
        const baseAtoms = projectedAtoms(serializedBaseline);
        const activeAtoms = projectedAtoms(active);
        for (const [key, value] of activeAtoms) {
          if (baseAtoms.get(key) === value) continue;
          const kind = inventoryClass(key);
          inventory.set(kind, (inventory.get(kind) ?? 0) + 1);
        }
      }
      const merged = await mergeLiftosaurSources({ base, active, candidate: base });
      roundTrip[exposure] = merged.report.status === "merged"
        && canonicalizeLiftosaurSource(merged.source)
          === canonicalizeLiftosaurSource(active);
      if (!roundTrip[exposure]) {
        roundTrip[`${exposure}Status`] = merged.report.status;
        roundTrip[`${exposure}Stage`] = merged.report.blockFallback?.stage;
      }
    }
  } catch (error) {
    failure = {
      stage: error?.stage ?? "experiment",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  results.push({ filename, roundTrip, ...(failure ? { failure } : {}) });
}

const ss1Markdown = await readFile(path.join(builtinDirectory, "ss1.md"), "utf8");
const matrixBase = extractLiftoscript(ss1Markdown, "ss1.md");
const matrixActive = progressNominalLiftosaurSourceForTesting(matrixBase, 1).serializedSource;
const matrixCases = [
  {
    mutation: "add exercise",
    candidate: matrixBase.replace("## Workout B", "Barbell Row / 3x8\n## Workout B"),
    check: (source) => source.includes("Barbell Row / 3x8"),
  },
  {
    mutation: "remove unchanged exercise",
    candidate: matrixBase.replace("Squat / 3x5 / 45lb\n", ""),
    check: (source) => !source.includes("Squat / 3x5 / 45lb\n"),
  },
  {
    mutation: "change set/rep scheme beside progression",
    candidate: matrixBase.replace("Squat / 3x5", "Squat / 4x5"),
    check: (source) => source.includes("Squat / 4x5"),
  },
  {
    mutation: "change progression logic beside state",
    candidate: matrixBase.replace("progress: lp(5lb", "progress: lp(10lb"),
    check: (source) => source.includes("progress: lp(10lb"),
  },
  {
    mutation: "add unrelated exercise property",
    candidate: matrixBase.replace("Squat / 3x5 / 45lb", "Squat / 3x5 / 45lb / timer: 120"),
    check: (source) => source.includes("timer: 120"),
  },
  {
    mutation: "change unrelated day",
    candidate: matrixBase.replace("## Workout B\nSquat / 3x5", "## Workout B\nSquat / 4x5"),
    check: (source) => source.includes("## Workout B\nSquat / 4x5"),
  },
];
const matrix = [];
for (const item of matrixCases) {
  const merged = await mergeLiftosaurSources({
    base: matrixBase,
    active: matrixActive,
    candidate: item.candidate,
  });
  const correct = merged.report.status === "merged" && item.check(merged.source);
  matrix.push({
    mutation: item.mutation,
    outcome: correct ? "CLEAN MERGE"
      : merged.report.status === "conflict" ? "SPURIOUS CONFLICT" : "WRONG MERGE",
  });
}
matrix.push({ mutation: "change reusable definition", outcome: "UNSUPPORTED TEST" });

const summary = Object.fromEntries(depths.map((depth) => [depth, {
  executable: filenames.length - 1,
  passed: results.filter((result) => result.roundTrip[depth] === true).length,
  failed: filenames.length - 1
    - results.filter((result) => result.roundTrip[depth] === true).length,
} ]));

process.stdout.write(`${JSON.stringify({
  corpus: filenames.length,
  depths,
  summary,
  matrix,
  progressionInventory: Object.fromEntries([...inventory.entries()].sort()),
  failures: results.filter((result) => result.failure
    || Object.values(result.roundTrip).includes(false)),
}, null, 2)}\n`);
