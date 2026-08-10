import assert from "node:assert/strict";
import test from "node:test";

import {
  LIFTOSAUR_MERGE_FRONTEND,
  parseLiftosaurMergeDocument,
  projectLiftosaurSource,
  restoreProjectedSource,
} from "../src/frontend.mjs";

const source = `# Week 1
## Day A
// Shared definition
shared / 1x1 / update: custom() {~
  var.limit = 2
~}
// Selected description
Squat / ...shared / 3x5 / 100kg / timer: 120 / progress: custom(volume: 3, phase: 1) { ...shared }
`;

test("declares a stable versioned frontend contract", () => {
  assert.deepEqual(LIFTOSAUR_MERGE_FRONTEND, {
    formatVersion: 1,
    implementation: "liftosaur-parser-v1",
    runtimeRevision: "f9c1b1453aaa22ab177d8e7473da08d707c28b60",
  });
  assert.equal(Object.isFrozen(LIFTOSAUR_MERGE_FRONTEND), true);
});

test("extracts stable definition and statement blocks", () => {
  const document = parseLiftosaurMergeDocument(source);
  const keys = [...document.blocks.keys()];

  assert.equal(document.frontend, LIFTOSAUR_MERGE_FRONTEND);
  assert.deepEqual(keys, [
    JSON.stringify(["definition", "Week 1", "shared"]),
    JSON.stringify(["statement", "Week 1", "Day A", "Squat"]),
  ]);
  assert.match(document.order, /__LIFTOSAUR_CI_BLOCK__/);
  assert.equal(document.blocks.get(keys[1]).prefix, "// Selected description");
  assert.match(document.blocks.get(keys[0]).body, /^shared \/ 1x1 \/ update: custom/);
  assert.match(document.blocks.get(keys[1]).body, /^Squat \/ \.\.\.shared/);
});

test("uses parser nodes to identify multiline exercise statements", () => {
  const document = parseLiftosaurMergeDocument(`# Week 1
## Day A
Deadlift / 3x5 / 100kg \\
  / progress: custom(volume: 3) {~ state.volume = 3 ~}
`);

  assert.deepEqual([...document.blocks.keys()], [
    JSON.stringify(["statement", "Week 1", "Day A", "Deadlift"]),
  ]);
});

test("fails closed on parser syntax errors", () => {
  assert.throws(
    () => parseLiftosaurMergeDocument("# Week 1\n## Day A\nSquat / progress: custom(volume: )\n"),
    /Liftosaur parser rejected source/
  );
});

test("round-trips projected sections and state through the frontend", () => {
  const projected = projectLiftosaurSource(source);

  assert.equal(projected.frontend, LIFTOSAUR_MERGE_FRONTEND);
  assert.equal(projected.statementCount, 1);
  assert.equal(projected.stateBlockCount, 1);
  assert.equal(
    restoreProjectedSource(projected.source, projected.stateOrders),
    `${source.trimEnd()}\n\n\n`
  );
});

test("rejects reserved projection markers in source", () => {
  assert.throws(
    () => projectLiftosaurSource(`${source}__LIFTOSAUR_CI_BLOCK__ collision\n`),
    /reserved merge marker/
  );
});

test("round-trips prompted custom state keys", () => {
  const prompted = source.replace("volume: 3", "volume+: 3");
  const projected = projectLiftosaurSource(prompted);

  assert.match(projected.source, /__LIFTOSAUR_CI_STATE__ volume\+/);
  assert.match(restoreProjectedSource(projected.source, projected.stateOrders), /volume\+: 3/);
});
