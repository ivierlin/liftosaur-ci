import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadLiftosaurConfig } from "../src/config.mjs";
import { configuredGitPreparation, deploymentRef, recordDeploymentState } from "../src/deployment-state.mjs";

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function repoFixture({ programId = "program-1" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-ref-test-"));
  const repository = path.join(root, "repository");
  const remote = path.join(root, "remote.git");
  await mkdir(repository);
  const bare = spawnSync("git", ["init", "--bare", remote], { encoding: "utf8", windowsHide: true });
  assert.equal(bare.status, 0, bare.stderr);
  git(repository, ["init"]);
  git(repository, ["remote", "add", "origin", remote]);
  const config = { deployments: { program: { program: "program.liftoscript", ...(programId ? { programId } : {}) } } };
  await Promise.all([
    writeFile(path.join(repository, "program.liftoscript"), "# Week 1\n## Day A\nSquat / 1x5\n"),
    writeFile(path.join(repository, "liftosaur-ci.json"), `${JSON.stringify(config, null, 2)}\n`),
  ]);
  git(repository, ["add", "."]);
  git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
  return { root, repository, remote, configFile: path.join(repository, "liftosaur-ci.json"), base: git(repository, ["rev-parse", "HEAD"]) };
}

test("durable config allows omitted or exact program IDs and rejects current", async () => {
  for (const programId of [null, "exact-1"]) {
    const fixture = await repoFixture({ programId });
    try { assert.equal((await loadLiftosaurConfig(fixture.configFile)).deployments.program.programId, programId ?? undefined); }
    finally { await rm(fixture.root, { recursive: true, force: true }); }
  }
  const fixture = await repoFixture();
  try {
    await writeFile(fixture.configFile, JSON.stringify({ deployments: {
      a: { program: "program.liftoscript", programId: "exact-a" },
      b: { program: "program.liftoscript", programId: "exact-b" },
    } }));
    assert.deepEqual(Object.keys((await loadLiftosaurConfig(fixture.configFile)).deployments), ["a", "b"]);
    await writeFile(fixture.configFile, JSON.stringify({ deployments: { a: { program: "program.liftoscript", programId: "current" } } }));
    await assert.rejects(loadLiftosaurConfig(fixture.configFile), /exact ID, not current/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("bootstrap requires base, resolves current once, and initialized missing target fails closed", async () => {
  const fixture = await repoFixture({ programId: null });
  try {
    await assert.rejects(configuredGitPreparation({ configFile: fixture.configFile }), /provide --base-ref/);
    const bootstrap = await configuredGitPreparation({ configFile: fixture.configFile, baseRef: fixture.base });
    assert.equal(bootstrap.programId, "current");
    assert.equal(bootstrap.targetBindingRequired, true);
    git(fixture.repository, ["update-ref", deploymentRef("program"), fixture.base]);
    await assert.rejects(configuredGitPreparation({ configFile: fixture.configFile }), /has no exact programId/);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("deployment relevance compares only the configured program blob at the ref", async () => {
  const fixture = await repoFixture();
  try {
    git(fixture.repository, ["update-ref", deploymentRef("program"), fixture.base]);
    await writeFile(path.join(fixture.repository, "notes.md"), "unrelated\n");
    git(fixture.repository, ["add", "notes.md"]);
    git(fixture.repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "notes"]);
    assert.equal((await configuredGitPreparation({ configFile: fixture.configFile })).deploymentRequired, false);
    await writeFile(path.join(fixture.repository, "program.liftoscript"), "# Week 1\n## Day A\nSquat / 2x5\n");
    git(fixture.repository, ["add", "program.liftoscript"]);
    git(fixture.repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "program"]);
    const changed = await configuredGitPreparation({ configFile: fixture.configFile });
    assert.equal(changed.deploymentRequired, true);
    assert.equal(changed.expectedRefSha, fixture.base);
    assert.equal(changed.baseRef, fixture.base);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("verified receipts create and lease-advance the ref while stale recording fails closed", async () => {
  const fixture = await repoFixture();
  try {
    await writeFile(path.join(fixture.repository, "program.liftoscript"), "# Week 1\n## Day A\nSquat / 2x5\n");
    git(fixture.repository, ["add", "program.liftoscript"]);
    git(fixture.repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "candidate"]);
    const candidate = git(fixture.repository, ["rev-parse", "HEAD"]);
    const reportFile = path.join(fixture.root, "report.json");
    const report = {
      command: "deploy", deploymentPerformed: true, deployedAt: new Date().toISOString(),
      target: { id: "program-1" },
      source: { programPath: "program.liftoscript", base: { commitSha: fixture.base }, candidate: { commitSha: candidate } },
    };
    await writeFile(reportFile, JSON.stringify(report));
    await recordDeploymentState({ configFile: fixture.configFile, reportFile });
    assert.equal(git(fixture.remote, ["rev-parse", deploymentRef("program")]), candidate);

    git(fixture.repository, ["update-ref", deploymentRef("program"), candidate]);
    await writeFile(path.join(fixture.repository, "notes.md"), "newer\n");
    git(fixture.repository, ["add", "notes.md"]);
    git(fixture.repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "newer"]);
    const newer = git(fixture.repository, ["rev-parse", "HEAD"]);
    git(fixture.repository, ["push", "origin", `${newer}:${deploymentRef("program")}`]);
    await writeFile(path.join(fixture.repository, "notes.md"), "third\n");
    git(fixture.repository, ["add", "notes.md"]);
    git(fixture.repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "third"]);
    const third = git(fixture.repository, ["rev-parse", "HEAD"]);
    report.source.base.commitSha = candidate;
    report.source.candidate.commitSha = third;
    await writeFile(reportFile, JSON.stringify(report));
    await assert.rejects(recordDeploymentState({ configFile: fixture.configFile, reportFile }), /recording .* failed/);
    assert.equal(git(fixture.remote, ["rev-parse", deploymentRef("program")]), newer);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
