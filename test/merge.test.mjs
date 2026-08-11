import assert from "node:assert/strict";
import test from "node:test";

import {
  LIFTOSAUR_MERGE_FRONTEND,
  mergeLiftosaurSources,
  projectLiftosaurSource,
  restoreProjectedSource,
} from "../src/merge.mjs";

const source = ({ timer = 120, volume = 3, phase = 1, extraState = "" } = {}) => `# Week 1
## Day A
Squat / 3x5 100kg / timer: ${timer} / progress: custom(volume: ${volume}, phase: ${phase}${extraState}) {~ state.volume = state.volume ~}
`;

function blockSource({
  definitionValue = 2,
  definitionFirst = true,
  exerciseName = "Squat",
  description = "// ...shared",
  volume = 2,
  prescription = "",
  bench = false,
  benchVolume = 2,
  benchPrescription = "",
} = {}) {
  const definition = `// Shared documentation
shared / 1x1 / update: custom() {~
  var.limit = ${definitionValue}
~}`;
  const exercise = `${description}
${exerciseName} / ...shared / ${prescription ? `${prescription} / ` : ""}progress: custom(volume: ${volume}) { ...shared }`;
  const benchExercise = `// ...shared
Bench / ...shared / ${benchPrescription ? `${benchPrescription} / ` : ""}progress: custom(volume: ${benchVolume}) { ...shared }`;
  const exercises = [exercise, ...(bench ? [benchExercise] : [])].join("\n");
  return `# Week 1
## Day A
${definitionFirst ? `${definition}\n${exercises}` : `${exercises}\n${definition}`}
`;
}

test("projects and restores custom state without program-specific rules", () => {
  const original = source();
  const projected = projectLiftosaurSource(original);

  assert.equal(projected.stateBlockCount, 1);
  assert.match(projected.source, /__LIFTOSAUR_CI_STATE__ phase\n__LIFTOSAUR_CI_STATE_VALUE__ 1/);
  assert.match(projected.source, /__LIFTOSAUR_CI_STATE__ volume\n__LIFTOSAUR_CI_STATE_VALUE__ 3/);
  assert.equal(
    restoreProjectedSource(projected.source, projected.stateOrders),
    `${original.trimEnd()}\n\n\n`
  );
});

test("lets Git combine active state with candidate program changes on the same exercise", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ volume: 4 }),
    candidate: source({ timer: 180 }),
  });

  assert.equal(result.report.status, "merged");
  assert.deepEqual(result.report.frontend, LIFTOSAUR_MERGE_FRONTEND);
  assert.match(result.source, /timer: 180/);
  assert.match(result.source, /progress: custom\(volume: 4, phase: 1\)/);
});

test("merges independent state variables without classifying configuration and runtime state", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ volume: 4 }),
    candidate: source({ phase: 2 }),
  });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /progress: custom\(volume: 4, phase: 2\)/);
});

test("merges an additive candidate state field with active progression", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ volume: 4 }),
    candidate: source({ extraState: ", momentum: 0" }),
  });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /progress: custom\(volume: 4, phase: 1, momentum: 0\)/);
});

test("removes a candidate-deleted state field while preserving independent progression", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ volume: 4 }),
    candidate: source().replace(", phase: 1", ""),
  });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /progress: custom\(volume: 4\)/);
  assert.doesNotMatch(result.source, /phase:/);
});

test("fails closed when the candidate removes an actively changed state field", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ phase: 2 }),
    candidate: source().replace(", phase: 1", ""),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.match(result.conflictSource, /__LIFTOSAUR_CI_STATE_VALUE__ 2/);
});

