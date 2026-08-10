import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "./helpers/run-cli.mjs";

const apiKey = `lftsk_${"git_pipeline_secret"}`;

function source({ volume = 2, timer = 120 } = {}) {
  return `# Week 1
## Day A
Squat / 3x5 100kg / ${timer}s / progress: custom(volume: ${volume}) {~ state.volume = state.volume ~}


`;
}

function git(repository, args) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const run = runCli;

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("prepare-git binds immutable Git inputs through verified deployment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-git-pipeline-"));
  const repository = path.join(root, "repository");
  const programPath = "programs/example.liftoscript";
  const programFile = path.join(repository, ...programPath.split("/"));
  const configFile = path.join(repository, "liftosaur-ci.json");
  const bundle = path.join(root, "bundle");
  const record = path.join(root, "record");
  const active = source({ volume: 3 });
  let program = { id: "program-1", name: "Actual current name", text: active, isCurrent: true };
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad token" } }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/programs/program-1") {
      response.end(JSON.stringify({ data: program }));
      return;
    }
    if (request.method === "PUT" && request.url === "/api/v1/programs/program-1") {
      const update = JSON.parse(body);
      program = { ...program, name: update.name, text: update.text };
      response.end(JSON.stringify({ data: program }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  const environment = {
    ...process.env,
    LIFTOSAUR_API_KEY: apiKey,
    LIFTOSAUR_EXAMPLE_PROGRAM_ID: "program-1",
  };

  try {
    await mkdir(path.dirname(programFile), { recursive: true });
    git(repository, ["init"]);
    git(repository, ["remote", "add", "origin", "https://github.com/example/training.git"]);
    await Promise.all([
      writeFile(programFile, source(), "utf8"),
      writeFile(configFile, `${JSON.stringify({
        formatVersion: 2,
        implementation: "liftosaur-check-config-v2",
        programs: ["programs/*.liftoscript"],
        scenarios: [],
        deployments: {
          example: {
            program: programPath,
            programIdEnv: "LIFTOSAUR_EXAMPLE_PROGRAM_ID",
            deployedProgramName: "Deployed",
          },
        },
      }, null, 2)}\n`, "utf8"),
    ]);
    git(repository, ["add", programPath, "liftosaur-ci.json"]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const baseSha = git(repository, ["rev-parse", "HEAD"]);
    await writeFile(programFile, source({ timer: 180 }), "utf8");
    git(repository, ["add", programPath]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "candidate"]);
    const candidateSha = git(repository, ["rev-parse", "HEAD"]);

    const prepared = await run([
      "prepare-git",
      "--repository", repository,
      "--config", configFile,
      "--deployment", "example",
      "--base-ref", baseSha,
      "--candidate-ref", candidateSha,
      "--output", bundle,
      "--api-base", apiBase,
    ], environment);
    assert.equal(prepared.code, 0, `${prepared.stdout}\n${prepared.stderr}`);
    assert.deepEqual(requests, [{ method: "GET", url: "/api/v1/programs/program-1" }]);

    const merged = await readFile(path.join(bundle, "deploy.liftoscript"), "utf8");
    assert.match(merged, /180s/);
    assert.match(merged, /volume: 3/);
    const manifest = JSON.parse(await readFile(path.join(bundle, "deployment-manifest.json"), "utf8"));
    assert.equal(manifest.target.id, "program-1");
    assert.equal(manifest.target.name, "Actual current name");
    assert.deepEqual(manifest.source, {
      implementation: "liftosaur-git-source-v1",
      remote: "https://github.com/example/training.git",
      objectFormat: "sha1",
      programPath,
      base: {
        requestedRef: baseSha,
        commitSha: baseSha,
        blobSha: git(repository, ["rev-parse", `${baseSha}:${programPath}`]),
      },
      candidate: {
        requestedRef: candidateSha,
        commitSha: candidateSha,
        blobSha: git(repository, ["rev-parse", `${candidateSha}:${programPath}`]),
      },
    });

    const deployed = await run([
      "deploy",
      "--bundle", bundle,
      "--config", configFile,
      "--deployment", "example",
      "--output", record,
      "--api-base", apiBase,
    ], environment);
    assert.equal(deployed.code, 0, `${deployed.stdout}\n${deployed.stderr}`);
    assert.equal(program.name, "Deployed");
    assert.equal(program.text, merged);
    const report = JSON.parse(await readFile(path.join(record, "deployment-report.json"), "utf8"));
    assert.deepEqual(report.source, manifest.source);

    const recorded = await run([
      "record-deployment",
      "--config", configFile,
      "--deployment", "example",
      "--report", path.join(record, "deployment-report.json"),
    ], environment);
    assert.equal(recorded.code, 0, `${recorded.stdout}\n${recorded.stderr}`);
    const stateFile = path.join(repository, ".liftosaur-ci", "deployments", "example.json");
    const stateText = await readFile(stateFile, "utf8");
    const state = JSON.parse(stateText);
    assert.equal(state.deployment, "example");
    assert.equal(state.candidate.commitSha, candidateSha);
    assert.equal(state.candidate.blobSha, manifest.source.candidate.blobSha);
    assert.doesNotMatch(stateText, /program-1|Actual current name|Deployed/);

    git(repository, ["add", ".liftosaur-ci/deployments/example.json"]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "record deployment"]);
    await writeFile(programFile, source({ timer: 240 }), "utf8");
    git(repository, ["add", programPath]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "next candidate"]);
    const nextCandidateSha = git(repository, ["rev-parse", "HEAD"]);
    const nextBundle = path.join(root, "next-bundle");
    const nextPrepared = await run([
      "prepare-git",
      "--repository", repository,
      "--config", configFile,
      "--deployment", "example",
      "--candidate-ref", nextCandidateSha,
      "--output", nextBundle,
      "--api-base", apiBase,
    ], environment);
    assert.equal(nextPrepared.code, 0, `${nextPrepared.stdout}\n${nextPrepared.stderr}`);
    const nextManifest = JSON.parse(await readFile(path.join(nextBundle, "deployment-manifest.json"), "utf8"));
    assert.equal(nextManifest.source.base.commitSha, candidateSha);
    assert.equal(nextManifest.source.base.blobSha, state.candidate.blobSha);
    const nextMerged = await readFile(path.join(nextBundle, "deploy.liftoscript"), "utf8");
    assert.match(nextMerged, /240s/);
    assert.match(nextMerged, /volume: 3/);

    const requestCount = requests.length;
    await writeFile(path.join(repository, "untracked.txt"), "not reviewed\n", "utf8");
    const dirty = await run([
      "prepare-git",
      "--repository", repository,
      "--config", configFile,
      "--deployment", "example",
      "--base-ref", baseSha,
      "--candidate-ref", nextCandidateSha,
      "--output", path.join(root, "dirty-bundle"),
      "--api-base", apiBase,
    ], environment);
    assert.equal(dirty.code, 1);
    assert.match(dirty.stderr, /worktree must be clean/);
    assert.equal(requests.length, requestCount);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
