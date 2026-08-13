import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { configuredDeployment } from "./config.mjs";
import { deploymentRef, readDeploymentRef } from "./deployment-state.mjs";
import { fetchDeploymentTarget } from "./deployment.mjs";
import { projectLiftosaurSourceForInitialization } from "./frontend.mjs";
import { mergeLiftosaurSources } from "./merge.mjs";
import { canonicalizeLiftosaurSource } from "./source-format.mjs";
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

async function verifyCompatibleInitialization(cleanSource, liveSource) {
  if (projectLiftosaurSourceForInitialization(cleanSource)
    !== projectLiftosaurSourceForInitialization(liveSource)) {
    throw new Error([
      "The Git program is not a compatible clean base for the program currently used in Liftosaur, so initialization stopped without changing anything.",
      "Git must contain the original clean program source, not a current progressed export.",
      "If you started from a built-in Liftosaur program, use its original built-in source. If you authored it, use your original clean source.",
      "If you know the historical Git revision that produced the live program, use explicit base_ref for the advanced migration path.",
    ].join("\n"));
  }
  const roundTrip = await mergeLiftosaurSources({
    base: cleanSource,
    active: liveSource,
    candidate: cleanSource,
  });
  if (!roundTrip.source
    || canonicalizeLiftosaurSource(roundTrip.source) !== canonicalizeLiftosaurSource(liveSource)) {
    throw new Error([
      "The live Liftosaur state could not be preserved exactly during initialization, so initialization stopped without changing anything.",
      "No live source, config commit, or deployment ref was written.",
    ].join("\n"));
  }
}

function createDeploymentRef(repository, deploymentId, commit) {
  const ref = deploymentRef(deploymentId);
  git(repository, ["push", `--force-with-lease=${ref}:`, "origin", `${commit}:${ref}`], "Cannot create initialized deployment ref");
  return ref;
}

function configWriteRecovery({ error, canonicalText, relativeConfigPath, verifiedBaseRevision }) {
  if (!verifiedBaseRevision) {
    return new Error(`${error.message}\nThe release branch moved or rejected the config-only commit. No Liftosaur write or deployment ref was created. Rerun after the branch is current, or pin liftosaur-ci.json manually and use the advanced base_ref route.`);
  }
  return new Error([
    error.message,
    "Initialization verified successfully, but liftosaur-ci could not record liftosaur-ci.json on the release branch.",
    "The branch may be protected, a ruleset or token policy may reject direct writes, or the branch may have moved concurrently.",
    "No Liftosaur write or deployment ref was created.",
    "",
    `Create or update ${relativeConfigPath} on the current release branch with this complete canonical content, commit it, and push it:`,
    "",
    canonicalText.trimEnd(),
    "",
    `Base Git revision: ${verifiedBaseRevision}`,
    "",
    "Then rerun the workflow and enter that revision in the optional Base Git revision field.",
    "If the branch moved, add the shown config to the current branch; the shown revision remains the exact Git version already verified against Liftosaur.",
  ].join("\n"));
}

async function commitCanonicalConfig({
  repository, configFile, config, deployment, targetId, candidateCommit, releaseBranch, verifiedBaseRevision = null,
}) {
  const configPath = path.resolve(configFile);
  const relativeConfigPath = path.relative(repository, configPath);
  const expectedPath = path.join(repository, relativeConfigPath);
  if (expectedPath !== configPath || relativeConfigPath.startsWith("..")) {
    throw new Error("Initialization config must be inside the repository");
  }
  if (exactCommit(repository, "HEAD", "checked-out commit") !== candidateCommit) {
    throw new Error("Initialization checkout does not match the selected candidate commit");
  }
  const canonical = config.discovered
    ? { deployments: { [deployment.id]: { program: deployment.program, programId: targetId } } }
    : JSON.parse(await readFile(configPath, "utf8"));
  canonical.deployments[deployment.id].programId = targetId;
  const canonicalText = `${JSON.stringify(canonical, null, 2)}\n`;
  await writeFile(configPath, canonicalText, "utf8");
  git(repository, ["config", "user.name", "github-actions[bot]"], "Cannot configure initialization author");
  git(repository, ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], "Cannot configure initialization author");
  git(repository, ["add", "--", relativeConfigPath], "Cannot stage canonical config");
  git(repository, ["commit", "-m", "Initialize liftosaur-ci"], "Cannot create canonical config commit");
  const commitSha = exactCommit(repository, "HEAD", "canonical config commit");
  const branchRef = `refs/heads/${releaseBranch}`;
  try {
    git(repository, ["push", `--force-with-lease=${branchRef}:${candidateCommit}`, "origin", `${commitSha}:${branchRef}`], "Cannot record canonical config on the release branch");
  } catch (error) {
    throw configWriteRecovery({ error, canonicalText, relativeConfigPath, verifiedBaseRevision });
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
  if (trackedCommit) {
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
  const target = await fetchDeploymentTarget({ programId: deployment.programId ?? "current", apiKey, apiBase });

  if (!baseRef) {
    await verifyCompatibleInitialization(candidateSource.toString("utf8"), target.text);
  } else if (deployment.programId) {
    const baseCommit = exactCommit(root, baseRef, "base ref");
    const baseSource = programBlob(root, baseCommit, deployment.program);
    if (baseSource.equals(candidateSource)) {
      await verifyCompatibleInitialization(baseSource.toString("utf8"), target.text);
      const ref = createDeploymentRef(root, deployment.id, candidateCommit);
      return { action: "initialized", candidateCommit, deploymentId: deployment.id, targetId: target.id, deploymentRef: ref };
    }
    return { action: "none", candidateCommit, deploymentId: deployment.id };
  }

  const canonicalCommit = await commitCanonicalConfig({
    repository: root,
    configFile,
    config,
    deployment,
    targetId: target.id,
    candidateCommit,
    releaseBranch,
    verifiedBaseRevision: baseRef ? null : candidateCommit,
  });
  if (!baseRef) {
    let ref;
    try {
      ref = createDeploymentRef(root, deployment.id, canonicalCommit);
    } catch (error) {
      throw new Error(`${error.message}\nThe canonical config commit succeeded, but the deployment ref was not created. Rerun manually with base_ref set to ${canonicalCommit}.`);
    }
    return { action: "initialized", candidateCommit: canonicalCommit, deploymentId: deployment.id, targetId: target.id, deploymentRef: ref };
  }
  return { action: "pinned", candidateCommit: canonicalCommit, deploymentId: deployment.id, targetId: target.id };
}
