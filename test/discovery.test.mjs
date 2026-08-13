import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadLiftosaurConfig } from "../src/config.mjs";

test("missing default config discovers exactly one root-level liftoscript", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liftosaur-discovery-test-"));
  const configFile = path.join(root, "liftosaur-ci.json");
  const first = path.join(root, "program.liftoscript");
  const second = path.join(root, "other.liftoscript");
  try {
    await writeFile(first, "# Week 1\n## Day A\nSquat / 1x5\n");
    const discovered = await loadLiftosaurConfig(configFile);
    assert.equal(discovered.discovered, true);
    assert.deepEqual(discovered.deployments, { program: { program: "program.liftoscript" } });

    await writeFile(second, "# Week 1\n## Day A\nBench Press / 1x5\n");
    await assert.rejects(loadLiftosaurConfig(configFile), /Multiple root-level/);

    await rm(first);
    await rm(second);
    await mkdir(path.join(root, "programs"));
    await writeFile(path.join(root, "programs", "nested.liftoscript"), "# Week 1\n## Day A\nSquat / 1x5\n");
    await assert.rejects(loadLiftosaurConfig(configFile), /No liftosaur-ci.json or root-level/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
