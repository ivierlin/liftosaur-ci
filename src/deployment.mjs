import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./report.mjs";
import { assertCanonicalLiftosaurSource } from "./source-format.mjs";

const API_KEY_NAME = "LIFTOSAUR_API_KEY";
const DEFAULT_API_BASE = "https://www.liftosaur.com/api/v1";

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
  if (report.command !== "validate" || report.status !== "passed") {
    throw new Error("Validation report must record a passed liftosaur-ci validation");
  }
  if (report.input?.sha256 !== sourceHash) {
    throw new Error("Validation report does not describe the deployment source");
  }
}

function assertMergeReport(report, sourceHash) {
  requireObject(report, "Merge report");
  if (report.command !== "merge" || report.status !== "merged") {
    throw new Error("Merge report must record a successful liftosaur-ci merge");
  }
  if (report.output?.sha256 !== sourceHash) {
    throw new Error("Merge report does not describe the deployment source");
  }
}

function assertSourceProvenance(source) {
  if (source === null || source === undefined) return;
  requireObject(source, "Deployment source provenance");
  if (
    typeof source.remote !== "string"
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

export async function prepareDeploymentBundle({
  activeFile,
  deployFile,
  validationReportFile,
  mergeReportFile = null,
  outputDirectory,
  target,
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
  if (typeof target?.id !== "string" || !target.id || target.id === "current") {
    throw new Error("Deployment bundle requires a resolved Liftosaur program ID");
  }
  assertSourceProvenance(source);

  const files = {
    "rollback-active.liftoscript": active,
    "deploy.liftoscript": deploy,
    "validation-report.json": validationText,
    ...(mergeText ? { "merge-report.json": mergeText } : {}),
  };
  const manifest = {
    preparedAt: new Date(prepared).toISOString(),
    target: {
      id: target.id,
      sourceSha256: sha256(active),
    },
    deployment: {
      sourceSha256: deployHash,
    },
    source,
    evidence: {
      validation: { file: "validation-report.json", sha256: sha256(validationText) },
      merge: mergeText ? { file: "merge-report.json", sha256: sha256(mergeText) } : null,
    },
  };

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
  ]);
  return manifest;
}

async function verifyDeploymentBundle(bundleDirectory, maxAgeHours) {
  const manifestText = await readFile(path.join(bundleDirectory, "deployment-manifest.json"), "utf8");
  const manifest = parseJson(manifestText, "Deployment manifest");
  requireObject(manifest, "Deployment manifest");
  const preparedAt = Date.parse(manifest.preparedAt);
  if (!Number.isFinite(preparedAt)) throw new Error("Preparation timestamp is invalid");
  const ageMs = Date.now() - preparedAt;
  if (ageMs < -5 * 60 * 1000) throw new Error("Preparation timestamp is unexpectedly in the future");
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    throw new Error(`Deployment bundle is older than ${maxAgeHours} hours`);
  }
  if (
    typeof manifest.target?.id !== "string"
    || !manifest.target.id
    || manifest.target.id === "current"
    || !/^[a-f0-9]{64}$/.test(manifest.target?.sourceSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(manifest.deployment?.sourceSha256 ?? "")
    || manifest.evidence?.validation?.file !== "validation-report.json"
    || !/^[a-f0-9]{64}$/.test(manifest.evidence?.validation?.sha256 ?? "")
  ) {
    throw new Error("Deployment manifest is invalid");
  }
  assertSourceProvenance(manifest.source);

  const files = [
    "rollback-active.liftoscript",
    "deploy.liftoscript",
    "validation-report.json",
    ...(manifest.evidence?.merge ? ["merge-report.json"] : []),
  ];
  const contents = Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    await readFile(path.join(bundleDirectory, file), "utf8"),
  ])));
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
  if (sha256(contents["validation-report.json"]) !== manifest.evidence.validation.sha256) {
    throw new Error("Validation evidence hash disagrees with deployment manifest");
  }
  assertValidationReport(
    parseJson(contents["validation-report.json"], "Validation report"),
    manifest.deployment.sourceSha256
  );
  if (manifest.evidence?.merge) {
    if (
      manifest.evidence.merge.file !== "merge-report.json"
      || !/^[a-f0-9]{64}$/.test(manifest.evidence.merge.sha256 ?? "")
      || sha256(contents["merge-report.json"]) !== manifest.evidence.merge.sha256
    ) {
      throw new Error("Merge evidence hash disagrees with deployment manifest");
    }
    assertMergeReport(
      parseJson(contents["merge-report.json"], "Merge report"),
      manifest.deployment.sourceSha256
    );
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

function validateProgram(program, expectedId, label) {
  if (!program || typeof program !== "object") throw new Error(`${label} response is missing program data`);
  if (typeof program.id !== "string" || !program.id) throw new Error(`${label} target ID is missing`);
  if (expectedId && program.id !== expectedId) throw new Error(`${label} target ID changed`);
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
  apiKey,
  apiBase = DEFAULT_API_BASE,
}) {
  if (!apiKey?.startsWith("lftsk_")) {
    throw new Error(`${API_KEY_NAME} must contain a Liftosaur API key starting with lftsk_`);
  }
  if (!programId) throw new Error("Liftosaur program ID is required");
  try {
    const response = await apiJson(apiBase, apiKey, `programs/${encodeURIComponent(programId)}`);
    return validateProgram(
      response?.data,
      programId === "current" ? null : programId,
      "Preparation"
    );
  } catch (error) {
    throw new Error(`Liftosaur preparation failed: ${safeMessage(error, apiKey)}`);
  }
}

