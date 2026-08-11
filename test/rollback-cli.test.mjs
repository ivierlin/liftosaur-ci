import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(path.dirname(testDirectory), "bin", "liftosaur-ci.mjs");

test("CLI exposes explicit rollback recovery", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: {} });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /liftosaur-ci rollback/);
  assert.match(help.stdout, /--recovery <retained-recovery-directory>/);

  const missing = spawnSync(process.execPath, [cli, "rollback"], { encoding: "utf8", env: {} });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required option: --recovery/);
});
