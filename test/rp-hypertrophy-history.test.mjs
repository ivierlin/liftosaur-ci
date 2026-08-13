import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeLiftosaurSources } from "../src/merge.mjs";
import {
  assertCanonicalLiftosaurSource,
  canonicalizeLiftosaurSource,
} from "../src/source-format.mjs";
import { validateLiftosaurSource } from "../src/validate.mjs";
import { runCli } from "./helpers/run-cli.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(testDirectory, "fixtures", "rp-hypertrophy-history");
const provenance = JSON.parse(await readFile(
  path.join(fixtureDirectory, "provenance.json"),
  "utf8"
));
const sources = new Map(await Promise.all(provenance.programs.map(async (program) => [
  program.version,
  await readFile(path.join(fixtureDirectory, program.fixture), "utf8"),
])));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function progressedSource(source) {
  const statement = /^(?!.*used: none).*progress: custom\([^\n]*mesoWeek: 1.*$/m.exec(source);
  assert.ok(statement, "Historical source has no exercise mesoWeek state");
  const offset = statement.index + statement[0].indexOf("mesoWeek: 1");
  return `${source.slice(0, offset)}mesoWeek: 2${source.slice(offset + "mesoWeek: 1".length)}`;
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

test("historical RP Hypertrophy fixtures match their reviewed public sources", () => {
  assert.deepEqual(
    provenance.programs.map(({ version, sourceSha256 }) => ({
      version,
      sourceSha256: sha256(sources.get(version)),
    })),
    provenance.programs.map(({ version, sourceSha256 }) => ({ version, sourceSha256 }))
  );
  for (const source of sources.values()) {
    assert.equal(source.includes("\r"), false);
  }
});

for (const { from, to, marker } of [
  { from: "v2", to: "v3", marker: "AUTO_DOWN_SET_MODE_HYP" },
  { from: "v4", to: "v4.1", marker: "DEFAULT_NONZERO_INCREMENT" },
]) {
  test(`real RP Hypertrophy update preserves progression from ${from} to ${to}`, async () => {
    const base = sources.get(from);
    const candidate = sources.get(to);
    assert.equal(base.includes(marker), false);
    assert.equal(candidate.includes(marker), true);

    const result = await mergeLiftosaurSources({
      base,
      active: progressedSource(base),
      candidate,
    });

    assert.equal(result.report.status, "merged");
    assert.ok(result.source);
    assert.equal(result.source.includes("mesoWeek: 2"), true);
    assert.equal(result.source.includes(marker), true);
    assert.doesNotThrow(() => validateLiftosaurSource(result.source));
  });
}

test("real RP Hypertrophy v3 to v4 update fails closed at the documented rename", async () => {
  const result = await mergeLiftosaurSources({
    base: sources.get("v3"),
    active: progressedSource(sources.get("v3")),
    candidate: sources.get("v4"),
  });

  assert.equal(result.source, null);
  assert.equal(result.report.status, "conflict");
  assert.equal(result.report.blockFallback?.stage, "block-removal");
  assert.match(result.report.blockFallback?.blockKey ?? "", /tLogic: Squat/);
});

test("real RP Hypertrophy v4 to v4.1 survives the Git and API update round trip byte-exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-rp-history-"));
  const repository = path.join(root, "repository");
  const programFile = path.join(repository, "programs", "rp-hypertrophy.liftoscript");
  const configFile = path.join(repository, "liftosaur-ci.json");
  const apiKey = "lftsk_rp_history_secret";
  let program = {
    id: "rp-history",
    name: "RP Hypertrophy 4-Day Upper/Lower",
    text: canonicalizeLiftosaurSource(progressedSource(sources.get("v4"))),
    isCurrent: true,
  };
  let uploadedSource = null;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { code: "unauthorized", message: "Bad token" } }));
      return;
    }
    if (request.method === "GET" && ["/api/v1/programs/current", "/api/v1/programs/rp-history"].includes(request.url)) {
      response.end(JSON.stringify({ data: program }));
      return;
    }
    if (request.method === "PUT" && request.url === "/api/v1/programs/rp-history") {
      const update = JSON.parse(await requestBody(request));
      uploadedSource = update.text;
      program = { ...program, name: update.name, text: update.text };
      response.end(JSON.stringify({ data: program }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/v1`;
  const previousCwd = process.cwd();

  try {
    await mkdir(path.dirname(programFile), { recursive: true });
    const remote = path.join(root, "remote.git");
    git(root, ["init", "--bare", remote]);
    git(repository, ["init"]);
    git(repository, ["remote", "add", "origin", "https://github.com/example/rp-hypertrophy.git"]);
    git(repository, ["remote", "set-url", "--push", "origin", remote]);
    await Promise.all([
      writeFile(programFile, sources.get("v4"), "utf8"),
      writeFile(configFile, `${JSON.stringify({
        deployments: {
          program: {
            program: "programs/rp-hypertrophy.liftoscript",
          },
        },
      }, null, 2)}\n`, "utf8"),
    ]);
    git(repository, ["add", "."]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "v4"]);
    const baseSha = git(repository, ["rev-parse", "HEAD"]);
    await writeFile(programFile, sources.get("v4.1"), "utf8");
    git(repository, ["add", "programs/rp-hypertrophy.liftoscript"]);
    git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "v4.1"]);

    process.chdir(repository);
    const result = await runCli([
      "update",
      "--base-ref", baseSha,
      "--api-base", apiBase,
    ], { ...process.env, LIFTOSAUR_API_KEY: apiKey });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(uploadedSource);
    assert.equal(program.text, uploadedSource);
    assert.equal(sha256(program.text), sha256(uploadedSource));
    assert.equal(program.text.includes("mesoWeek: 2"), true);
    assert.equal(program.text.includes("DEFAULT_NONZERO_INCREMENT"), true);
    assert.doesNotThrow(() => assertCanonicalLiftosaurSource(program.text, "API read-back source"));
  } finally {
    process.chdir(previousCwd);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(root, { recursive: true, force: true });
  }
});
