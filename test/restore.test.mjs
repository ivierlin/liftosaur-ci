import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../src/report.mjs";
import { restoreDeploymentArtifact } from "../src/restore.mjs";

const apiKey = "lftsk_restore_test";
const current = "# Week 1\n## Current\nSquat / 1x5\n\n\n";
const historical = "# Week 1\n## Historical\nSquat / 1x4\n\n\n";

async function artifact(root, source = historical) {
  const directory = path.join(root, "artifact");
  await mkdir(directory);
  await Promise.all([
    writeFile(path.join(directory, "deploy.liftoscript"), source, "utf8"),
    writeFile(path.join(directory, "deployment-manifest.json"), `${JSON.stringify({
      preparedAt: "2025-01-01T00:00:00.000Z",
      target: { id: "program-1", sourceSha256: sha256(current) },
      deployment: { sourceSha256: sha256(source) },
    }, null, 2)}\n`, "utf8"),
  ]);
  return directory;
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("historical restore rewinds the exact artifact while preserving the displaced live source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-restore-test-"));
  const bundle = await artifact(root);
  let programName = "Keep this name";
  let programText = current;
  let writes = 0;
  const server = createServer(async (request, response) => {
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
      writes += 1;
      const body = JSON.parse(await requestBody(request));
      programName = body.name;
      programText = body.text;
      response.end(JSON.stringify({
        data: { id: "program-1", name: programName, text: programText, isCurrent: true },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
    const report = await restoreDeploymentArtifact({
      artifactDirectory: bundle,
      apiKey,
      apiBase,
    });
    assert.equal(report.status, "restored");
    assert.equal(report.target.id, "program-1");
    assert.equal(programName, "Keep this name");
    assert.equal(programText, historical);
    assert.equal(writes, 1);
    assert.equal(
      await readFile(path.join(report.recoveryDirectory, "pre-restore.liftoscript"), "utf8"),
      current
    );

    const repeated = await restoreDeploymentArtifact({
      artifactDirectory: bundle,
      apiKey,
      apiBase,
    });
    assert.equal(repeated.status, "already-restored");
    assert.equal(repeated.recoveryDirectory, null);
    assert.equal(writes, 1);

    await rm(report.recoveryDirectory, { recursive: true, force: true });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test("historical restore rejects a corrupted deployment source before contacting Liftosaur", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-restore-corrupt-"));
  try {
    const bundle = await artifact(root);
    await writeFile(path.join(bundle, "deploy.liftoscript"), "# Corrupt\n\n\n", "utf8");
    await assert.rejects(
      restoreDeploymentArtifact({ artifactDirectory: bundle, apiKey, apiBase: "http://127.0.0.1:1" }),
      /source hash disagrees/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
