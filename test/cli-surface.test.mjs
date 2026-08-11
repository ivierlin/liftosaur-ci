import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "./helpers/run-cli.mjs";

test("help separates everyday, composable, recovery, and offline surfaces", async () => {
  const result = await runCli(["--help"], {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Everyday update:/);
  assert.match(result.stdout, /Composable deployment:/);
  assert.match(result.stdout, /Recovery:/);
  assert.match(result.stdout, /Advanced\/offline building blocks:/);
  assert.match(result.stdout, /Configured commands default to liftosaur-ci\.json/);
});

test("prepare-git requires explicit program inputs as a pair", async () => {
  const result = await runCli([
    "prepare-git",
    "--program", "programs/example.liftoscript",
    "--output", "bundle",
  ], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--program and --program-id must be used together/);
});

test("configured and explicit prepare-git modes cannot be mixed", async () => {
  const result = await runCli([
    "prepare-git",
    "--config", "liftosaur-ci.json",
    "--program", "programs/example.liftoscript",
    "--program-id", "current",
    "--output", "bundle",
  ], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be combined with --config or --deployment/);
});

test("configured and explicit deploy modes cannot be mixed", async () => {
  const result = await runCli([
    "deploy",
    "--bundle", "bundle",
    "--config", "liftosaur-ci.json",
    "--confirm-program-id", "abc123",
    "--output", "record",
  ], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be combined with --config or --deployment/);
});

test("update presents first-run bootstrap as an everyday action", async () => {
  const result = await runCli(["update"], {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /first tracked update/i);
  assert.match(result.stderr, /--base-ref <deployed-ref>/);
  assert.doesNotMatch(result.stderr, /deployment report|program blob|resolved program ID/i);
});
