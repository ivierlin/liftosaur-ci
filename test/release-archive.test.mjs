import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { strToU8, unzipSync, zipSync } from "fflate";

import {
  createUpdateArchive,
  defaultUpdateArchiveStateDirectory,
  readUpdateArchive,
  updateFromArchive,
} from "../src/release-archive.mjs";
import { rollbackRecoveryDirectory } from "../src/rollback.mjs";

const apiKey = "lftsk_archive_secret";

function source({ volume = 2, timer = 120 } = {}) {
  return `# Week 1
## Day A
Squat / 3x5 100kg / ${timer}s / progress: custom(volume: ${volume}) {~ state.volume = state.volume ~}


`;
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

test("archive update state uses durable operating-system data locations", () => {
  assert.equal(
    defaultUpdateArchiveStateDirectory({
      platform: "win32",
      environment: { LOCALAPPDATA: "C:\\Data" },
      homeDirectory: "C:\\Home",
    }),
    path.join("C:\\Data", "liftosaur-ci", "update-state")
  );
  assert.equal(
    defaultUpdateArchiveStateDirectory({
      platform: "linux",
      environment: { XDG_STATE_HOME: "/state" },
      homeDirectory: "/home/user",
    }),
    path.join("/state", "liftosaur-ci", "update-state")
  );
});

test("release archives reject unexpected files before extracting them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-archive-invalid-"));
  const archive = path.join(root, "invalid.zip");
  try {
    await writeFile(archive, zipSync({
      "../outside.txt": strToU8("not allowed"),
    }));
    await assert.rejects(readUpdateArchive(archive), /unexpected file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("published archive updates preserve progression and enforce the source chain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-archive-update-"));
  const firstBase = path.join(root, "v4.liftoscript");
  const firstCandidate = path.join(root, "v4.1.liftoscript");
  const secondCandidate = path.join(root, "v4.2.liftoscript");
  const thirdCandidate = path.join(root, "v4.3.liftoscript");
  const firstArchive = path.join(root, "rp-hypertrophy-v4-to-v4.1.zip");
  const secondArchive = path.join(root, "rp-hypertrophy-v4.1-to-v4.2.zip");
  const thirdArchive = path.join(root, "rp-hypertrophy-v4.2-to-v4.3.zip");
  const stateDirectory = path.join(root, "state");
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

  try {
    await Promise.all([
      writeFile(firstBase, source(), "utf8"),
      writeFile(firstCandidate, source({ timer: 180 }), "utf8"),
      writeFile(secondCandidate, source({ timer: 240 }), "utf8"),
      writeFile(thirdCandidate, source({ timer: 300 }), "utf8"),
    ]);
    await createUpdateArchive({
      outputFile: firstArchive,
      previousFile: firstBase,
      newFile: firstCandidate,
    });
    const reviewed = await readUpdateArchive(firstArchive);
    assert.match(reviewed.previousSha256, /^[a-f0-9]{64}$/);
    assert.match(reviewed.candidateSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(reviewed.previousSha256, reviewed.candidateSha256);
    const archiveFiles = Object.keys(unzipSync(await readFile(firstArchive))).sort();
    assert.deepEqual(archiveFiles, ["new.liftoscript", "previous.liftoscript"]);

    const firstUpdate = await updateFromArchive({
      archiveFile: firstArchive,
      stateDirectory,
      apiKey,
      apiBase,
    });
    assert.equal(firstUpdate.target.id, "program-1");
    assert.match(program.text, /180s/);
    assert.match(program.text, /volume: 3/);
    let state = JSON.parse(await readFile(firstUpdate.stateFile, "utf8"));
    assert.deepEqual(state, {
      programId: "program-1",
      sourceSha256: reviewed.candidateSha256,
    });

    requests.length = 0;
    await assert.rejects(
      updateFromArchive({ archiveFile: firstArchive, stateDirectory, apiKey, apiBase }),
      /does not continue any tracked program/
    );
    assert.equal(requests.length, 0);

    await createUpdateArchive({
      outputFile: secondArchive,
      previousFile: firstCandidate,
      newFile: secondCandidate,
    });
    requests.length = 0;
    const secondUpdate = await updateFromArchive({
      archiveFile: secondArchive,
      stateDirectory,
      apiKey,
      apiBase,
    });
    assert.deepEqual(requests.map(([, url]) => url), [
      "/api/v1/programs/program-1",
      "/api/v1/programs/program-1",
      "/api/v1/programs/program-1",
      "/api/v1/programs/program-1",
    ]);
    assert.match(program.text, /240s/);
    assert.match(program.text, /volume: 3/);
    assert.equal(secondUpdate.stateFile, firstUpdate.stateFile);
    state = JSON.parse(await readFile(firstUpdate.stateFile, "utf8"));
    const secondReviewed = await readUpdateArchive(secondArchive);
    assert.deepEqual(state, {
      programId: "program-1",
      sourceSha256: secondReviewed.candidateSha256,
    });

    await createUpdateArchive({
      outputFile: thirdArchive,
      previousFile: secondCandidate,
      newFile: thirdCandidate,
    });
    requests.length = 0;
    await updateFromArchive({
      archiveFile: thirdArchive,
      stateDirectory,
      programId: "program-1",
      apiKey,
      apiBase,
    });
    assert.match(program.text, /300s/);
    assert.match(program.text, /volume: 3/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit receipt retains a complete rollback directory after an ambiguous write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-archive-recovery-"));
  const previousFile = path.join(root, "previous-source.liftoscript");
  const newFile = path.join(root, "new-source.liftoscript");
  const archiveFile = path.join(root, "update.zip");
  const receiptDirectory = path.join(root, "retained-recovery");
  let program = {
    id: "program-1",
    name: "Keep this name",
    text: source({ volume: 3 }),
    isCurrent: true,
  };
  let writes = 0;
  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
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
      writes += 1;
      const update = JSON.parse(body);
      program = writes === 1
        ? { ...program, text: source({ volume: 9, timer: 999 }) }
        : { ...program, name: update.name, text: update.text };
      response.end(JSON.stringify({ data: program }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;

  try {
    await Promise.all([
      writeFile(previousFile, source(), "utf8"),
      writeFile(newFile, source({ timer: 180 }), "utf8"),
    ]);
    await createUpdateArchive({ outputFile: archiveFile, previousFile, newFile });
    let failure;
    try {
      await updateFromArchive({
        archiveFile,
        receiptDirectory,
        stateDirectory: path.join(root, "state"),
        apiKey,
        apiBase,
      });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? "", /ambiguous/);
    assert.equal(failure?.recoveryDirectory, path.resolve(receiptDirectory));
    await Promise.all([
      readFile(path.join(receiptDirectory, "bundle", "deployment-manifest.json"), "utf8"),
      readFile(path.join(receiptDirectory, "record", "deployment-report.json"), "utf8"),
    ]);

    const rollback = await rollbackRecoveryDirectory({
      recoveryDirectory: receiptDirectory,
      apiKey,
      apiBase,
    });
    assert.equal(rollback.status, "rolled-back");
    assert.match(program.text, /120s/);
    assert.match(program.text, /volume: 3/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
