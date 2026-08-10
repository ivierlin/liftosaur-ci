import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./report.mjs";
import { assertCanonicalLiftosaurSource } from "./source-format.mjs";

export const LIFTOSAUR_DEPLOYMENT_BUNDLE = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-deployment-bundle-v1",
});

const API_KEY_NAME = "LIFTOSAUR_API_KEY";
const DEFAULT_API_BASE = "https://www.liftosaur.com/api/v1";
const REQUIRED_FILES = [
  "rollback-active.liftoscript",
  "deploy.liftoscript",
  "validation-report.json",
];

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function safeMessage(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error);
  return apiKey ? message.split(apiKey).join("[REDACTED]") : message;
}

async function requireNewDirectory(directory, label) {
  try {
    await access(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists: ${directory}`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertValidationReport(report, sourceHash) {
  requireObject(report, "Validation report");
  if (report.formatVersion !== 1 || report.command !== "validate" || report.status !== "passed") {
    throw new Error("Validation report must record a passed liftosaur-ci validation");
  }
  if (report.input?.sha256 !== sourceHash) {
    throw new Error("Validation report does not describe the deployment source");
  }
}

function assertMergeReport(report, sourceHash) {
  requireObject(report, "Merge report");
  if (report.formatVersion !== 1 || report.command !== "merge" || report.status !== "merged") {
    throw new Error("Merge report must record a successful liftosaur-ci merge");
  }
  if (report.output?.sha256 !== sourceHash) {
    throw new Error("Merge report does not describe the deployment source");
  }
}

export async function prepareDeploymentBundle({
  activeFile,
  deployFile,
  validationReportFile,
  mergeReportFile = null,
  outputDirectory,
  target,
  deployedName,
  source = null,
  preparedAt = new Date().toISOString(),
}) {
  const [active, deploy, validationText, mergeText] = await Promise.all([
    readFile(activeFile, "utf8"),
    readFile(deployFile, "utf8"),
    readFile(validationReportFile, "utf8"),
    mergeReportFile ? readFile(mergeReportFile, "utf8") : null,
  ]);
  return prepareDeploymentBundleFromContents({
    active,
    deploy,
    validationText,
    mergeText,
    outputDirectory,
    target,
    deployedName,
    source,
    preparedAt,
  });
}

export async function prepareDeploymentBundleFromContents({
  active,
  deploy,
  validationText,
  mergeText = null,
  outputDirectory,
  target,
  deployedName,
  source = null,
  preparedAt = new Date().toISOString(),
}) {
  await requireNewDirectory(outputDirectory, "Deployment bundle directory");
  assertCanonicalLiftosaurSource(active, "Active rollback source");
  assertCanonicalLiftosaurSource(deploy, "Deployment source");
  const deployHash = sha256(deploy);
  assertValidationReport(parseJson(validationText, "Validation report"), deployHash);
  if (mergeText) assertMergeReport(parseJson(mergeText, "Merge report"), deployHash);

  const prepared = Date.parse(preparedAt);
  if (!Number.isFinite(prepared)) throw new Error("Preparation timestamp is invalid");
  if (!target?.id || !target?.name || typeof target.isCurrent !== "boolean") {
    throw new Error("Deployment target requires id, name, and isCurrent");
  }
  if (!deployedName) throw new Error("Deployed program name is required");

  const files = {
    "rollback-active.liftoscript": active,
    "deploy.liftoscript": deploy,
    "validation-report.json": validationText,
    ...(mergeText ? { "merge-report.json": mergeText } : {}),
  };
  const manifest = {
    ...LIFTOSAUR_DEPLOYMENT_BUNDLE,
    preparedAt: new Date(prepared).toISOString(),
    deploymentPerformed: false,
    target: {
      id: target.id,
      name: target.name,
      isCurrent: target.isCurrent,
      sourceSha256: sha256(active),
    },
    deployment: {
      name: deployedName,
      sourceSha256: deployHash,
    },
    source,
    evidence: {
      validation: { file: "validation-report.json", sha256: sha256(validationText) },
      merge: mergeText ? { file: "merge-report.json", sha256: sha256(mergeText) } : null,
    },
  };
  const sums = Object.entries(files)
    .map(([name, content]) => `${sha256(content)}  ${name}`)
    .join("\n");

  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await Promise.all([
    ...Object.entries(files).map(([name, content]) => (
      writeFile(path.join(outputDirectory, name), content, { encoding: "utf8", mode: 0o600 })
    )),
    writeFile(
      path.join(outputDirectory, "deployment-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    ),
    writeFile(path.join(outputDirectory, "SHA256SUMS"), `${sums}\n`, {
      encoding: "utf8",
      mode: 0o600,
    }),
  ]);
  return manifest;
}

function parseChecksums(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
    if (values.has(match[2])) throw new Error(`Duplicate checksum entry: ${match[2]}`);
    values.set(match[2], match[1]);
  }
  return values;
}

function assertSourceProvenance(source) {
  if (source === null || source === undefined) return;
  requireObject(source, "Deployment source provenance");
  if (
    source.implementation !== "liftosaur-git-source-v1"
    || typeof source.remote !== "string"
    || !source.remote
    || !["sha1", "sha256"].includes(source.objectFormat)
    || typeof source.programPath !== "string"
    || !source.programPath
  ) {
    throw new Error("Deployment Git source provenance is invalid");
  }
  const objectPattern = source.objectFormat === "sha1" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
  for (const label of ["base", "candidate"]) {
    const revision = source[label];
    if (
      !revision
      || typeof revision.requestedRef !== "string"
      || !revision.requestedRef
      || !objectPattern.test(revision.commitSha ?? "")
      || !objectPattern.test(revision.blobSha ?? "")
    ) {
      throw new Error(`Deployment Git ${label} provenance is invalid`);
    }
  }
}

async function verifyDeploymentBundle(bundleDirectory, maxAgeHours) {
  const [manifestText, checksumsText] = await Promise.all([
    readFile(path.join(bundleDirectory, "deployment-manifest.json"), "utf8"),
    readFile(path.join(bundleDirectory, "SHA256SUMS"), "utf8"),
  ]);
  const manifest = parseJson(manifestText, "Deployment manifest");
  requireObject(manifest, "Deployment manifest");
  if (
    manifest.formatVersion !== LIFTOSAUR_DEPLOYMENT_BUNDLE.formatVersion
    || manifest.implementation !== LIFTOSAUR_DEPLOYMENT_BUNDLE.implementation
    || manifest.deploymentPerformed !== false
  ) {
    throw new Error("Unsupported or already-used deployment manifest");
  }
  const preparedAt = Date.parse(manifest.preparedAt);
  if (!Number.isFinite(preparedAt)) throw new Error("Preparation timestamp is invalid");
  const ageMs = Date.now() - preparedAt;
  if (ageMs < -5 * 60 * 1000) throw new Error("Preparation timestamp is unexpectedly in the future");
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    throw new Error(`Deployment bundle is older than ${maxAgeHours} hours`);
  }
  if (
    !manifest.target?.id
    || !manifest.target?.name
    || typeof manifest.target?.isCurrent !== "boolean"
    || !/^[a-f0-9]{64}$/.test(manifest.target?.sourceSha256 ?? "")
    || !manifest.deployment?.name
    || !/^[a-f0-9]{64}$/.test(manifest.deployment?.sourceSha256 ?? "")
  ) {
    throw new Error("Deployment manifest target or deployment identity is invalid");
  }
  assertSourceProvenance(manifest.source);

  const files = [...REQUIRED_FILES, ...(manifest.evidence?.merge ? ["merge-report.json"] : [])];
  const checksums = parseChecksums(checksumsText);
  const contents = {};
  for (const file of files) {
    const expected = checksums.get(file);
    if (!expected) throw new Error(`Missing checksum entry for ${file}`);
    const content = await readFile(path.join(bundleDirectory, file), "utf8");
    if (sha256(content) !== expected) throw new Error(`Checksum mismatch for ${file}`);
    contents[file] = content;
  }
  const active = contents["rollback-active.liftoscript"];
  const deploy = contents["deploy.liftoscript"];
  assertCanonicalLiftosaurSource(active, "Prepared rollback source");
  assertCanonicalLiftosaurSource(deploy, "Prepared deployment source");
  if (sha256(active) !== manifest.target.sourceSha256) {
    throw new Error("Rollback source hash disagrees with deployment manifest");
  }
  if (sha256(deploy) !== manifest.deployment.sourceSha256) {
    throw new Error("Deployment source hash disagrees with deployment manifest");
  }
  assertValidationReport(
    parseJson(contents["validation-report.json"], "Validation report"),
    manifest.deployment.sourceSha256
  );
  if (manifest.evidence?.validation?.sha256 !== sha256(contents["validation-report.json"])) {
    throw new Error("Validation evidence hash disagrees with deployment manifest");
  }
  if (manifest.evidence?.merge) {
    assertMergeReport(
      parseJson(contents["merge-report.json"], "Merge report"),
      manifest.deployment.sourceSha256
    );
    if (manifest.evidence.merge.sha256 !== sha256(contents["merge-report.json"])) {
      throw new Error("Merge evidence hash disagrees with deployment manifest");
    }
  }
  return { active, deploy, manifest, manifestText };
}

function apiUrl(base, endpoint) {
  return `${base.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

async function apiJson(apiBase, apiKey, endpoint, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(apiUrl(apiBase, endpoint), {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Liftosaur returned non-JSON data (${response.status})`);
      }
      if (response.ok) return body;
      const code = body?.error?.code ?? `http_${response.status}`;
      const message = body?.error?.message ?? "Liftosaur request failed";
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      const error = new Error(`Liftosaur API ${code}: ${message}`);
      error.noRetry = true;
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < 3 && !error?.noRetry && error?.name !== "AbortError") {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      break;
    }
  }
  throw lastError ?? new Error("Liftosaur API request failed");
}

function validateProgram(program, programId, label) {
  if (!program || typeof program !== "object") throw new Error(`${label} response is missing program data`);
  if (typeof program.id !== "string" || !program.id) throw new Error(`${label} target ID is missing`);
  if (program.id !== programId) throw new Error(`${label} target ID changed`);
  if (typeof program.name !== "string") throw new Error(`${label} target name is missing`);
  if (typeof program.isCurrent !== "boolean") throw new Error(`${label} current-program status is missing`);
  if (typeof program.text !== "string") throw new Error(`${label} target source is missing`);
  assertCanonicalLiftosaurSource(program.text, `${label} source`);
  return program;
}

async function fetchProgram(apiBase, apiKey, programId, label) {
  const response = await apiJson(apiBase, apiKey, `programs/${encodeURIComponent(programId)}`);
  return validateProgram(response?.data, programId, label);
}

export async function fetchDeploymentTarget({
  programId,
  expectedName = null,
  apiKey,
  apiBase = DEFAULT_API_BASE,
}) {
  if (!apiKey?.startsWith("lftsk_")) {
    throw new Error(`${API_KEY_NAME} must contain a Liftosaur API key starting with lftsk_`);
  }
  if (!programId) throw new Error("Liftosaur program ID is required");
  try {
    const response = await apiJson(apiBase, apiKey, `programs/${encodeURIComponent(programId)}`);
    const resolvedId = response?.data?.id;
    const program = validateProgram(
      response?.data,
      programId === "current" ? resolvedId : programId,
      "Preparation"
    );
    if (programId !== "current" && program.id !== programId) {
      throw new Error("Preparation target ID changed");
    }
    if (expectedName && program.name !== expectedName) {
      throw new Error("Preparation target name changed");
    }
    return program;
  } catch (error) {
    throw new Error(`Liftosaur preparation failed: ${safeMessage(error, apiKey)}`);
  }
}

async function putProgram(apiBase, apiKey, target, source) {
  return apiJson(apiBase, apiKey, `programs/${encodeURIComponent(target.id)}`, {
    method: "PUT",
    body: JSON.stringify({ name: target.name, text: source }),
  });
}

async function writePrivate(file, content) {
  await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
}

function matchesPreparedTarget(program, target, sourceHash) {
  return program.name === target.name
    && program.isCurrent === target.isCurrent
    && sha256(program.text) === sourceHash;
}

export async function deployPreparedBundle({
  bundleDirectory,
  outputDirectory,
  apiKey,
  expectedProgramId,
  expectedDeployedName,
  apiBase = DEFAULT_API_BASE,
  maxAgeHours = 24,
}) {
  if (!apiKey?.startsWith("lftsk_")) {
    throw new Error(`${API_KEY_NAME} must contain a Liftosaur API key starting with lftsk_`);
  }
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 24) {
    throw new Error("Maximum bundle age must be greater than 0 and no more than 24 hours");
  }
  await requireNewDirectory(outputDirectory, "Deployment record directory");
  const bundle = await verifyDeploymentBundle(bundleDirectory, maxAgeHours);
  if (bundle.manifest.target.id !== expectedProgramId) {
    throw new Error("Deployment confirmation does not match the prepared target ID");
  }
  if (bundle.manifest.deployment.name !== expectedDeployedName) {
    throw new Error("Deployment confirmation does not match the prepared resulting name");
  }
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await writePrivate(path.join(outputDirectory, "rollback-active.liftoscript"), bundle.active);

  const originalTarget = bundle.manifest.target;
  const deployedTarget = { ...originalTarget, name: bundle.manifest.deployment.name };
  let report = {
    formatVersion: 1,
    command: "deploy",
    deployedAt: null,
    deploymentPerformed: false,
    rollbackAttempted: false,
    rollbackRestored: false,
    target: { id: originalTarget.id, name: deployedTarget.name },
    previousTargetName: originalTarget.name,
    preparedAt: bundle.manifest.preparedAt,
    source: bundle.manifest.source ?? null,
  };

  try {
    const before = await fetchProgram(apiBase, apiKey, originalTarget.id, "Pre-deployment");
    if (!matchesPreparedTarget(before, originalTarget, originalTarget.sourceSha256)) {
      throw new Error("Liftosaur target changed after deployment preparation; prepare a fresh bundle");
    }

    let writeError = null;
    let writeSucceeded = false;
    try {
      await putProgram(apiBase, apiKey, deployedTarget, bundle.deploy);
      writeSucceeded = true;
    } catch (error) {
      writeError = error;
    }
    let after;
    try {
      after = await fetchProgram(apiBase, apiKey, originalTarget.id, "Post-deployment");
    } catch (error) {
      writeError ??= error;
    }
    if (after && matchesPreparedTarget(after, deployedTarget, bundle.manifest.deployment.sourceSha256)) {
      report = {
        ...report,
        deployedAt: new Date().toISOString(),
        deploymentPerformed: true,
        target: { id: after.id, name: after.name, isCurrent: after.isCurrent },
        beforeSha256: originalTarget.sourceSha256,
        deployedSha256: bundle.manifest.deployment.sourceSha256,
        deploymentManifestSha256: sha256(bundle.manifestText),
      };
      await writePrivate(path.join(outputDirectory, "deployment-report.json"), `${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    if (after && matchesPreparedTarget(after, originalTarget, originalTarget.sourceSha256)) {
      const detail = writeError ? `: ${safeMessage(writeError, apiKey)}` : "";
      throw new Error(`Liftosaur update did not take effect${detail}`);
    }
    if (!writeSucceeded) {
      throw new Error(
        "Liftosaur update outcome is ambiguous and the target matches neither prepared source; no automatic rollback was attempted"
      );
    }

    report.rollbackAttempted = true;
    let rollbackError = null;
    try {
      await putProgram(apiBase, apiKey, originalTarget, bundle.active);
      const restored = await fetchProgram(apiBase, apiKey, originalTarget.id, "Rollback verification");
      report.rollbackRestored = matchesPreparedTarget(restored, originalTarget, originalTarget.sourceSha256);
      if (!report.rollbackRestored) rollbackError = new Error("Rollback read-back source does not match the prepared target");
    } catch (error) {
      rollbackError = error;
    }
    await writePrivate(path.join(outputDirectory, "deployment-report.json"), `${JSON.stringify({
      ...report,
      failure: safeMessage(writeError ?? new Error("Post-deployment verification failed"), apiKey),
      rollbackFailure: rollbackError ? safeMessage(rollbackError, apiKey) : null,
    }, null, 2)}\n`);
    if (rollbackError || !report.rollbackRestored) {
      throw new Error("Post-deployment verification failed and automatic rollback could not be verified; inspect Liftosaur immediately");
    }
    throw new Error("Post-deployment verification failed; the prepared program name and rollback source were restored successfully");
  } catch (error) {
    const message = safeMessage(error, apiKey);
    await writePrivate(path.join(outputDirectory, "deployment-error.txt"), `${message}\n`);
    if (!report.deploymentPerformed && !report.rollbackAttempted) {
      await writePrivate(path.join(outputDirectory, "deployment-report.json"), `${JSON.stringify({ ...report, failure: message }, null, 2)}\n`);
    }
    throw new Error(`Liftosaur deployment failed: ${message}`);
  }
}
