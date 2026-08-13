import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkRepository } from "../src/check.mjs";
import { createScenarioSnapshot } from "../src/report.mjs";
import { snapshotLiftosaurScenario } from "../src/validate.mjs";

const source = "# Week 1\n## Day A\nSquat / 3x5 100kg\n";
const scenario = {
  name: "nominal",
  day: 1,
  entries: [{ exercise: "Squat", sets: [{ reps: 5 }, { reps: 5 }, { reps: 5 }] }],
};

async function makeRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-check-"));
  await Promise.all([
    mkdir(path.join(root, "programs")),
    mkdir(path.join(root, "scenarios")),
  ]);
  const scenarioText = `${JSON.stringify(scenario, null, 2)}\n`;
  const snapshot = createScenarioSnapshot(
    source,
    scenarioText,
    snapshotLiftosaurScenario(source, scenario)
  );
  await Promise.all([
    writeFile(path.join(root, "programs", "example.liftoscript"), source, "utf8"),
    writeFile(path.join(root, "scenarios", "nominal.json"), scenarioText, "utf8"),
    writeFile(path.join(root, "scenarios", "nominal.expected.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
  ]);
  const configFile = path.join(root, "liftosaur-ci.json");
  await writeFile(configFile, `${JSON.stringify({
    scenarios: [{
      program: "programs/example.liftoscript",
      scenario: "scenarios/nominal.json",
      snapshot: "scenarios/nominal.expected.json",
    }],
  }, null, 2)}\n`, "utf8");
  return { root, configFile };
}

test("repository check validates programs referenced directly by scenarios", async () => {
  const { root, configFile } = await makeRepository();
  try {
    const report = await checkRepository(configFile);
    assert.equal(report.status, "passed", JSON.stringify(report, null, 2));
    assert.deepEqual(report.summary, { programs: 1, passed: 1, failed: 0, scenarios: 1 });
    assert.equal(report.programs[0].program, "programs/example.liftoscript");
    assert.equal(report.programs[0].scenarios[0].status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository check ignores only the snapshot producer version", async () => {
  const { root, configFile } = await makeRepository();
  try {
    const snapshotFile = path.join(root, "scenarios", "nominal.expected.json");
    const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
    snapshot.cli.version = "0.0.0";
    await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const report = await checkRepository(configFile);
    assert.equal(report.status, "passed", JSON.stringify(report, null, 2));

    snapshot.cli.name = "different-tool";
    await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const changedIdentity = await checkRepository(configFile);
    assert.equal(changedIdentity.status, "failed");
    assert.equal(
      changedIdentity.programs[0].scenarios[0].failure.difference.path,
      "$.cli.name"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository check reports changed snapshots without rewriting them", async () => {
  const { root, configFile } = await makeRepository();
  try {
    const snapshotFile = path.join(root, "scenarios", "nominal.expected.json");
    await writeFile(snapshotFile, "{}\n", "utf8");
    const report = await checkRepository(configFile);
    assert.equal(report.status, "failed");
    assert.equal(report.programs[0].status, "failed");
    assert.match(report.programs[0].scenarios[0].failure.message, /Reviewed snapshot changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository check rejects unknown scenario fields", async () => {
  const { root, configFile } = await makeRepository();
  try {
    const scenarioFile = path.join(root, "scenarios", "nominal.json");
    await writeFile(scenarioFile, `${JSON.stringify({ ...scenario, typo: true }, null, 2)}\n`, "utf8");
    const report = await checkRepository(configFile);
    assert.equal(report.status, "failed");
    assert.match(report.programs[0].scenarios[0].failure.message, /unsupported keys: typo/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository check rejects paths outside the config directory", async () => {
  const { root, configFile } = await makeRepository();
  try {
    await writeFile(configFile, `${JSON.stringify({
      programs: ["../*.liftoscript"],
    })}\n`, "utf8");
    await assert.rejects(checkRepository(configFile), /must stay inside the repository/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
