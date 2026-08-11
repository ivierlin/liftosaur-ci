import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { configuredGitPreparation, recordDeploymentState } from "./deployment-state.mjs";
import { deployPreparedBundle } from "./deployment.mjs";
import { prepareGitDeployment } from "./git.mjs";

export async function updateConfiguredGitDeployment({
  configFile = path.resolve("liftosaur-ci.json"),
  deploymentId = null,
  baseRef = null,
  repository = null,
  apiKey,
  apiBase,
}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "liftosaur-ci-update-"));
  const bundleDirectory = path.join(temporary, "bundle");
  const recordDirectory = path.join(temporary, "record");
  let deploymentStarted = false;
  try {
    const preparation = await configuredGitPreparation({
      configFile,
      deploymentId,
      candidateRef: "HEAD",
      baseRef,
      repository,
    });
    const prepared = await prepareGitDeployment({
      repository: preparation.repository,
      baseRef: preparation.baseRef,
      candidateRef: preparation.candidateRef,
      programPath: preparation.programPath,
      outputDirectory: bundleDirectory,
      programId: preparation.programId,
      expectedBase: preparation.expectedBase,
      apiKey,
      apiBase,
    });
    deploymentStarted = true;
    const report = await deployPreparedBundle({
      bundleDirectory,
      outputDirectory: recordDirectory,
      apiKey,
      expectedProgramId: prepared.manifest.target.id,
      apiBase,
    });
    const state = await recordDeploymentState({
      configFile,
      deploymentId: preparation.deploymentId,
      reportFile: path.join(recordDirectory, "deployment-report.json"),
    });
    await rm(temporary, { recursive: true, force: true });
    return {
      target: report.target,
      candidateCommitSha: prepared.manifest.source.candidate.commitSha,
      stateFile: state.file,
    };
  } catch (error) {
    if (!deploymentStarted) {
      await rm(temporary, { recursive: true, force: true });
    } else if (error && typeof error === "object") {
      error.recoveryDirectory = temporary;
    }
    throw error;
  }
}
