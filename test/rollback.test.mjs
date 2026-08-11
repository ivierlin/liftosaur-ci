import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareDeploymentBundle } from "../src/deployment.mjs";
import { sha256 } from "../src/report.mjs";
import { rollbackRecoveryDirectory } from "../src/rollback.mjs";

const active = "# Week 1\n## Active\nSquat / 1x5\n\n\n";
const deploy = "# Week 1\n## Deployed\nSquat / 1x6\n\n\n";
const unknown = "# Week 1\n## Concurrent\nSquat / 1x7\n\n\n";
const apiKey = "lftsk_test_secret";
const ambiguousFailure = "Liftosaur update outcome is ambiguous or the target changed concurrently; no automatic rollback was attempted";

async function recoveryFixture(root, failure = ambiguousFailure) {
  const recovery = path.join(root, "recovery");
  const input = path.join(root, "input");
  const bundle = path.join(recovery, "bundle");
  const record = path.join(recovery, "record");
  await Promise.all([mkdir(input), mkdir(record, { recursive: true })]);
  const activeFile = path.join(input, "active.liftoscript");
  const deployFile = path.join(input, "deploy.liftoscript");
  const validationFile = path.join(input, "validation.json");
  await Promise.all([
    writeFile(activeFile, active, "utf8"),
    writeFile(deployFile, deploy, "utf8"),
    writeFile(validationFile, `${JSON.stringify({
      command: "validate",
      status: "passed",
      input: { sha256: sha256(deploy) },
    })}\n`, "utf8"),
  ]);
  await prepareDeploymentBundle({
    activeFile,
    deployFile,
    validationReportFile: validationFile,
    outputDirectory: bundle,
    target: { id: "program-1" },
  });
  await writeFile(path.join(record, "deployment-report.json"), `${JSON.stringify({
    command: "deploy",
    deploymentPerformed: false,
    target: { id: "program-1" },
    failure,
  }, null, 2)}\n`, "utf8");
  return recovery;
}

function apiServer(initialText = unknown) {
  const requests = [];
  let program = { id: "program-1", name: "Keep current name", text: initialText, isCurrent: true };
  const server = createServer(async (request, response) => {
    requests.push(request.method);
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad token" } }));
      return;
    }
    if (request.url === "/api/v1/programs/program-1" && request.method === "GET") {
      response.end(JSON.stringify({ data: program }));
      return;
    }
    if (request.url === "/api/v1/programs/program-1" && request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      program = { ...program, name: body.name, text: body.text };
      response.end(JSON.stringify({ data: program }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  return { server, requests, get program() { return program; } };
}

test("explicit rollback restores the prepared active source and preserves the unknown live source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-rollback-"));
  const recovery = await recoveryFixture(root);
  const api = apiServer();
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${api.server.address().port}/api/v1`;
  try {
    const report = await rollbackRecoveryDirectory({ recoveryDirectory: recovery, apiKey, apiBase });
    assert.equal(report.status, "rolled-back");
    assert.equal(api.program.text, active);
    assert.equal(api.program.name, "Keep current name");
    assert.deepEqual(api.requests, ["GET", "PUT", "GET"]);
    assert.equal(
      await readFile(path.join(recovery, "record", "rollback-observed.liftoscript"), "utf8"),
      unknown
    );
    assert.equal(
      JSON.parse(await readFile(path.join(recovery, "record", "rollback-report.json"), "utf8")).status,
      "rolled-back"
    );

    api.requests.length = 0;
    const repeated = await rollbackRecoveryDirectory({ recoveryDirectory: recovery, apiKey, apiBase });
    assert.equal(repeated.status, "already-restored");
    assert.deepEqual(api.requests, ["GET"]);
  } finally {
    await new Promise((resolve, reject) => api.server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback refuses recovery records that do not represent an ambiguous write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-rollback-refuse-"));
  try {
    const recovery = await recoveryFixture(
      root,
      "Liftosaur target changed after deployment preparation; prepare a fresh bundle"
    );
    await assert.rejects(
      rollbackRecoveryDirectory({ recoveryDirectory: recovery, apiKey }),
      /only available.*ambiguous deployment write/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
