import assert from "node:assert/strict";
import {
  assertCanonicalLiftosaurSource,
  canonicalizeLiftosaurSource,
} from "../src/source-format.mjs";

assert.equal(canonicalizeLiftosaurSource("# Week\r\n\r\n"), "# Week\n\n\n");
assert.equal(canonicalizeLiftosaurSource("# Week"), "# Week\n\n\n");
assert.doesNotThrow(() => assertCanonicalLiftosaurSource("# Week\n\n\n"));
assert.throws(
  () => assertCanonicalLiftosaurSource("# Week\n"),
  /exactly 3 LF characters; found 1/
);
assert.throws(
  () => assertCanonicalLiftosaurSource("# Week\n\n\n\n"),
  /exactly 3 LF characters; found 4/
);
assert.throws(
  () => assertCanonicalLiftosaurSource("# Week\r\n\r\n\r\n"),
  /must use LF line endings/
);

console.log("Liftosaur source-format tests passed.");