test("fails closed when active and candidate change the same state variable differently", async () => {
  const result = await mergeLiftosaurSources({
    base: source(),
    active: source({ volume: 4 }),
    candidate: source({ volume: 5 }),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.match(result.conflictSource, /<<<<<<< active/);
  assert.match(result.conflictSource, /__LIFTOSAUR_CI_STATE_VALUE__ 4/);
  assert.match(result.conflictSource, /__LIFTOSAUR_CI_STATE_VALUE__ 5/);
});

test("merges a historical active prescription with a candidate warmup on the same statement", async () => {
  const base = `# Week 1
## Row Day
Triceps Extension / ...shared / id: tags(0) / warmup: none / progress: custom(target: 20, systemicSensitivity: 0) { ...shared }
`;
  const active = `# Week 1
## Row Day
Triceps Extension / ...shared / 1x13+ / 4kg @7+ / id: tags(0) / warmup: none / progress: custom(target: 20, systemicSensitivity: 0, volume: 2) { ...shared }
`;
  const candidate = `# Week 1
## Row Day
Triceps Extension / ...shared / id: tags(0) / warmup: 1x10 50% / progress: custom(target: 20, systemicSensitivity: 0) { ...shared }
`;

  const result = await mergeLiftosaurSources({ base, active, candidate });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /1x13\+ \/ 4kg @7\+/);
  assert.match(result.source, /warmup: 1x10 50%/);
  assert.match(result.source, /volume: 2/);
});

test("merges a relocated shared definition through keyed placeholders", async () => {
  const base = `# Week 1
## Day A
// Shared documentation
shared / 1x1 / update: custom() {~
  var.limit = 2
~}
// ...shared
Squat / ...shared / progress: custom(volume: 2) { ...shared }
// ...shared
Bench / ...shared / progress: custom(volume: 2) { ...shared }
`;
  const active = `# Week 1
## Day A
// Shared documentation
shared / 1x1 / update: custom() {~
  var.limit = 2
~}
// Shared documentation
Squat / ...shared / 1x5 / 100kg / progress: custom(volume: 3) { ...shared }
// Shared documentation
Bench / ...shared / 1x5 / 80kg / progress: custom(volume: 3) { ...shared }
`;
  const candidate = `# Week 1
## Day A
// ...shared
Squat / ...shared / progress: custom(volume: 2) { ...shared }
// ...shared
Bench / ...shared / progress: custom(volume: 2) { ...shared }
// Shared documentation
shared / 1x1 / update: custom() {~
  var.limit = 3
~}
`;

  const result = await mergeLiftosaurSources({ base, active, candidate });

  assert.equal(result.report.status, "merged");
  assert.equal(result.report.blockFallback.used, true);
  assert.match(result.source, /1x5 \/ 100kg/);
  assert.match(result.source, /volume: 3/);
  assert.match(result.source, /var\.limit = 3/);
  assert.ok(result.source.indexOf("Squat") < result.source.indexOf("\nshared /"));
});

test("merges candidate block additions with independent active state", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource(),
    active: blockSource({ volume: 3, prescription: "1x5 / 100kg" }),
    candidate: blockSource({ bench: true }),
  });

  assert.equal(result.report.status, "merged");
  assert.equal(result.report.blockFallback.used, true);
  assert.match(result.source, /Squat \/ \.\.\.shared \/ 1x5 \/ 100kg/);
  assert.match(result.source, /Bench \/ \.\.\.shared/);
});

test("removes an unchanged candidate-deleted block", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource({ bench: true }),
    active: blockSource({ bench: true, volume: 3 }),
    candidate: blockSource(),
  });

  assert.equal(result.report.status, "merged");
  assert.match(result.source, /volume: 3/);
  assert.doesNotMatch(result.source, /Bench/);
});

test("fails closed when the candidate removes an actively changed block", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource({ bench: true }),
    active: blockSource({ bench: true, benchVolume: 3, benchPrescription: "1x5 / 80kg" }),
    candidate: blockSource(),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback.stage, "block-removal");
});

test("fails closed on a renamed actively changed block", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource(),
    active: blockSource({ volume: 3, prescription: "1x5 / 100kg" }),
    candidate: blockSource({ exerciseName: "Front Squat" }),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback.stage, "block-removal");
});

test("supports repeated exercise statements by occurrence", async () => {
  const duplicate = `${blockSource()}// ...shared
Squat / ...shared / progress: custom(volume: 2) { ...shared }
`;

  const result = await mergeLiftosaurSources({
    base: duplicate,
    active: duplicate,
    candidate: duplicate,
  });

  assert.equal(result.report.status, "merged");
  assert.equal((result.source.match(/^Squat \/ /gm) ?? []).length, 2);
});

test("fails closed when active and candidate change a description differently", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource(),
    active: blockSource({ description: "// Active description" }),
    candidate: blockSource({ description: "// Candidate description" }),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback.stage, "block-prefix");
});

test("fails closed when only active moves a block", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource(),
    active: blockSource({ definitionFirst: false }),
    candidate: blockSource({ definitionValue: 3 }),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback.stage, "candidate-layout");
});

test("fails closed on conflicting multiline definition edits", async () => {
  const result = await mergeLiftosaurSources({
    base: blockSource(),
    active: blockSource({ definitionValue: 3 }),
    candidate: blockSource({ definitionValue: 4 }),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback.stage, "block-content");
});
