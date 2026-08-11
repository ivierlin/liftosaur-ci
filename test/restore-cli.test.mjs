import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(path.dirname(testDirectory), "bin", "liftosaur-ci.mjs");

test("CLI exposes advanced historical restore", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: {} });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /liftosaur-ci restore/);
  assert.match(help.stdout, /--artifact <historical-deployment-bundle>/);

  const commandHelp = spawnSync(process.execPath, [cli, "restore", "--help"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /intentionally rewinds live progression/);

  const missing = spawnSync(process.execPath, [cli, "restore"], { encoding: "utf8", env: {} });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing required option: --artifact/);
});
