import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deploymentRef } from "../src/deployment-state.mjs";
import { initializeGitDeployment } from "../src/initialize.mjs";

const apiKey = "lftsk_initialize_test";
const source = "# Week 1\n## Day A\nSquat / 1x5\n\n\n";

function git(repository, args, { fail = false } = {}) {
  const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true });
  if (!fail) assert.equal(result.status, 0, result.stderr);
  return fail ? result : result.stdout.trim();
}

async function fixture({ configured = false, programId = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-initialize-"));
  const repository = path.join(root, "repository");
  const remote = path.join(root, "remote.git");
  await mkdir(repository);
  assert.equal(spawnSync("git", ["init", "--bare", remote], { encoding: "utf8" }).status, 0);
  git(repository, ["init"]);
  git(repository, ["remote", "add", "origin", remote]);
  await writeFile(path.join(repository, "program.liftoscript"), source);
  if (configured) {
    await writeFile(path.join(repository, "liftosaur-ci.json"), `${JSON.stringify({ deployments: { program: {
      program: "program.liftoscript", ...(programId ? { programId } : {}),
    } } }, null, 2)}\n`);
  }
  git(repository, ["add", "."]);
  git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "candidate"]);
  git(repository, ["branch", "-M", "main"]);
  git(repository, ["push", "-u", "origin", "main"]);
  return { root, repository, remote, candidate: git(repository, ["rev-parse", "HEAD"]), configFile: path.join(repository, "liftosaur-ci.json") };
}

async function api(programSource = source) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push([request.method, request.url]);
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/v1/programs/current") {
      response.end(JSON.stringify({ data: { id: "exact-1", name: "Program", text: programSource, isCurrent: true } }));
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ error: { message: "unexpected write" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, requests, apiBase: `http://127.0.0.1:${server.address().port}/api/v1` };
}

test("simple exact match commits canonical config before creating the deployment ref without a live write", async () => {
  const f = await fixture();
  const live = await api();
  try {
    const result = await initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main", apiKey, apiBase: live.apiBase,
    });
    assert.equal(result.action, "initialized");
    assert.notEqual(result.candidateCommit, f.candidate);
    assert.deepEqual(live.requests, [["GET", "/api/v1/programs/current"]]);
    assert.deepEqual(JSON.parse(await readFile(f.configFile, "utf8")), { deployments: { program: {
      program: "program.liftoscript", programId: "exact-1",
    } } });
    assert.equal(git(f.remote, ["rev-parse", "refs/heads/main"]), result.candidateCommit);
    assert.equal(git(f.remote, ["rev-parse", deploymentRef("program")]), result.candidateCommit);
    assert.equal(git(f.repository, ["rev-parse", `${f.candidate}:program.liftoscript`]), git(f.repository, ["rev-parse", `${result.candidateCommit}:program.liftoscript`]));
  } finally {
    await new Promise((resolve) => live.server.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});

test("simple mismatch fails closed with beginner instructions", async () => {
  const f = await fixture();
  const live = await api(source.replace("1x5", "2x5"));
  try {
    await assert.rejects(initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main", apiKey, apiBase: live.apiBase,
    }), /Export or copy.*commit and push.*base_ref/s);
    assert.deepEqual(live.requests, [["GET", "/api/v1/programs/current"]]);
    await assert.rejects(readFile(f.configFile, "utf8"), /ENOENT/);
    assert.notEqual(git(f.remote, ["rev-parse", deploymentRef("program")], { fail: true }).status, 0);
    assert.equal(git(f.remote, ["rev-parse", "refs/heads/main"]), f.candidate);
  } finally {
    await new Promise((resolve) => live.server.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});

test("configured first migration requires base and pins an omitted target before preparation", async () => {
  const f = await fixture({ configured: true });
  const live = await api();
  try {
    await assert.rejects(initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main", apiKey, apiBase: live.apiBase,
    }), /provide --base-ref/);
    assert.deepEqual(live.requests, []);
    const result = await initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main", baseRef: f.candidate, apiKey, apiBase: live.apiBase,
    });
    assert.equal(result.action, "pinned");
    assert.equal(JSON.parse(await readFile(f.configFile, "utf8")).deployments.program.programId, "exact-1");
    assert.notEqual(result.candidateCommit, f.candidate);
    assert.notEqual(git(f.remote, ["rev-parse", deploymentRef("program")], { fail: true }).status, 0);
  } finally {
    await new Promise((resolve) => live.server.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});

test("zero-config with an explicit base follows the advanced migration path", async () => {
  const f = await fixture();
  const live = await api(source.replace("1x5", "2x5"));
  try {
    const result = await initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main",
      baseRef: f.candidate, apiKey, apiBase: live.apiBase,
    });
    assert.equal(result.action, "pinned");
    assert.equal(JSON.parse(await readFile(f.configFile, "utf8")).deployments.program.programId, "exact-1");
    assert.notEqual(git(f.remote, ["rev-parse", deploymentRef("program")], { fail: true }).status, 0);
    assert.deepEqual(live.requests, [["GET", "/api/v1/programs/current"]]);
  } finally {
    await new Promise((resolve) => live.server.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});

test("release branch lease failure reports complete manual recovery and creates no ref or live write", async () => {
  const f = await fixture();
  const live = await api();
  try {
    const other = path.join(f.root, "other");
    git(f.root, ["clone", f.remote, other]);
    git(other, ["checkout", "main"]);
    await writeFile(path.join(other, "notes.md"), "concurrent\n");
    git(other, ["add", "."]);
    git(other, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "concurrent"]);
    git(other, ["push", "origin", "main"]);
    const moved = git(f.remote, ["rev-parse", "refs/heads/main"]);
    const expectedConfig = JSON.stringify({ deployments: { program: {
      program: "program.liftoscript", programId: "exact-1",
    } } }, null, 2);
    await assert.rejects(initializeGitDeployment({
      configFile: f.configFile, repository: f.repository, releaseBranch: "main", apiKey, apiBase: live.apiBase,
    }), (error) => {
      assert.match(error.message, /could not record liftosaur-ci\.json/);
      assert.ok(error.message.includes(expectedConfig));
      assert.ok(error.message.includes(`Base Git revision: ${f.candidate}`));
      assert.match(error.message, /Create.*current release branch.*commit.*push/s);
      assert.match(error.message, /optional Base Git revision field/);
      assert.match(error.message, /No Liftosaur write or deployment ref was created/);
      return true;
    });
    assert.equal(git(f.remote, ["rev-parse", "refs/heads/main"]), moved);
    assert.notEqual(git(f.remote, ["rev-parse", deploymentRef("program")], { fail: true }).status, 0);
    assert.deepEqual(live.requests, [["GET", "/api/v1/programs/current"]]);
  } finally {
    await new Promise((resolve) => live.server.close(resolve));
    await rm(f.root, { recursive: true, force: true });
  }
});
