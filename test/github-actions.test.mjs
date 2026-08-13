import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reusable workflows expose Ready to Deploy with optional approval and ref state", async () => {
  const check = await readFile(new URL("../.github/workflows/reusable-check.yml", import.meta.url), "utf8");
  const deploy = await readFile(new URL("../.github/workflows/reusable-deploy.yml", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/github-actions.md", import.meta.url), "utf8");
  for (const workflow of [check, deploy]) {
    assert.match(workflow, /workflow_call:/);
    assert.match(workflow, /tool_ref:[\s\S]*?required: true/);
    assert.match(workflow, /ubuntu-latest/);
    assert.doesNotMatch(workflow, /ROAR|fflate|update-archive/);
  }
  assert.match(deploy, /name: Ready to deploy/);
  assert.match(deploy, /needs: ready/);
  assert.match(deploy, /environment:\s+\$\{\{ inputs\.environment \|\| null \}\}/);
  assert.match(deploy, /refs\/liftosaur-ci\/deployments/);
  assert.match(deploy, /Record verified deployment position/);
  assert.match(deploy, /Initialize or pin canonical deployment config/);
  assert.match(deploy, /Base Git revision \(advanced first migration only\)/);
  assert.doesNotMatch(deploy, /pull-requests: write|target-binding pull request|gh pr create/);
  assert.match(deploy, /if: needs\.ready\.outputs\.required == 'true'/);
  assert.doesNotMatch(deploy, /\.liftosaur-ci\/deployments|state_branch|deployment-state pull request/);
  assert.match(guide, /workflow_dispatch:[\s\S]*?base_ref:[\s\S]*?Base Git revision \(advanced first migration only\)[\s\S]*?required: false/);
  assert.match(guide, /github\.event\.inputs\.base_ref \|\| ''/);
  assert.doesNotMatch(guide, /project-requirements:[\s\S]*?run: "true"/);
  assert.match(guide, /Leave \*\*Base Git revision\*\* blank/);
});