async function putProgram(apiBase, apiKey, programId, name, source) {
  return apiJson(apiBase, apiKey, `programs/${encodeURIComponent(programId)}`, {
    method: "PUT",
    body: JSON.stringify({ name, text: source }),
  });
}

async function writePrivate(file, content) {
  await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
}

export async function deployPreparedBundle({
  bundleDirectory,
  outputDirectory,
  apiKey,
  expectedProgramId = null,
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
  if (expectedProgramId && expectedProgramId !== "current" && bundle.manifest.target.id !== expectedProgramId) {
    throw new Error("Deployment confirmation does not match the prepared target ID");
  }

  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await writePrivate(path.join(outputDirectory, "rollback-active.liftoscript"), bundle.active);
  const targetId = bundle.manifest.target.id;
  let report = {
    command: "deploy",
    deployedAt: null,
    deploymentPerformed: false,
    target: { id: targetId },
    preparedAt: bundle.manifest.preparedAt,
    source: bundle.manifest.source ?? null,
  };

  try {
    const before = await fetchProgram(apiBase, apiKey, targetId, "Pre-deployment");
    if (sha256(before.text) !== bundle.manifest.target.sourceSha256) {
      throw new Error("Liftosaur target changed after deployment preparation; prepare a fresh bundle");
    }

    let writeError = null;
    try {
      await putProgram(apiBase, apiKey, targetId, before.name, bundle.deploy);
    } catch (error) {
      writeError = error;
    }

    let after = null;
    try {
      after = await fetchProgram(apiBase, apiKey, targetId, "Post-deployment");
    } catch (error) {
      writeError ??= error;
    }
    if (after && sha256(after.text) === bundle.manifest.deployment.sourceSha256) {
      report = {
        ...report,
        deployedAt: new Date().toISOString(),
        deploymentPerformed: true,
        target: { id: after.id, name: after.name, isCurrent: after.isCurrent },
        beforeSha256: bundle.manifest.target.sourceSha256,
        deployedSha256: bundle.manifest.deployment.sourceSha256,
        deploymentManifestSha256: sha256(bundle.manifestText),
      };
      await writePrivate(path.join(outputDirectory, "deployment-report.json"), `${JSON.stringify(report, null, 2)}\n`);
      return report;
    }
    if (after && sha256(after.text) === bundle.manifest.target.sourceSha256) {
      const detail = writeError ? `: ${safeMessage(writeError, apiKey)}` : "";
      throw new Error(`Liftosaur update did not take effect${detail}`);
    }
    throw new Error(
      "Liftosaur update outcome is ambiguous or the target changed concurrently; no automatic rollback was attempted"
    );
  } catch (error) {
    const message = safeMessage(error, apiKey);
    await writePrivate(path.join(outputDirectory, "deployment-error.txt"), `${message}\n`);
    if (!report.deploymentPerformed) {
      await writePrivate(path.join(outputDirectory, "deployment-report.json"), `${JSON.stringify({ ...report, failure: message }, null, 2)}\n`);
    }
    throw new Error(`Liftosaur deployment failed: ${message}`);
  }
}
