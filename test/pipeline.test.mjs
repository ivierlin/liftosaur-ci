import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "./helpers/run-cli.mjs";

const apiKey = `lftsk_${"pipeline_secret"}`;

function source({ volume = 2, timer = 120 } = {}) {
  return `# Week 1
## Day A
Squat / 3x5 100kg / ${timer}s / progress: custom(volume: ${volume}) {~ state.volume = state.volume ~}


`;
}

const run = runCli;

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("prepare resolves current and deploys the exact prepared target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-pipeline-"));
  const baseFile = path.join(root, "base.liftoscript");
  const candidateFile = path.join(root, "candidate.liftoscript");
  const conflictBundle = path.join(root, "conflict-bundle");
  const bundle = path.join(root, "bundle");
  const record = path.join(root, "record");
  const base = source();
  const active = source({ volume: 3 });
  const candidate = source({ timer: 180 });
  let program = { id: "program-1", name: "Active", text: active, isCurrent: true };
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
    if (
      request.method === "GET"
      && (request.url === "/api/v1/programs/current" || request.url === "/api/v1/programs/program-1")
    ) {
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

  try {
    await Promise.all([
      writeFile(baseFile, base, "utf8"),
      writeFile(candidateFile, source({ volume: 4 }), "utf8"),
    ]);
    const conflicted = await run([
      "prepare",
      "--base", baseFile,
      "--candidate", candidateFile,
      "--program-id", "current",
      "--output", conflictBundle,
      "--api-base", apiBase,
    ], environment);
    assert.equal(conflicted.code, 2, `${conflicted.stdout}\n${conflicted.stderr}`);
    assert.match(conflicted.stderr, /unresolved three-way merge conflicts/);
    assert.match(conflicted.stderr, /Conflict workspace written to:/);
    assert.match(conflicted.stderr, /git diff --no-index/);
    assert.doesNotMatch(conflicted.stderr, new RegExp(apiKey));
    assert.equal(await readFile(path.join(conflictBundle, "base.liftoscript"), "utf8"), base);
    assert.equal(await readFile(path.join(conflictBundle, "active.liftoscript"), "utf8"), active);
    assert.equal(
      await readFile(path.join(conflictBundle, "candidate.liftoscript"), "utf8"),
      source({ volume: 4 })
    );
    assert.match(await readFile(path.join(conflictBundle, "conflict.txt"), "utf8"), /<<<<<<< active/);
    const conflictReport = JSON.parse(await readFile(path.join(conflictBundle, "merge-report.json"), "utf8"));
    assert.equal(conflictReport.status, "conflict");
    await assert.rejects(readFile(path.join(conflictBundle, "deployment-manifest.json")), { code: "ENOENT" });
    requests.length = 0;
    await writeFile(candidateFile, candidate, "utf8");

    const prepared = await run([
      "prepare",
      "--base", baseFile,
      "--candidate", candidateFile,
      "--program-id", "current",
      "--output", bundle,
      "--api-base", apiBase,
    ], environment);
    assert.equal(prepared.code, 0, `${prepared.stdout}\n${prepared.stderr}`);
    assert.match(prepared.stdout, /1 days validated/);
    assert.deepEqual(requests, [{ method: "GET", url: "/api/v1/programs/current" }]);

    const merged = await readFile(path.join(bundle, "deploy.liftoscript"), "utf8");
    assert.match(merged, /180s/);
    assert.match(merged, /volume: 3/);
    const manifest = JSON.parse(await readFile(path.join(bundle, "deployment-manifest.json"), "utf8"));
    assert.equal(manifest.target.id, "program-1");
    assert.deepEqual(Object.keys(manifest.deployment), ["sourceSha256"]);
    assert.equal(manifest.evidence.merge.file, "merge-report.json");
    assert.equal(manifest.evidence.validation.file, "validation-report.json");

    const deployed = await run([
      "deploy",
      "--bundle", bundle,
      "--confirm-program-id", "program-1",
      "--output", record,
      "--api-base", apiBase,
    ], environment);
    assert.equal(deployed.code, 0, `${deployed.stdout}\n${deployed.stderr}`);
    assert.equal(program.name, "Active");
    assert.equal(program.text, merged);
    const report = JSON.parse(await readFile(path.join(record, "deployment-report.json"), "utf8"));
    assert.equal(report.deploymentPerformed, true);
    assert.deepEqual(requests.map(({ method }) => method), ["GET", "GET", "PUT", "GET"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
