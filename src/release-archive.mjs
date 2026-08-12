import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { strToU8, unzipSync, zipSync } from "fflate";

import { deployPreparedBundle } from "./deployment.mjs";
import { prepareLiftosaurDeploymentFromContents } from "./prepare.mjs";
import { sha256 } from "./report.mjs";
import { validateLiftosaurSource } from "./validate.mjs";

const PREVIOUS_FILE = "previous.liftoscript";
const NEW_FILE = "new.liftoscript";
const ARCHIVE_FILES = new Set([PREVIOUS_FILE, NEW_FILE]);
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 3 * 1024 * 1024;
const MAX_STATE_FILES = 1_000;

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function requireKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} has unsupported keys: ${unexpected.join(", ")}`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8 text`);
  }
}

function validateProgramId(value, label = "Liftosaur program ID") {
  if (
    typeof value !== "string"
    || !value.trim()
    || value !== value.trim()
    || /[\r\n\0]/.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function validateState(value) {
  requireObject(value, "Archive update state");
  requireKeys(value, new Set(["programId", "sourceSha256"]), "Archive update state");
  const programId = validateProgramId(value.programId, "Archive update state program ID");
  if (programId === "current" || !/^[a-f0-9]{64}$/.test(value.sourceSha256 ?? "")) {
    throw new Error("Archive update state is invalid");
  }
  return { programId, sourceSha256: value.sourceSha256 };
}

export function defaultUpdateArchiveStateDirectory({
  platform = process.platform,
  environment = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  if (platform === "win32") {
    return path.join(environment.LOCALAPPDATA || path.join(homeDirectory, "AppData", "Local"), "liftosaur-ci", "update-state");
  }
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", "liftosaur-ci", "update-state");
  }
  return path.join(environment.XDG_STATE_HOME || path.join(homeDirectory, ".local", "state"), "liftosaur-ci", "update-state");
}

export async function createUpdateArchive({ outputFile, previousFile, newFile }) {
  const [previous, candidate] = await Promise.all([
    readFile(previousFile, "utf8"),
    readFile(newFile, "utf8"),
  ]);
  validateLiftosaurSource(previous);
  validateLiftosaurSource(candidate);
  if (sha256(previous) === sha256(candidate)) {
    throw new Error("Previous and new program sources must be different");
  }
  const archive = zipSync({
    [PREVIOUS_FILE]: strToU8(previous),
    [NEW_FILE]: strToU8(candidate),
  }, { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Update archive is too large");
  await writeFile(outputFile, archive, { flag: "wx", mode: 0o644 });
  return { outputFile };
}

export async function readUpdateArchive(archiveFile) {
  const metadata = await stat(archiveFile);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Update archive must be a non-empty ZIP no larger than ${MAX_ARCHIVE_BYTES} bytes`);
  }
  const bytes = await readFile(archiveFile);
  const seen = new Set();
  let files;
  try {
    files = unzipSync(bytes, {
      filter(entry) {
        if (seen.has(entry.name)) throw new Error(`Update archive contains a duplicate file: ${entry.name}`);
        seen.add(entry.name);
        if (!ARCHIVE_FILES.has(entry.name)) throw new Error(`Update archive contains an unexpected file: ${entry.name}`);
        if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0 || entry.originalSize > MAX_ENTRY_BYTES) {
          throw new Error(`Update archive entry is too large: ${entry.name}`);
        }
        return true;
      },
    });
  } catch (error) {
    throw new Error(`Cannot read update archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const missing = [...ARCHIVE_FILES].filter((name) => !files[name]);
  if (missing.length) throw new Error(`Update archive is missing: ${missing.join(", ")}`);
  const previous = decodeUtf8(files[PREVIOUS_FILE], PREVIOUS_FILE);
  const candidate = decodeUtf8(files[NEW_FILE], NEW_FILE);
  validateLiftosaurSource(previous);
  validateLiftosaurSource(candidate);
  const previousSha256 = sha256(previous);
  const candidateSha256 = sha256(candidate);
  if (previousSha256 === candidateSha256) {
    throw new Error("Previous and new program sources must be different");
  }
  return { previous, candidate, previousSha256, candidateSha256 };
}

async function readState(file) {
  try {
    return validateState(parseJson(await readFile(file, "utf8"), "Archive update state"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readStates(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  if (files.length > MAX_STATE_FILES) throw new Error("Archive update state directory contains too many files");
  const inspected = await Promise.all(files.map(async (file) => ({ file, state: await readState(file) })));
  const states = inspected.filter(({ state }) => state !== null);
  const seen = new Set();
  for (const { state } of states) {
    if (seen.has(state.programId)) throw new Error(`Duplicate archive update state for ${state.programId}`);
    seen.add(state.programId);
  }
  return states;
}

async function writeState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function createWorkspace(receiptDirectory) {
  if (!receiptDirectory) {
    return {
      directory: await mkdtemp(path.join(os.tmpdir(), "liftosaur-ci-archive-update-")),
      retainReceipt: false,
    };
  }
  const directory = path.resolve(receiptDirectory);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  return { directory, retainReceipt: true };
}

function assertTrackedBase(tracked, previousSha256) {
  if (tracked.sourceSha256 !== previousSha256) {
    throw new Error(
      "This archive does not start from the source recorded for the selected Liftosaur program. "
      + "Use the next archive in that program's published update chain."
    );
  }
}

async function selectTarget({ stateFile, stateDirectory, programId, previousSha256 }) {
  if (stateFile) {
    const tracked = await readState(stateFile);
    if (tracked) {
      if (programId && programId !== "current" && programId !== tracked.programId) {
        throw new Error("Requested Liftosaur program ID does not match the tracked archive target");
      }
      assertTrackedBase(tracked, previousSha256);
      return { requestedProgramId: tracked.programId, states: [] };
    }
    return { requestedProgramId: programId ?? "current", states: [] };
  }

  const states = await readStates(stateDirectory);
  if (programId && programId !== "current") {
    const existing = states.find(({ state }) => state.programId === programId) ?? null;
    if (existing) assertTrackedBase(existing.state, previousSha256);
    return {
      requestedProgramId: programId,
      states,
    };
  }

  const matching = states.filter(({ state }) => state.sourceSha256 === previousSha256);
  if (matching.length === 1) {
    return {
      requestedProgramId: matching[0].state.programId,
      states,
    };
  }
  if (matching.length > 1 && programId !== "current") {
    throw new Error("More than one tracked program matches this archive; rerun with --program-id <exact-id>");
  }
  if (matching.length === 0 && states.length > 0 && programId !== "current") {
    throw new Error(
      "This archive does not continue any tracked program. "
      + "For a different installed program, rerun with --program-id current or an exact ID."
    );
  }
  return { requestedProgramId: "current", states };
}

function resolvedStateFile({ explicitStateFile, stateDirectory, selected, targetId }) {
  if (explicitStateFile) return explicitStateFile;
  const existing = selected.states.find(({ state }) => state.programId === targetId) ?? null;
  if (existing) return existing.file;
  return path.join(stateDirectory, `${sha256(targetId)}.json`);
}

export async function updateFromArchive({
  archiveFile,
  stateFile = null,
  stateDirectory = null,
  receiptDirectory = null,
  programId = null,
  apiKey,
  apiBase,
}) {
  if (programId != null) validateProgramId(programId);
  const release = await readUpdateArchive(archiveFile);
  const resolvedStateDirectory = path.resolve(stateDirectory ?? defaultUpdateArchiveStateDirectory());
  const explicitStateFile = stateFile ? path.resolve(stateFile) : null;
  const selected = await selectTarget({
    stateFile: explicitStateFile,
    stateDirectory: resolvedStateDirectory,
    programId,
    previousSha256: release.previousSha256,
  });

  const workspace = await createWorkspace(receiptDirectory);
  const temporary = workspace.directory;
  const bundleDirectory = path.join(temporary, "bundle");
  const recordDirectory = path.join(temporary, "record");
  let deploymentStarted = false;
  try {
    const prepared = await prepareLiftosaurDeploymentFromContents({
      base: release.previous,
      candidate: release.candidate,
      outputDirectory: bundleDirectory,
      programId: selected.requestedProgramId,
      apiKey,
      apiBase,
      source: {
        type: "archive",
        base: { sourceSha256: release.previousSha256 },
        candidate: { sourceSha256: release.candidateSha256 },
      },
    });
    const targetId = prepared.manifest.target.id;
    const existingTarget = selected.states.find(({ state }) => state.programId === targetId) ?? null;
    if (existingTarget) assertTrackedBase(existingTarget.state, release.previousSha256);
    const resolvedFile = resolvedStateFile({
      explicitStateFile,
      stateDirectory: resolvedStateDirectory,
      selected,
      targetId,
    });

    deploymentStarted = true;
    const report = await deployPreparedBundle({
      bundleDirectory,
      outputDirectory: recordDirectory,
      apiKey,
      expectedProgramId: targetId,
      apiBase,
    });
    await writeState(resolvedFile, {
      programId: report.target.id,
      sourceSha256: release.candidateSha256,
    });
    if (workspace.retainReceipt) {
      await rm(bundleDirectory, { recursive: true, force: true });
    } else {
      await rm(temporary, { recursive: true, force: true });
    }
    return { target: report.target, stateFile: resolvedFile };
  } catch (error) {
    if (!deploymentStarted) {
      await rm(temporary, { recursive: true, force: true });
    } else if (error && typeof error === "object") {
      error.recoveryDirectory = temporary;
    }
    throw error;
  }
}
