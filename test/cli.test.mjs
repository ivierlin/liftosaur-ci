import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "./helpers/run-cli.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const cli = path.join(repositoryRoot, "bin", "liftosaur-ci.mjs");
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);

const source = ({ volume = 2, timer = 120 } = {}) => `# Week 1
## Day A
Squat / 3x5 100kg / ${timer}s / progress: custom(volume: ${volume}) {~ state.volume = state.volume ~}
`;

function run(args) {
  return runCli(args, { ...process.env, LIFTOSAUR_RUNTIME: runtime });
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "liftosaur-ci-cli-"));
  const paths = Object.fromEntries(
    ["base", "active", "candidate", "output", "report", "scenario"].map((name) => [
      name,
      path.join(directory, `${name}.${["report", "scenario"].includes(name) ? "json" : "liftoscript"}`),
    ])
  );
  await Promise.all([
    writeFile(paths.base, source(), "utf8"),
    writeFile(paths.active, source({ volume: 3 }), "utf8"),
    writeFile(paths.candidate, source({ timer: 180 }), "utf8"),
  ]);
  return { directory, paths };
}

test("CLI exposes every command without loading the Liftosaur runtime", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: {} });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /liftosaur-ci merge/);
  assert.match(result.stdout, /liftosaur-ci validate/);
  assert.match(result.stdout, /liftosaur-ci snapshot/);
  assert.match(result.stdout, /liftosaur-ci prepare-deployment/);
  assert.match(result.stdout, /liftosaur-ci prepare \\/);
  assert.match(result.stdout, /liftosaur-ci prepare-git/);
  assert.match(result.stdout, /liftosaur-ci deploy/);
  assert.match(result.stdout, /liftosaur-ci record-deployment/);
  assert.match(result.stdout, /liftosaur-ci check/);

  const commandHelp = spawnSync(process.execPath, [cli, "merge", "--help"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.equal(commandHelp.stdout, result.stdout);
});

test("offline CLI writes a checksum-bound reviewed scenario snapshot", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.scenario, `${JSON.stringify({
      name: "reviewed nominal",
      day: 1,
      entries: [{
        exercise: "Squat",
        sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }],
      }],
    }, null, 2)}\n`, "utf8");
    const result = await run([
      "snapshot", "--program", paths.base,
      "--scenario", paths.scenario, "--output", paths.output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(await readFile(paths.output, "utf8"));
    assert.equal(snapshot.command, "snapshot");
    assert.equal(snapshot.scenario.name, "reviewed nominal");
    assert.equal(snapshot.inputs.program.sha256.length, 64);
    assert.equal(snapshot.inputs.scenario.sha256.length, 64);
    assert.equal(snapshot.progressedSource.sha256.length, 64);
    assert.equal(snapshot.nextExposure.entries[0].sets.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI writes an ordered multi-exposure snapshot", async () => {
  const { directory, paths } = await fixture();
  try {
    const entries = [{
      exercise: "Squat",
      sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }],
    }];
    await writeFile(paths.scenario, `${JSON.stringify({
      name: "reviewed sequence",
      steps: [
        { name: "first", day: 1, entries },
        { name: "second", day: 1, entries },
      ],
    }, null, 2)}\n`, "utf8");
    const result = await run([
      "snapshot", "--program", paths.base,
      "--scenario", paths.scenario, "--output", paths.output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(await readFile(paths.output, "utf8"));
    assert.equal(
      snapshot.runtimeRevision,
      "f9c1b1453aaa22ab177d8e7473da08d707c28b60"
    );
    assert.deepEqual(snapshot.steps.map(({ index, name, day }) => ({ index, name, day })), [
      { index: 1, name: "first", day: 1 },
      { index: 2, name: "second", day: 1 },
    ]);
    assert.equal(snapshot.progressedSource.sha256.length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI validates immutable input and records checksums", async () => {
  const { directory, paths } = await fixture();
  try {
    const result = await run([
      "validate", "--program", paths.base, "--report", paths.report,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.equal(report.status, "passed");
    assert.equal(report.command, "validate");
    assert.equal(report.input.sha256.length, 64);
    assert.equal(report.serialized.sha256.length, 64);
    assert.deepEqual(report.summary, {
      days: 1,
      exercises: 1,
      sets: 3,
      completedDays: 1,
      completedSets: 3,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI writes a failed validation report", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.base, `# Week 1\n## Day A\nSquat / not-a-prescription\n`, "utf8");
    const result = await run([
      "validate", "--program", paths.base, "--report", paths.report,
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.equal(report.status, "failed");
    assert.ok(["parse", "evaluate"].includes(report.failure.stage));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI reports finish-script failures", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.base, `# Week 1
## Day A
base / used: none / 1x5 / progress: lp(5lb)
Squat / ...base / progress: none
`, "utf8");
    const result = await run([
      "validate", "--program", paths.base, "--report", paths.report,
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.equal(report.failure.stage, "lifecycle-finish");
    assert.match(report.failure.message, /successCounter/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI refuses to overwrite an existing validation report", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.report, "keep me\n", "utf8");
    const result = await run([
      "validate", "--program", paths.base, "--report", paths.report,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.equal(await readFile(paths.report, "utf8"), "keep me\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI merges immutable inputs and records checksums", async () => {
  const { directory, paths } = await fixture();
  try {
    const result = await run([
      "merge", "--base", paths.base, "--active", paths.active,
      "--candidate", paths.candidate, "--output", paths.output, "--report", paths.report,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(paths.output, "utf8");
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.match(output, /180s/);
    assert.match(output, /volume: 3/);
    assert.equal(report.status, "merged");
    assert.equal(report.command, "merge");
    assert.equal(report.output.sha256.length, 64);
    assert.equal(report.merge.status, "merged");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI reports conflicts without writing a merged program", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.candidate, source({ volume: 4 }), "utf8");
    const result = await run([
      "merge", "--base", paths.base, "--active", paths.active,
      "--candidate", paths.candidate, "--output", paths.output, "--report", paths.report,
    ]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unresolved three-way merge conflicts/);
    await assert.rejects(readFile(paths.output), { code: "ENOENT" });
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.equal(report.status, "conflict");
    assert.equal(report.output, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI refuses to overwrite an existing output", async () => {
  const { directory, paths } = await fixture();
  try {
    await writeFile(paths.output, "keep me\n", "utf8");
    const result = await run([
      "merge", "--base", paths.base, "--active", paths.active,
      "--candidate", paths.candidate, "--output", paths.output,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.equal(await readFile(paths.output, "utf8"), "keep me\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline CLI removes a new output when its requested report cannot be written", async () => {
  const { directory, paths } = await fixture();
  try {
    const missingReport = path.join(directory, "missing", "report.json");
    const result = await run([
      "merge", "--base", paths.base, "--active", paths.active,
      "--candidate", paths.candidate, "--output", paths.output, "--report", missingReport,
    ]);
    assert.equal(result.status, 1);
    await assert.rejects(readFile(paths.output), { code: "ENOENT" });
    await assert.rejects(readFile(missingReport), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
