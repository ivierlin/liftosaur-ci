import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkFile = new URL("../.github/workflows/reusable-check.yml", import.meta.url);
const deployFile = new URL("../.github/workflows/reusable-deploy.yml", import.meta.url);

test("reusable GitHub workflows retain the generic safety contract", async () => {
  const [check, deploy] = await Promise.all([
    readFile(checkFile, "utf8"),
    readFile(deployFile, "utf8"),
  ]);

  for (const workflow of [check, deploy]) {
    assert.match(workflow, /workflow_call:/);
    assert.match(workflow, /tool_ref:[\s\S]*?required: true/);
    assert.match(workflow, /fromJSON\(inputs\.runs_on\)/);
    assert.doesNotMatch(workflow, /ubuntu-latest|ROAR|WSL/);
    assert.doesNotMatch(workflow, /npm ci|cache: npm/);
  }

  assert.match(check, /permissions:\s+contents: read/);
  assert.match(check, /liftosaur-ci\.mjs" check/);

  assert.match(deploy, /needs: prepare/);
  assert.match(deploy, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(deploy, /contents: write\s+pull-requests: write/);
  assert.match(deploy, /liftosaur-ci\.mjs" deploy/);
  assert.match(deploy, /liftosaur-ci\.mjs" record-deployment/);
  assert.match(deploy, /retention-days: 1/g);
  assert.match(deploy, /github\.rest\.pulls\.create/);
  assert.doesNotMatch(deploy, /liftosaur_program_id|LIFTOSAUR_PROGRAM_ID/);
  assert.match(deploy, /git switch --detach "origin\/\$STATE_BRANCH"/);
});
