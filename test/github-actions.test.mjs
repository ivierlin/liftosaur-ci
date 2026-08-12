import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkFile = new URL("../.github/workflows/reusable-check.yml", import.meta.url);
const deployFile = new URL("../.github/workflows/reusable-deploy.yml", import.meta.url);
const archiveFile = new URL("../.github/workflows/reusable-update-archive.yml", import.meta.url);

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
  assert.match(check, /Check programs and reviewed snapshots\s+shell: bash/);
  assert.match(check, /liftosaur-ci\.mjs" check/);

  assert.match(deploy, /needs: prepare/);
  assert.match(deploy, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(deploy, /contents: write\s+pull-requests: write/);
  assert.match(deploy, /Deploy and verify\s+shell: bash/);
  assert.match(deploy, /liftosaur-ci\.mjs" deploy/);
  assert.match(deploy, /Record verified Git deployment state\s+shell: bash/);
  assert.match(deploy, /liftosaur-ci\.mjs" record-deployment/);
  assert.match(deploy, /retention-days: 1/g);
  assert.match(deploy, /github\.rest\.pulls\.create/);
  assert.doesNotMatch(deploy, /liftosaur_program_id|LIFTOSAUR_PROGRAM_ID/);
  assert.match(deploy, /git switch --detach "origin\/\$STATE_BRANCH"/);
});

test("repository-free archive workflow retains its safety contract", async () => {
  const archive = await readFile(archiveFile, "utf8");
  assert.match(archive, /workflow_call:/);
  assert.match(archive, /fromJSON\(inputs\.runs_on\)/);
  assert.match(archive, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(archive, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(archive, /npm ci --omit=dev --ignore-scripts/);
  assert.match(archive, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(archive, /ARCHIVE_URL: \$\{\{ inputs\.archive_url \}\}/);
  assert.doesNotMatch(archive, /curl[^\r\n]*\$\{\{ inputs\.archive_url \}\}/);
  assert.doesNotMatch(archive, /archive_sha256|ARCHIVE_SHA256|archive-sha256/);
  assert.match(archive, /program_id:[\s\S]*?default: current/);
  assert.match(archive, /git fetch origin -- "\$STATE_BRANCH"/);
  assert.match(archive, /github\.rest\.pulls\.create/);
  assert.match(archive, /retention-days: 1/);
  assert.doesNotMatch(archive, /ubuntu-latest|ROAR|WSL/);
});
