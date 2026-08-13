import { spawnSync } from "node:child_process";
import path from "node:path";

import { prepareLiftosaurDeploymentFromContents } from "./prepare.mjs";

function git(repository, args, label) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label}: ${result.stderr.trim() || `git exited with ${result.status}`}`);
  }
  return result.stdout;
}

function requireProgramPath(value) {
  if (
    typeof value !== "string"
    || !value
    || path.posix.isAbsolute(value)
    || value.includes("\\")
    || value.split("/").includes("..")
    || /[\r\n\0]/.test(value)
  ) {
    throw new Error("Git program path must be a repository-relative POSIX path");
  }
  return value;
}

function requireRef(value, label) {
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} must be a non-empty Git ref`);
  }
  return value;
}

function remoteIdentity(value) {
  const remote = value.trim();
  if (!remote || /[\r\n\0]/.test(remote)) throw new Error("Git origin remote is missing or invalid");
  if (/^[^/@\s]+@[^/:\s]+:.+$/.test(remote)) return remote;
  let parsed;
  try {
    parsed = new URL(remote);
  } catch {
    throw new Error("Git origin must be a non-local URL");
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) {
    throw new Error("Git origin must use HTTP, SSH, or Git transport");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Git origin must not contain credentials, query parameters, or fragments");
  }
  return parsed.toString();
}

function revision(repository, requestedRef, programPath, label) {
  const ref = requireRef(requestedRef, label);
  const commitSha = git(
    repository,
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    `Cannot resolve ${label}`
  ).trim();
  const blobSha = git(
    repository,
    ["rev-parse", "--verify", "--end-of-options", `${commitSha}:${programPath}`],
    `Cannot resolve ${programPath} at ${label}`
  ).trim();
  const type = git(repository, ["cat-file", "-t", blobSha], `Cannot inspect ${label} program`).trim();
  if (type !== "blob") throw new Error(`${programPath} at ${label} is not a file`);
  const source = git(repository, ["cat-file", "blob", blobSha], `Cannot read ${label} program`);
  return { requestedRef: ref, commitSha, blobSha, source };
}

export function readGitProgramPair({ repository, baseRef, candidateRef = "HEAD", programPath }) {
  const requestedRepository = path.resolve(repository);
  const root = git(requestedRepository, ["rev-parse", "--show-toplevel"], "Not a Git repository").trim();
  const cleanPath = requireProgramPath(programPath);
  const objectFormat = git(root, ["rev-parse", "--show-object-format"], "Cannot identify Git object format").trim();
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error(`Unsupported Git object format: ${objectFormat}`);
  }
  const remote = remoteIdentity(git(root, ["remote", "get-url", "origin"], "Git origin is unavailable"));
  const base = revision(root, baseRef, cleanPath, "base ref");
  const candidate = revision(root, candidateRef, cleanPath, "candidate ref");
  return {
    base: base.source,
    candidate: candidate.source,
    source: {
      remote,
      objectFormat,
      programPath: cleanPath,
      base: {
        requestedRef: base.requestedRef,
        commitSha: base.commitSha,
        blobSha: base.blobSha,
      },
      candidate: {
        requestedRef: candidate.requestedRef,
        commitSha: candidate.commitSha,
        blobSha: candidate.blobSha,
      },
    },
  };
}

export async function prepareGitDeployment({
  repository,
  baseRef,
  candidateRef = "HEAD",
  programPath,
  outputDirectory,
  programId,
  expectedBase = null,
  apiKey,
  apiBase,
  programName = null,
  conflictOutput = null,
}) {
  if (!programId) throw new Error("Git deployment preparation requires a Liftosaur program ID or current");
  const programs = readGitProgramPair({ repository, baseRef, candidateRef, programPath });
  if (expectedBase && (
    programs.source.base.commitSha !== expectedBase.commitSha
    || programs.source.base.blobSha !== expectedBase.blobSha
  )) {
    throw new Error("Resolved Git base does not match tracked deployment state");
  }
  return prepareLiftosaurDeploymentFromContents({
    base: programs.base,
    candidate: programs.candidate,
    outputDirectory,
    programId,
    apiKey,
    apiBase,
    source: programs.source,
    programName,
    conflictOutput,
  });
}
