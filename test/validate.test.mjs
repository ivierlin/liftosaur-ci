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
  assert.deepEqual(result.summary, { days: 2, exercises: 2, sets: 5 });
  assert.equal(result.validator.implementation, "liftosaur-native-v1");
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
