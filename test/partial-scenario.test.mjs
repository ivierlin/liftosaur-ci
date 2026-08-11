import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createScenarioSnapshot } from "../src/report.mjs";
import { snapshotLiftosaurScenario } from "../src/validate.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);

function extractLiftoscript(markdown) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(matches.length, 1);
  return `${matches[0][1]}\n`;
}

const source = extractLiftoscript(await readFile(
  path.join(runtime, "programs", "builtin", "basicBeginner.md"),
  "utf8"
));

const partialScenario = {
  name: "after first bench set",
  day: 1,
  finish: false,
  entries: [{
    exercise: "Bench Press",
    sets: [{ reps: 5 }],
  }],
};

test("partial scenarios observe the current workout after exactly the supplied sets", () => {
  const result = snapshotLiftosaurScenario(source, partialScenario);

  assert.equal(result.serializedSource, null);
  assert.deepEqual(result.snapshot.scenario, {
    name: "after first bench set",
    day: 1,
    finish: false,
  });

  const bench = result.snapshot.currentWorkout.entries.find(
    (entry) => entry.fullName === "Bench Press"
  );
  const row = result.snapshot.currentWorkout.entries.find(
    (entry) => entry.fullName === "Bent Over Row"
  );
  assert.ok(bench);
  assert.ok(row);
  assert.equal(bench.sets[0].isCompleted, true);
  assert.equal(bench.sets[0].completedReps, 5);
  assert.ok(bench.sets.slice(1).every((set) => !set.isCompleted));
  assert.ok(row.sets.every((set) => !set.isCompleted));
  assert.equal(result.snapshot.nextExposure, undefined);
  assert.equal(result.snapshot.nextWorkout, undefined);
});

test("partial snapshot reports do not claim a progressed serialized source", () => {
  const scenarioText = `${JSON.stringify(partialScenario)}\n`;
  const report = createScenarioSnapshot(
    source,
    scenarioText,
    snapshotLiftosaurScenario(source, partialScenario)
  );
  assert.equal(report.progressedSource, undefined);
  assert.ok(report.currentWorkout);
});

test("partial scenarios may observe one entry without completing the rest of the workout", () => {
  assert.doesNotThrow(() => snapshotLiftosaurScenario(source, {
    name: "bench only",
    day: 1,
    finish: false,
    entries: [{
      exercise: "Bench Press",
      sets: [{ reps: 5 }],
    }],
  }));
});

test("partial observations cannot appear inside resumable scenario sequences", () => {
  assert.throws(
    () => snapshotLiftosaurScenario(source, {
      name: "unsupported resume",
      steps: [
        {
          name: "partial",
          day: 1,
          finish: false,
          entries: [{ exercise: "Bench Press", sets: [{ reps: 5 }] }],
        },
        {
          name: "later",
          day: 1,
          entries: [{ exercise: "Bench Press", sets: [{ reps: 5 }] }],
        },
      ],
    }),
    /Partial scenario observations are standalone/
  );
});
