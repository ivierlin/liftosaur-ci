import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { configuredDeployment } from "./config.mjs";
import { deploymentRef, readDeploymentRef } from "./deployment-state.mjs";
import { fetchDeploymentTarget } from "./deployment.mjs";
import { validateLiftosaurSource } from "./validate.mjs";

function git(repository, args, label, { buffer = false } = {}) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: buffer ? null : "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = buffer ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(`${label}: ${stderr.trim() || `git exited with ${result.status}`}`);
  }
  return buffer ? result.stdout : result.stdout.trim();
}

function exactCommit(repository, ref, label) {
  if (typeof ref !== "string" || !ref || /[\r\n\0]/.test(ref)) throw new Error(`${label} is invalid`);
  return git(repository, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], `Cannot resolve ${label}`);
}

function programBlob(repository, commit, programPath) {
  const blob = git(repository, ["rev-parse", "--verify", "--end-of-options", `${commit}:${programPath}`], "Cannot resolve candidate program blob");
  if (git(repository, ["cat-file", "-t", blob], "Cannot inspect candidate program") !== "blob") {
    throw new Error(`Candidate program is not a regular Git blob: ${programPath}`);
  }
  return git(repository, ["cat-file", "blob", blob], "Cannot read candidate program", { buffer: true });
}

function configWriteRecovery({ error, canonical, verifiedBaseRevision }) {
  if (!verifiedBaseRevision) {
    return new Error(`${error.message}\nThe release branch moved or rejected the config-only commit. No Liftosaur write or deployment ref was created. Rerun after the branch is current, or pin liftosaur-ci.json manually and use the advanced base_ref route.`);
  }
  return new Error([
    error.message,
    "Initialization verified successfully, but liftosaur-ci could not record liftosaur-ci.json on the release branch.",
    "The branch may be protected, a ruleset or token policy may reject direct writes, or the branch may have moved concurrently.",
    "No Liftosaur write or deployment ref was created.",
    "",
    "Create liftosaur-ci.json on the current release branch with this complete canonical content, commit it, and push it:",
    "",
    JSON.stringify(canonical, null, 2),
    "",
    `Base Git revision: ${verifiedBaseRevision}`,
    "",
    "Then rerun the workflow and enter that revision in the optional Base Git revision field.",
    "If the branch moved, add the shown config to the current branch; the shown revision remains the exact Git version already verified against Liftosaur.",
  ].join("\n"));
}

async function commitCanonicalConfig({ repository, configFile, config, deployment, targetId, candidateCommit, releaseBranch, verifiedBaseRevision = null }) {
  const configPath = path.resolve(configFile);
  const expectedPath = path.join(repository, path.relative(repository, configPath));
  if (expectedPath !== configPath || path.relative(repository, configPath).startsWith("..")) {
    throw new Error("Initialization config must be inside the repository");
  }
  if (exactCommit(repository, "HEAD", "checked-out commit") !== candidateCommit) {
    throw new Error("Initialization checkout does not match the selected candidate commit");
  }
  const canonical = config.discovered
    ? { deployments: { [deployment.id]: { program: deployment.program, programId: targetId } } }
    : JSON.parse(await readFile(configPath, "utf8"));
  canonical.deployments[deployment.id].programId = targetId;
  await writeFile(configPath, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
  git(repository, ["config", "user.name", "github-actions[bot]"], "Cannot configure initialization author");
  git(repository, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], "Cannot configure initialization author");
  git(repository, ["add", "--", path.relative(repository, configPath)], "Cannot stage canonical config");
  git(repository, ["commit", "-m", "Initialize liftosaur-ci"], "Cannot create canonical config commit");
  const commitSha = exactCommit(repository, "HEAD", "canonical config commit");
  const branchRef = `refs/heads/${releaseBranch}`;
  try {
    git(repository, ["push", `--force-with-lease=${branchRef}:${candidateCommit}`, "origin", `${commitSha}:${branchRef}`], "Cannot record canonical config on the release branch");
  } catch (error) {
    throw configWriteRecovery({ error, canonical, verifiedBaseRevision });
  }
  return commitSha;
}

export async function initializeGitDeployment({
  configFile, deploymentId = null, candidateRef = "HEAD", baseRef = null,
  repository = null, releaseBranch, apiKey, apiBase,
}) {
  const { config, deployment } = await configuredDeployment(configFile, deploymentId);
  const root = path.resolve(repository ?? config.root);
  const candidateCommit = exactCommit(root, candidateRef, "candidate ref");
  const trackedCommit = readDeploymentRef(root, deployment.id);
  if (trackedCommit || deployment.programId) {
    return { action: "none", candidateCommit, deploymentId: deployment.id };
  }
  if (!baseRef && !config.discovered) {
    throw new Error(`Deployment ${deployment.id} has no deployment ref; provide --base-ref for this configured first migration`);
  }
  if (!releaseBranch || /[\r\n\0]/.test(releaseBranch)) {
    throw new Error("A release branch is required before canonical config can be recorded");
  }
  const candidateSource = programBlob(root, candidateCommit, deployment.program);
  validateLiftosaurSource(candidateSource.toString("utf8"));
  const target = await fetchDeploymentTarget({ programId: "current", apiKey, apiBase });

  if (!baseRef && !candidateSource.equals(Buffer.from(target.text, "utf8"))) {
    throw new Error([
      "Git does not exactly match the program currently used in Liftosaur, so initialization stopped without changing anything.",
      `Export or copy that current program into the root ${deployment.program} file, commit and push it, then run initialization again.`,
      "If you know the historical Git revision that is already deployed, rerun the manual workflow with base_ref instead.",
    ].join("\n"));
  }

  const canonicalCommit = await commitCanonicalConfig({
    repository: root, configFile, config, deployment, targetId: target.id, candidateCommit, releaseBranch,
    verifiedBaseRevision: baseRef ? null : candidateCommit,
  });
  if (!baseRef) {
    const ref = deploymentRef(deployment.id);
    try {
      git(root, ["push", `--force-with-lease=${ref}:`, "origin", `${canonicalCommit}:${ref}`], "Cannot create initialized deployment ref");
    } catch (error) {
      throw new Error(`${error.message}\nThe canonical config commit succeeded, but the deployment ref was not created. Rerun manually with base_ref set to ${canonicalCommit}.`);
    }
    return { action: "initialized", candidateCommit: canonicalCommit, deploymentId: deployment.id, targetId: target.id, deploymentRef: ref };
  }
  return { action: "pinned", candidateCommit: canonicalCommit, deploymentId: deployment.id, targetId: target.id };
}
