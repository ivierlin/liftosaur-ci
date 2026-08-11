import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { configuredDeployment } from "./config.mjs";

export const LIFTOSAUR_DEPLOYMENT_STATE = Object.freeze({
  formatVersion: 2,
  implementation: "liftosaur-deployment-state-v2",
});

function statePath(config, deploymentId) {
  return path.join(config.root, ".liftosaur-ci", "deployments", `${deploymentId}.json`);
}

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function validateState(state, deploymentId) {
  requireObject(state, "Deployment state");
  if (
    state.formatVersion !== LIFTOSAUR_DEPLOYMENT_STATE.formatVersion
    || state.implementation !== LIFTOSAUR_DEPLOYMENT_STATE.implementation
    || !/^[a-f0-9]{40,64}$/.test(state.commitSha ?? "")
    || !/^[a-f0-9]{40,64}$/.test(state.blobSha ?? "")
  ) {
    throw new Error(`Deployment state is invalid for ${deploymentId}`);
  }
  return state;
}

async function readState(config, deploymentId) {
  const file = statePath(config, deploymentId);
  try {
    const text = await readFile(file, "utf8");
    return { file, state: validateState(parseJson(text, "Deployment state"), deploymentId) };
  } catch (error) {
    if (error?.code === "ENOENT") return { file, state: null };
    throw error;
  }
}

export async function configuredGitPreparation({
  configFile,
  deploymentId,
  candidateRef,
  baseRef = null,
  repository = null,
}) {
  if (!candidateRef) throw new Error("Candidate Git ref is required");
  const { config, deployment } = await configuredDeployment(configFile, deploymentId);
  const tracked = await readState(config, deploymentId);
  if (!tracked.state && !baseRef) {
    throw new Error(`Deployment ${deploymentId} has no tracked base; provide --base-ref for the first preparation`);
  }
  return {
    repository: path.resolve(repository ?? config.root),
    baseRef: baseRef ?? tracked.state.commitSha,
    candidateRef,
    programPath: deployment.program,
    programId: deployment.programId,
    deployedProgramName: deployment.deployedProgramName,
    expectedBase: tracked.state,
    stateFile: tracked.file,
  };
}

export async function recordDeploymentState({
  configFile,
  deploymentId,
  reportFile,
}) {
  const { config, deployment } = await configuredDeployment(configFile, deploymentId);
  const report = parseJson(await readFile(reportFile, "utf8"), "Deployment report");
  requireObject(report, "Deployment report");
  if (report.command !== "deploy" || report.deploymentPerformed !== true || !report.deployedAt) {
    throw new Error("Deployment report does not record a verified deployment");
  }
  if (deployment.programId !== "current" && report.target?.id !== deployment.programId) {
    throw new Error("Deployment report target does not match configured deployment");
  }
  const source = report.source;
  if (
    source?.implementation !== "liftosaur-git-source-v1"
    || source.programPath !== deployment.program
  ) {
    throw new Error("Deployment report lacks matching Git provenance");
  }
  const tracked = await readState(config, deploymentId);
  if (tracked.state && (
    tracked.state.commitSha !== source.base?.commitSha
    || tracked.state.blobSha !== source.base?.blobSha
  )) {
    throw new Error("Deployment report base does not match tracked deployment state");
  }
  const state = validateState({
    ...LIFTOSAUR_DEPLOYMENT_STATE,
    commitSha: source.candidate?.commitSha,
    blobSha: source.candidate?.blobSha,
  }, deploymentId);
  await mkdir(path.dirname(tracked.file), { recursive: true });
  const temporary = `${tracked.file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
    await rename(temporary, tracked.file);
  } finally {
    await rm(temporary, { force: true });
  }
  return { file: tracked.file, state };
}
