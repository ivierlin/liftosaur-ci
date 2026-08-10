import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const cli = path.join(repositoryRoot, "bin", "liftosaur-ci.mjs");
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);

const source = ({ volume = 2, timer = 120 } = {}) => `# Week 1
## Day A
Squat / 3x5 100kg / timer: ${timer} / progress: custom(volume: ${volume}) {~ state.volume = state.volume ~}
`;

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, LIFTOSAUR_RUNTIME: runtime },
  });
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "liftosaur-ci-cli-"));
  const paths = Object.fromEntries(
    ["base", "active", "candidate", "output", "report"].map((name) => [
      name,
      path.join(directory, `${name}.${name === "report" ? "json" : "liftoscript"}`),
    ])
  );
  await Promise.all([
    writeFile(paths.base, source(), "utf8"),
    writeFile(paths.active, source({ volume: 3 }), "utf8"),
    writeFile(paths.candidate, source({ timer: 180 }), "utf8"),
  ]);
  return { directory, paths };
}

test("offline CLI exposes help without loading the Liftosaur runtime", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env: {} });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /liftosaur-ci merge/);
  assert.match(result.stdout, /Offline only/);

  const commandHelp = spawnSync(process.execPath, [cli, "merge", "--help"], {
    encoding: "utf8",
    env: {},
  });
  assert.equal(commandHelp.status, 0, commandHelp.stderr);
  assert.equal(commandHelp.stdout, result.stdout);
});

test("offline CLI merges immutable inputs and records checksums", async () => {
  const { directory, paths } = await fixture();
  try {
    const result = run([
      "merge", "--base", paths.base, "--active", paths.active,
      "--candidate", paths.candidate, "--output", paths.output, "--report", paths.report,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(paths.output, "utf8");
    const report = JSON.parse(await readFile(paths.report, "utf8"));
    assert.match(output, /timer: 180/);
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
    const result = run([
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
    const result = run([
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
    const result = run([
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
