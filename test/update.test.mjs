import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

test("update remains the everyday configured command", async () => {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Everyday update:[\s\S]*liftosaur-ci update/);
  assert.match(help.stdout, /--base-ref <bootstrap-ref>/);
});
