import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "./helpers/run-cli.mjs";

const apiKey = "lftsk_update_secret";

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

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("update bootstraps once and then needs no deployment inputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-update-"));
  const repository = path.join(root, "repository");
  const programFile = path.join(repository, "programs", "example.liftoscript");
  const configFile = path.join(repository, "liftosaur-ci.json");
  let program = {
    id: "program-1",
    name: "Keep this name",
    text: source({ volume: 3 }),
    isCurrent: true,
  };
  const requests = [];
  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
    requests.push([request.method, request.url]);
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad token" } }));
      return;
    }
    if (request.method === "GET" && ["/api/v1/programs/current", "/api/v1/programs/program-1"].includes(request.url)) {
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
  const environment = { ...process.env, LIFTOSAUR_API_KEY: apiKey };
  const previousCwd = process.cwd();

  try {
    await mkdir(path.dirname(programFile), { recursive: true });
    git(repository, ["init"]);
    git(repository, ["remote", "add", "origin", "https://github.com/example/training.git"]);
    await Promise.all([
      writeFile(programFile, source(), "utf8"),
      writeFile(configFile, `${JSON.stringify({
        deployments: {
          program: {
            program: "programs/example.liftoscript",
            programId: "current",
          },
        },
      }, null, 2)}\n`, "utf8"),
    ]);
    git(repository, ["add", "."]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const baseSha = git(repository, ["rev-parse", "HEAD"]);

    await writeFile(programFile, source({ timer: 180 }), "utf8");
    git(repository, ["add", "programs/example.liftoscript"]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "candidate"]);
    const firstCandidate = git(repository, ["rev-parse", "HEAD"]);

    process.chdir(repository);
    const bootstrap = await runCli([
      "update",
      "--base-ref", baseSha,
      "--api-base", apiBase,
    ], environment);
    assert.equal(bootstrap.code, 0, `${bootstrap.stdout}\n${bootstrap.stderr}`);
    assert.match(bootstrap.stdout, /Liftosaur update verified/);
    assert.equal(program.name, "Keep this name");
    assert.match(program.text, /180s/);
    assert.match(program.text, /volume: 3/);

    const stateFile = path.join(repository, ".liftosaur-ci", "deployments", "program.json");
    let state = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(state.commitSha, firstCandidate);

    await writeFile(programFile, source({ timer: 240 }), "utf8");
    git(repository, ["add", "programs/example.liftoscript"]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "next candidate"]);
    const secondCandidate = git(repository, ["rev-parse", "HEAD"]);

    requests.length = 0;
    const updated = await runCli(["update", "--api-base", apiBase], environment);
    assert.equal(updated.code, 0, `${updated.stdout}\n${updated.stderr}`);
    assert.deepEqual(requests.map(([method]) => method), ["GET", "GET", "PUT", "GET"]);
    assert.deepEqual(requests.map(([, url]) => url), [
      "/api/v1/programs/current",
      "/api/v1/programs/program-1",
      "/api/v1/programs/program-1",
      "/api/v1/programs/program-1",
    ]);
    assert.equal(program.name, "Keep this name");
    assert.match(program.text, /240s/);
    assert.match(program.text, /volume: 3/);
    state = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(state.commitSha, secondCandidate);
  } finally {
    process.chdir(previousCwd);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
