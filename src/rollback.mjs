import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fetchDeploymentTarget } from "./deployment.mjs";
import { sha256 } from "./report.mjs";
import { assertCanonicalLiftosaurSource } from "./source-format.mjs";

const DEFAULT_API_BASE = "https://www.liftosaur.com/api/v1";
const AMBIGUOUS_FAILURE = "outcome is ambiguous or the target changed concurrently";

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function writePrivate(file, content, options = {}) {
  await writeFile(file, content, {
    encoding: "utf8",
    mode: 0o600,
    ...options,
  });
}

async function preserveOnce(file, content) {
  try {
    await access(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      await writePrivate(file, content, { flag: "wx" });
      return;
    }
    throw error;
  }
}

async function putProgram(apiBase, apiKey, programId, name, source) {
  const response = await fetch(
    `${apiBase.replace(/\/+$/, "")}/programs/${encodeURIComponent(programId)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, text: source }),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (response.ok) return;

  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    detail = `${body?.error?.code ?? detail}: ${body?.error?.message ?? "Liftosaur request failed"}`;
  } catch {
    // Keep the HTTP status when Liftosaur did not return JSON.
  }
  throw new Error(`Liftosaur API ${detail}`);
}

export async function rollbackRecoveryDirectory({
  recoveryDirectory,
  apiKey,
  apiBase = DEFAULT_API_BASE,
}) {
  const bundleDirectory = path.join(recoveryDirectory, "bundle");
  const recordDirectory = path.join(recoveryDirectory, "record");
  const [manifestText, rollbackSource, deploymentReportText] = await Promise.all([
    readFile(path.join(bundleDirectory, "deployment-manifest.json"), "utf8"),
    readFile(path.join(bundleDirectory, "rollback-active.liftoscript"), "utf8"),
    readFile(path.join(recordDirectory, "deployment-report.json"), "utf8"),
  ]);
  const manifest = parseJson(manifestText, "Deployment manifest");
  const deployment = parseJson(deploymentReportText, "Deployment report");
  const targetId = manifest?.target?.id;
  const rollbackHash = manifest?.target?.sourceSha256;

  if (
    typeof targetId !== "string"
    || !targetId
    || targetId === "current"
    || !/^[a-f0-9]{64}$/.test(rollbackHash ?? "")
  ) {
    throw new Error("Recovery deployment manifest is invalid");
  }
  assertCanonicalLiftosaurSource(rollbackSource, "Recovery rollback source");
  if (sha256(rollbackSource) !== rollbackHash) {
    throw new Error("Recovery rollback source hash disagrees with the deployment manifest");
  }
  if (
    deployment?.command !== "deploy"
    || deployment?.target?.id !== targetId
    || deployment?.deploymentPerformed !== false
    || typeof deployment?.failure !== "string"
    || !deployment.failure.includes(AMBIGUOUS_FAILURE)
  ) {
    throw new Error(
      "Rollback is only available for a retained recovery directory from an ambiguous deployment write"
    );
  }

  const before = await fetchDeploymentTarget({ programId: targetId, apiKey, apiBase });
  const observedFile = path.join(recordDirectory, "rollback-observed.liftoscript");
  await preserveOnce(observedFile, before.text);
  const beforeHash = sha256(before.text);

  if (beforeHash === rollbackHash) {
    const report = {
      command: "rollback",
      status: "already-restored",
      rolledBackAt: new Date().toISOString(),
      target: { id: before.id, name: before.name, isCurrent: before.isCurrent },
      observedSha256: beforeHash,
      restoredSha256: rollbackHash,
    };
    await writePrivate(
      path.join(recordDirectory, "rollback-report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    return report;
  }

  let writeError = null;
  try {
    await putProgram(apiBase, apiKey, targetId, before.name, rollbackSource);
  } catch (error) {
    writeError = error;
  }

  let after = null;
  let readError = null;
  try {
    after = await fetchDeploymentTarget({ programId: targetId, apiKey, apiBase });
  } catch (error) {
    readError = error;
  }
  if (after && sha256(after.text) === rollbackHash) {
    const report = {
      command: "rollback",
      status: "rolled-back",
      rolledBackAt: new Date().toISOString(),
      target: { id: after.id, name: after.name, isCurrent: after.isCurrent },
      observedSha256: beforeHash,
      restoredSha256: rollbackHash,
    };
    await writePrivate(
      path.join(recordDirectory, "rollback-report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    return report;
  }

  if (after) {
    await writePrivate(path.join(recordDirectory, "rollback-after.liftoscript"), after.text);
  }
  const detail = writeError?.message ?? readError?.message ?? "read-back did not match the rollback source";
  await writePrivate(path.join(recordDirectory, "rollback-error.txt"), `${detail}\n`);
  throw new Error(
    `Liftosaur rollback could not be verified: ${detail}. `
    + `The pre-rollback live source is preserved at ${observedFile}`
  );
}
