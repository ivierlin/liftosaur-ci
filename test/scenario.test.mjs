import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const scenarios = JSON.parse(await readFile(
  path.join(testDirectory, "fixtures", "basic-beginner-scenarios.json"),
  "utf8"
));
const expected = JSON.parse(await readFile(
  path.join(testDirectory, "fixtures", "basic-beginner.expected.json"),
  "utf8"
));

function projectEntry(entry) {
  const displayWeight = (weight) => (
    weight ? `${weight.value}${weight.unit}` : null
  );
  return {
    fullName: entry.fullName,
    progressState: entry.progressState,
    reps: entry.sets.map((set) => set.reps),
    originalWeights: entry.sets.map((set) => displayWeight(set.originalWeight)),
    weights: entry.sets.map((set) => displayWeight(set.weight)),
    amrap: entry.sets.map((set) => !!set.isAmrap),
  };
}

function projectRecord(record) {
  return {
    day: record.day,
    dayName: record.dayName,
    entries: record.entries.map(projectEntry),
  };
}

test("reviewed Basic Beginner scenarios snapshot distinct outcomes", () => {
  const snapshots = scenarios.map((scenario) => (
    snapshotLiftosaurScenario(source, scenario).snapshot
  ));
  const actual = {
    scenarios: snapshots.map((snapshot) => ({
      name: snapshot.scenario.name,
      nextExposure: projectRecord(snapshot.nextExposure),
    })),
    nextWorkout: projectRecord(snapshots[0].nextWorkout),
  };

  assert.deepEqual(actual, expected);
  for (const snapshot of snapshots.slice(1)) {
    assert.deepEqual(projectRecord(snapshot.nextWorkout), expected.nextWorkout);
  }
});

test("reviewed scenarios require explicit inputs for every workout entry", () => {
  assert.throws(
    () => snapshotLiftosaurScenario(source, {
      formatVersion: 1,
      name: "incomplete",
      day: 1,
      entries: [{
        exercise: "Bench Press",
        sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }],
      }],
    }),
    /Scenario is missing exercise: Bent Over Row #1/
  );
});
