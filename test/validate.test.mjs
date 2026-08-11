import assert from "node:assert/strict";
import test from "node:test";

import {
  LiftosaurValidationError,
  validateLiftosaurSource,
} from "../src/validate.mjs";

const validSource = `# Week 1
## Day A
Squat / 3x5 100kg / 120s

## Day B
Bench Press / 2x8 60kg / @8
`;

test("native validation constructs every day and preserves prescriptions", () => {
  const result = validateLiftosaurSource(validSource);
  assert.deepEqual(result.summary, {
    days: 2,
    exercises: 2,
    sets: 5,
    completedDays: 2,
    completedSets: 5,
  });
  assert.equal(
    result.validator.runtimeRevision,
    "f9c1b1453aaa22ab177d8e7473da08d707c28b60"
  );
  assert.match(result.serializedSource, /# Week 1/);
});

test("native validation reports Liftosaur evaluation errors", () => {
  assert.throws(
    () => validateLiftosaurSource(`# Week 1\n## Day A\nSquat / not-a-prescription\n`),
    (error) => {
      assert.ok(error instanceof LiftosaurValidationError);
      assert.ok(["parse", "evaluate"].includes(error.stage));
      return true;
    }
  );
});

test("native validation fails on a finish-script state error", () => {
  assert.throws(
    () => validateLiftosaurSource(`# Week 1
## Day A
base / used: none / 1x5 / progress: lp(5lb)
Squat / ...base / progress: none
`),
    (error) => {
      assert.ok(error instanceof LiftosaurValidationError);
      assert.equal(error.stage, "lifecycle-finish");
      assert.match(error.message, /successCounter/);
      return true;
    }
  );
});
