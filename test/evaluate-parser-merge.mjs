import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mergeLiftosaurSources,
  mergeLiftosaurSourcesThroughProjectionForTesting,
} from "../src/merge.mjs";
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

function independentEvidence(base, active, candidate, merged) {
  const maps = Object.fromEntries(Object.entries({ base, active, candidate, merged })
    .map(([name, source]) => [name, projectedAtoms(source)]));
  const keys = new Set([...maps.base.keys(), ...maps.active.keys(), ...maps.candidate.keys()]);
  const candidateOnly = [];
  const activeOnly = [];
  for (const key of keys) {
    const values = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, map.get(key)]));
    if (values.candidate !== values.base && values.active === values.base) {
      candidateOnly.push(values.merged === values.candidate);
    }
    if (values.active !== values.base && values.candidate === values.base) {
      activeOnly.push(values.merged === values.active);
    }
  }
  return {
    candidateAtomsExpected: candidateOnly.length,
    candidateIntentSurvived: candidateOnly.length > 0 && candidateOnly.every(Boolean),
    activeAtomsExpected: activeOnly.length,
    activeProgressionSurvived: activeOnly.length > 0 && activeOnly.every(Boolean),
  };
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

const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .sort();
const results = [];
const inventory = new Map();

for (const filename of filenames) {
  const base = extractLiftoscript(await readFile(path.join(builtinDirectory, filename), "utf8"), filename);
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
        for (const [key, value] of projectedAtoms(active)) {
          if (baseAtoms.get(key) === value) continue;
          const kind = inventoryClass(key);
          inventory.set(kind, (inventory.get(kind) ?? 0) + 1);
        }
      }
      const merged = await mergeLiftosaurSourcesThroughProjectionForTesting({
        base, active, candidate: base,
      });
      roundTrip[exposure] = merged.report.status === "merged"
        && merged.report.projectedStatements.active > 0
        && canonicalizeLiftosaurSource(merged.source) === canonicalizeLiftosaurSource(active);
      if (!roundTrip[exposure]) {
        roundTrip[`${exposure}Status`] = merged.report.status;
        roundTrip[`${exposure}Stage`] = merged.report.blockFallback?.stage;
      }
    }
  } catch (error) {
    failure = { stage: error?.stage ?? "experiment", message: error instanceof Error ? error.message : String(error) };
  }
  results.push({ filename, roundTrip, ...(failure ? { failure } : {}) });
}

const matrixBase = extractLiftoscript(
  await readFile(path.join(builtinDirectory, "ss1.md"), "utf8"), "ss1.md"
);
const matrixActive = progressNominalLiftosaurSourceForTesting(matrixBase, 1).serializedSource;
const matrixCases = [
  { mutation: "add exercise", candidate: matrixBase.replace("## Workout B", "Barbell Row / 3x8\n## Workout B") },
  {
    mutation: "remove unchanged exercise",
    candidate: matrixBase.replace("Overhead Press / 3x5 / 45lb / progress: lp(5lb, 1, 0, 10%, 2, 0)\n", ""),
    candidateCheck: (source) => !source.includes("Overhead Press"),
  },
  { mutation: "change set/rep scheme beside progression", candidate: matrixBase.replace("Squat / 3x5", "Squat / 4x5") },
  { mutation: "change progression logic beside state", candidate: matrixBase.replace("progress: lp(5lb", "progress: lp(10lb") },
  { mutation: "add unrelated exercise property", candidate: matrixBase.replace("Squat / 3x5 / 45lb", "Squat / 3x5 / 45lb / timer: 120") },
  { mutation: "change unrelated day", candidate: matrixBase.replace("Overhead Press / 3x5", "Overhead Press / 4x5") },
];
const matrix = [];
for (const { mutation, candidate, candidateCheck } of matrixCases) {
  const merged = await mergeLiftosaurSources({ base: matrixBase, active: matrixActive, candidate });
  const evidence = merged.report.status === "merged"
    ? independentEvidence(matrixBase, matrixActive, candidate, merged.source)
    : null;
  if (evidence && candidateCheck) {
    evidence.candidateAtomsExpected = 1;
    evidence.candidateIntentSurvived = candidateCheck(merged.source);
  }
  const correct = evidence?.candidateIntentSurvived && evidence?.activeProgressionSurvived;
  matrix.push({
    mutation,
    outcome: correct ? "CLEAN MERGE"
      : merged.report.status === "conflict" ? "SPURIOUS CONFLICT" : "WRONG MERGE",
    ...(evidence ? { evidence } : {}),
  });
}
matrix.push({ mutation: "change reusable definition", outcome: "UNSUPPORTED" });

const conflictBase = "# Week 1\n## Day A\nSquat / 3x5 / 45lb / timer: 120 / progress: lp(5lb)\n";
const conflictCases = [
  ["same reps", "3x6", "3x8", "3x5"],
  ["same weight", "50lb", "55lb", "45lb"],
  ["same property argument", "timer: 150", "timer: 180", "timer: 120"],
  ["same function argument", "lp(10lb)", "lp(15lb)", "lp(5lb)"],
];
const deliberateConflicts = [];
for (const [mutation, activeValue, candidateValue, baseValue] of conflictCases) {
  const merged = await mergeLiftosaurSources({
    base: conflictBase,
    active: conflictBase.replace(baseValue, activeValue),
    candidate: conflictBase.replace(baseValue, candidateValue),
  });
  deliberateConflicts.push({ mutation, outcome: merged.report.status === "conflict" ? "EXPECTED CONFLICT" : "WRONG MERGE" });
}

const codeSource = "# Week 1\n## Day A\nSquat / 3x5 / progress: custom() {~ state.x = 1 ~}\n";
const codeSafetyCases = [
  ["delete body", codeSource.replace(" / progress: custom() {~ state.x = 1 ~}", "")],
  ["add body", `${codeSource}Bench Press / 3x5 / progress: custom() {~ state.y = 1 ~}\n`],
  ["modify body", codeSource.replace("state.x = 1", "state.x = 2")],
  ["change multiplicity", codeSource.replace("{~ state.x = 1 ~}", "{~ state.x = 1 ~} / update: custom() {~ state.x = 1 ~}")],
];
const liveCodeSafety = [];
for (const [mutation, active] of codeSafetyCases) {
  try {
    await mergeLiftosaurSources({ base: codeSource, active, candidate: codeSource });
    liveCodeSafety.push({ mutation, outcome: "WRONG MERGE" });
  } catch (error) {
    liveCodeSafety.push({ mutation, outcome: /Git-managed/.test(String(error)) ? "EXPECTED CONFLICT" : "UNSUPPORTED", message: String(error) });
  }
}

const lifecycleFailure = results.find(({ filename }) => filename === "gzcl-ggbb.md");
const executableResults = results.filter(({ filename }) => filename !== "gzcl-ggbb.md");
const summary = Object.fromEntries(depths.map((depth) => [depth, {
  executable: executableResults.length,
  passed: executableResults.filter((result) => result.roundTrip[depth] === true).length,
  failed: executableResults.filter((result) => result.roundTrip[depth] !== true).length,
}]));

process.stdout.write(`${JSON.stringify({
  corpus: filenames.length,
  depths,
  summary,
  lifecycleFailure,
  matrix,
  deliberateConflicts,
  liveCodeSafety,
  progressionInventory: Object.fromEntries([...inventory.entries()].sort()),
  failures: executableResults.filter((result) => result.failure || Object.values(result.roundTrip).includes(false)),
}, null, 2)}\n`);
