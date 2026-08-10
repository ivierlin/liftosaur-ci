import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { deployPreparedBundle, prepareDeploymentBundle } from "../src/deployment.mjs";
import { sha256 } from "../src/report.mjs";

const active = "# Week 1\n## Active\nSquat / 1x5\n\n\n";
const deploy = "# Week 1\n## Deployed\nSquat / 1x6\n\n\n";
const apiKey = "lftsk_test_secret";

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function fixture(root, name) {
  const input = path.join(root, `${name}-input`);
  const bundle = path.join(root, `${name}-bundle`);
  await mkdir(input);
  const activeFile = path.join(input, "active.liftoscript");
  const deployFile = path.join(input, "deploy.liftoscript");
  const validationFile = path.join(input, "validation.json");
  const mergeFile = path.join(input, "merge.json");
  await Promise.all([
    writeFile(activeFile, active, "utf8"),
    writeFile(deployFile, deploy, "utf8"),
    writeFile(validationFile, `${JSON.stringify({
      formatVersion: 1,
      command: "validate",
      status: "passed",
      input: { sha256: sha256(deploy) },
    })}\n`, "utf8"),
    writeFile(mergeFile, `${JSON.stringify({
      formatVersion: 1,
      command: "merge",
      status: "merged",
      output: { sha256: sha256(deploy) },
    })}\n`, "utf8"),
  ]);
  await prepareDeploymentBundle({
    activeFile,
    deployFile,
    validationReportFile: validationFile,
    mergeReportFile: mergeFile,
    outputDirectory: bundle,
    target: { id: "program-1", name: "Active", isCurrent: true },
    deployedName: "Deployed",
  });
  return bundle;
}

test("prepared deployment verifies writes and rolls back only known failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-deployment-"));
  const requests = [];
  let programName = "Active";
  let programText = active;
  let forceMismatch = false;
  let ambiguousWrite = false;
  let rejectWithoutChange = false;
  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
    requests.push(request.method);
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad token" } }));
      return;
    }
    if (request.url === "/api/v1/programs/program-1" && request.method === "GET") {
      response.end(JSON.stringify({
        data: { id: "program-1", name: programName, text: programText, isCurrent: true },
      }));
      return;
    }
    if (request.url === "/api/v1/programs/program-1" && request.method === "PUT") {
      const parsed = JSON.parse(body);
      assert.deepEqual(Object.keys(parsed), ["name", "text"]);
      if (rejectWithoutChange && parsed.text === deploy) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: { code: "rejected", message: "No change" } }));
        return;
      }
      if (ambiguousWrite && parsed.text === deploy) {
        programName = "Concurrent edit";
        programText = "# Concurrent\n\n\n";
        response.statusCode = 400;
        response.end(JSON.stringify({ error: { code: "ambiguous", message: "Unknown outcome" } }));
        return;
      }
      programName = parsed.name;
      programText = forceMismatch && parsed.text === deploy ? "# Unexpected\n\n\n" : parsed.text;
      response.end(JSON.stringify({ data: { id: "program-1", name: programName, text: programText, isCurrent: true } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;

  try {
    const successBundle = await fixture(root, "success");
    const successRecord = path.join(root, "success-record");
    const report = await deployPreparedBundle({
      bundleDirectory: successBundle,
      outputDirectory: successRecord,
      apiKey,
      expectedProgramId: "program-1",
      expectedDeployedName: "Deployed",
      apiBase,
    });
    assert.equal(report.deploymentPerformed, true);
    assert.equal(report.rollbackAttempted, false);
    assert.equal(programName, "Deployed");
    assert.equal(programText, deploy);

    programName = "Active";
    programText = active;
    rejectWithoutChange = true;
    requests.length = 0;
    const rejectedBundle = await fixture(root, "rejected");
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: rejectedBundle,
        outputDirectory: path.join(root, "rejected-record"),
        apiKey,
        expectedProgramId: "program-1",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /update did not take effect/
    );
    assert.deepEqual(requests, ["GET", "PUT", "GET"]);
    rejectWithoutChange = false;

    programName = "Active";
    programText = active;
    forceMismatch = true;
    requests.length = 0;
    const rollbackBundle = await fixture(root, "rollback");
    const rollbackRecord = path.join(root, "rollback-record");
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: rollbackBundle,
        outputDirectory: rollbackRecord,
        apiKey,
        expectedProgramId: "program-1",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /rollback source were restored successfully/
    );
    const rollbackReport = JSON.parse(await readFile(path.join(rollbackRecord, "deployment-report.json"), "utf8"));
    assert.equal(rollbackReport.rollbackAttempted, true);
    assert.equal(rollbackReport.rollbackRestored, true);
    assert.equal(programName, "Active");
    assert.equal(programText, active);
    assert.deepEqual(requests, ["GET", "PUT", "GET", "PUT", "GET"]);

    forceMismatch = false;
    ambiguousWrite = true;
    programName = "Active";
    programText = active;
    requests.length = 0;
    const ambiguousBundle = await fixture(root, "ambiguous");
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: ambiguousBundle,
        outputDirectory: path.join(root, "ambiguous-record"),
        apiKey,
        expectedProgramId: "program-1",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /no automatic rollback was attempted/
    );
    assert.deepEqual(requests, ["GET", "PUT", "GET"]);
    assert.equal(programName, "Concurrent edit");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test("deployment refuses changed targets and corrupted bundles before writing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-deployment-guard-"));
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: { id: "program-1", name: "Active", text: "# Changed\n\n\n", isCurrent: true },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  try {
    const wrongTargetBundle = await fixture(root, "wrong-target");
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: wrongTargetBundle,
        outputDirectory: path.join(root, "wrong-target-record"),
        apiKey,
        expectedProgramId: "different-program",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /confirmation does not match the prepared target ID/
    );
    assert.equal(requests, 0);

    const changedBundle = await fixture(root, "changed");
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: changedBundle,
        outputDirectory: path.join(root, "changed-record"),
        apiKey,
        expectedProgramId: "program-1",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /changed after deployment preparation/
    );
    assert.equal(requests, 1);

    const corruptBundle = await fixture(root, "corrupt");
    await writeFile(path.join(corruptBundle, "deploy.liftoscript"), "# Corrupt\n\n\n", "utf8");
    requests = 0;
    await assert.rejects(
      deployPreparedBundle({
        bundleDirectory: corruptBundle,
        outputDirectory: path.join(root, "corrupt-record"),
        apiKey,
        expectedProgramId: "program-1",
        expectedDeployedName: "Deployed",
        apiBase,
      }),
      /Checksum mismatch/
    );
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
