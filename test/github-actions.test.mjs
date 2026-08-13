import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reusable workflows expose Ready to Deploy with optional approval and ref state", async () => {
  const check = await readFile(new URL("../.github/workflows/reusable-check.yml", import.meta.url), "utf8");
  const deploy = await readFile(new URL("../.github/workflows/reusable-deploy.yml", import.meta.url), "utf8");
  const guide = await readFile(new URL("../docs/github-actions.md", import.meta.url), "utf8");
  const releasing = await readFile(new URL("../docs/releasing.md", import.meta.url), "utf8");
  for (const workflow of [check, deploy]) {
    assert.match(workflow, /workflow_call:/);
    assert.match(workflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
    assert.match(workflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
    assert.doesNotMatch(workflow, /tool_ref|tool_repository|tool_token|TOOL_COMMIT/);
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
  assert.match(guide, /reusable-check\.yml@0/);
  assert.match(guide, /reusable-deploy\.yml@0/);
  assert.doesNotMatch(guide, /tool_ref|tool_repository|tool_token|TOOL_COMMIT/);
  assert.doesNotMatch(guide, /project-requirements:[\s\S]*?run: "true"/);
  assert.match(guide, /project-requirements:[\s\S]*?needs: program-checks[\s\S]*?npm test[\s\S]*?needs: \[program-checks, project-requirements\]/);
  assert.match(guide, /Leave \*\*Base Git revision\*\* blank/);
  assert.match(releasing, /Every release pointed to by `0` must remain compatible/);
  assert.match(releasing, /--force-with-lease="refs\/tags\/0:\$old_zero"/);
});
