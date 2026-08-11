import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fetchDeploymentTarget } from "./deployment.mjs";
import { sha256 } from "./report.mjs";
import { assertCanonicalLiftosaurSource } from "./source-format.mjs";

const DEFAULT_API_BASE = "https://www.liftosaur.com/api/v1";

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveBundleDirectory(artifactDirectory) {
  if (await exists(path.join(artifactDirectory, "deployment-manifest.json"))) {
    return artifactDirectory;
  }
  const nested = path.join(artifactDirectory, "bundle");
  if (await exists(path.join(nested, "deployment-manifest.json"))) return nested;
  throw new Error(
    "Restore artifact must contain deployment-manifest.json, directly or in a bundle directory"
  );
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

async function writePrivate(file, content) {
  await writeFile(file, content, { encoding: "utf8", mode: 0o600 });
}

export async function restoreDeploymentArtifact({
  artifactDirectory,
  apiKey,
  apiBase = DEFAULT_API_BASE,
}) {
  const bundleDirectory = await resolveBundleDirectory(artifactDirectory);
  const [manifestText, restoreSource] = await Promise.all([
    readFile(path.join(bundleDirectory, "deployment-manifest.json"), "utf8"),
    readFile(path.join(bundleDirectory, "deploy.liftoscript"), "utf8"),
  ]);
  const manifest = parseJson(manifestText, "Deployment manifest");
  const targetId = manifest?.target?.id;
  const restoreHash = manifest?.deployment?.sourceSha256;
  if (
    typeof targetId !== "string"
    || !targetId
    || targetId === "current"
    || !/^[a-f0-9]{64}$/.test(restoreHash ?? "")
  ) {
    throw new Error("Historical deployment manifest is invalid");
  }
  assertCanonicalLiftosaurSource(restoreSource, "Historical deployment source");
  if (sha256(restoreSource) !== restoreHash) {
    throw new Error("Historical deployment source hash disagrees with the deployment manifest");
  }

  const before = await fetchDeploymentTarget({ programId: targetId, apiKey, apiBase });
  const beforeHash = sha256(before.text);
  if (beforeHash === restoreHash) {
    return {
      command: "restore",
      status: "already-restored",
      restoredAt: new Date().toISOString(),
      target: { id: before.id, name: before.name, isCurrent: before.isCurrent },
      observedSha256: beforeHash,
      restoredSha256: restoreHash,
      recoveryDirectory: null,
    };
  }

  const recoveryDirectory = await mkdtemp(path.join(os.tmpdir(), "liftosaur-ci-restore-"));
  await Promise.all([
    writePrivate(path.join(recoveryDirectory, "pre-restore.liftoscript"), before.text),
    writePrivate(path.join(recoveryDirectory, "restore-artifact-manifest.json"), manifestText),
  ]);

  let writeError = null;
  try {
    await putProgram(apiBase, apiKey, targetId, before.name, restoreSource);
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
  if (after && sha256(after.text) === restoreHash) {
    const report = {
      command: "restore",
      status: "restored",
      restoredAt: new Date().toISOString(),
      target: { id: after.id, name: after.name, isCurrent: after.isCurrent },
      observedSha256: beforeHash,
      restoredSha256: restoreHash,
      recoveryDirectory,
    };
    await writePrivate(
      path.join(recoveryDirectory, "restore-report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    return report;
  }

  if (after) {
    await writePrivate(path.join(recoveryDirectory, "post-restore.liftoscript"), after.text);
  }
  const detail = writeError?.message ?? readError?.message ?? "read-back did not match the historical source";
  await writePrivate(path.join(recoveryDirectory, "restore-error.txt"), `${detail}\n`);
  const error = new Error(
    `Liftosaur historical restore could not be verified: ${detail}. `
    + `The pre-restore live source is preserved at ${recoveryDirectory}`
  );
  error.recoveryDirectory = recoveryDirectory;
  throw error;
}

export async function runRestoreCli(argv, {
  apiKey = process.env.LIFTOSAUR_API_KEY?.trim(),
} = {}) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(`Usage:\n  liftosaur-ci restore \\\n    --artifact <historical-deployment-bundle> \\\n    [--api-base <url>]\n\nRestores the exact historical Liftosaur source from a deployment bundle.\nThis intentionally rewinds live progression and does not change Git deployment state.`);
    return;
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--artifact", "--api-base"].includes(argument)) {
      throw new Error(`Unknown restore option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (Object.hasOwn(options, argument)) throw new Error(`Duplicate option: ${argument}`);
    options[argument] = value;
    index += 1;
  }
  if (!options["--artifact"]) throw new Error("Missing required option: --artifact");

  const report = await restoreDeploymentArtifact({
    artifactDirectory: path.resolve(options["--artifact"]),
    apiKey,
    apiBase: options["--api-base"],
  });
  const verb = report.status === "already-restored" ? "already restored" : "restored";
  console.log(`Liftosaur historical restore verified: ${report.target.name} (${report.target.id}) ${verb}`);
  if (report.recoveryDirectory) {
    console.log(`Pre-restore source retained at: ${report.recoveryDirectory}`);
  }
}
