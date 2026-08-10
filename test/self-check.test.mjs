import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkRepository } from "../src/check.mjs";

test("repository configuration passes its own check", async () => {
  const report = await checkRepository(fileURLToPath(new URL("../liftosaur-ci.json", import.meta.url)));
  assert.equal(report.status, "passed", JSON.stringify(report, null, 2));
});
