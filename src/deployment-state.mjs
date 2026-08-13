import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { configuredDeployment } from "./config.mjs";

function git(repository, args, label, { allowMissing = false } = {}) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowMissing) return null;
    throw new Error(`${label}: ${result.stderr.trim() || `git exited with ${result.status}`}`);
  }
  return result.stdout.trim();
}

export function deploymentRef(deploymentId) {
  return `refs/liftosaur-ci/deployments/${deploymentId}`;
}

export function readDeploymentRef(repository, deploymentId) {
  return git(repository, ["rev-parse", "--verify", "--end-of-options", `${deploymentRef(deploymentId)}^{commit}`],
    `Cannot resolve deployment ref for ${deploymentId}`, { allowMissing: true });
}

export async function configuredGitPreparation({
  configFile, deploymentId = null, candidateRef = "HEAD", baseRef = null, repository = null,
}) {
  const { config, deployment } = await configuredDeployment(configFile, deploymentId);
  const root = path.resolve(repository ?? config.root);
  const trackedCommit = readDeploymentRef(root, deployment.id);
  if (trackedCommit && !deployment.programId) {
    throw new Error(`Deployment ${deployment.id} is initialized but has no exact programId; merge or recreate its target-binding PR before deploying again`);
  }
  if (!trackedCommit && !baseRef) {
    throw new Error(`Deployment ${deployment.id} has no deployment ref; provide --base-ref for the first preparation`);
  }
  const resolvedBase = trackedCommit ?? baseRef;
  const candidateCommit = git(root, ["rev-parse", "--verify", "--end-of-options", `${candidateRef}^{commit}`], "Cannot resolve candidate ref");
  const baseBlob = git(root, ["rev-parse", "--verify", "--end-of-options", `${resolvedBase}:${deployment.program}`], "Cannot resolve deployed program blob");
  const candidateBlob = git(root, ["rev-parse", "--verify", "--end-of-options", `${candidateCommit}:${deployment.program}`], "Cannot resolve candidate program blob");
  return {
    repository: root, baseRef: resolvedBase, candidateRef, programPath: deployment.program,
    programId: deployment.programId ?? "current", expectedBase: trackedCommit ? { commitSha: trackedCommit, blobSha: baseBlob } : null,
    expectedRefSha: trackedCommit, deploymentRef: deploymentRef(deployment.id), deploymentId: deployment.id,
    deploymentRequired: !trackedCommit || baseBlob !== candidateBlob,
    targetBindingRequired: !deployment.programId,
  };
}

function requireReport(report, deployment, expectedRefSha) {
  if (!report || report.command !== "deploy" || report.deploymentPerformed !== true || !report.deployedAt) {
    throw new Error("Deployment report does not record a verified deployment");
  }
  if (deployment.programId && report.target?.id !== deployment.programId) {
    throw new Error("Deployment report target does not match configured deployment");
  }
  if (!report.source || report.source.programPath !== deployment.program) {
    throw new Error("Deployment report lacks matching Git provenance");
  }
  if (expectedRefSha && report.source.base?.commitSha !== expectedRefSha) {
    throw new Error("Deployment report base does not match the expected deployment ref");
  }
  return report.source.candidate?.commitSha;
}

export async function recordDeploymentState({ configFile, deploymentId = null, reportFile, repository = null }) {
  const { config, deployment } = await configuredDeployment(configFile, deploymentId);
  const root = path.resolve(repository ?? config.root);
  const ref = deploymentRef(deployment.id);
  const expected = readDeploymentRef(root, deployment.id);
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  const candidate = requireReport(report, deployment, expected);
  if (!/^[a-f0-9]{40,64}$/.test(candidate ?? "")) throw new Error("Deployment report has invalid candidate provenance");
  const lease = expected ? `--force-with-lease=${ref}:${expected}` : `--force-with-lease=${ref}:`;
  git(root, ["push", lease, "origin", `${candidate}:${ref}`],
    `Verified deployment succeeded, but recording ${ref} failed; retain the deployment receipt and retry record-deployment`);
  return { ref, previousCommitSha: expected, commitSha: candidate, deploymentId: deployment.id, targetId: report.target.id };
}
