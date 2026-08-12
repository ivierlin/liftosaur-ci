import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  fetchDeploymentTarget,
  prepareDeploymentBundleFromContents,
} from "./deployment.mjs";
import { mergeLiftosaurSources } from "./merge.mjs";
import { createMergeReport, createValidationReport } from "./report.mjs";
import { validateLiftosaurSource } from "./validate.mjs";

export class LiftosaurPreparationError extends Error {
  constructor(message, stage, exitCode = 1) {
    super(message);
    this.stage = stage;
    this.exitCode = exitCode;
  }
}

async function writeConflictWorkspace({ outputDirectory, base, active, candidate, conflictSource, mergeReport }) {
  await mkdir(outputDirectory, { recursive: false });
  await Promise.all([
    writeFile(path.join(outputDirectory, "base.liftoscript"), base, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(outputDirectory, "active.liftoscript"), active, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(outputDirectory, "candidate.liftoscript"), candidate, { encoding: "utf8", flag: "wx" }),
    writeFile(path.join(outputDirectory, "conflict.txt"), conflictSource, { encoding: "utf8", flag: "wx" }),
    writeFile(
      path.join(outputDirectory, "merge-report.json"),
      `${JSON.stringify(mergeReport, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    ),
  ]);
}

export async function prepareLiftosaurDeployment({
  baseFile,
  candidateFile,
  outputDirectory,
  programId,
  apiKey,
  apiBase,
  programName = null,
}) {
  const [base, candidate] = await Promise.all([
    readFile(baseFile, "utf8"),
    readFile(candidateFile, "utf8"),
  ]);
  return prepareLiftosaurDeploymentFromContents({
    base,
    candidate,
    outputDirectory,
    programId,
    apiKey,
    apiBase,
    programName,
  });
}

export async function prepareLiftosaurDeploymentFromContents({
  base,
  candidate,
  outputDirectory,
  programId,
  apiKey,
  apiBase,
  source = null,
  programName = null,
}) {
  const activeProgram = await fetchDeploymentTarget({ programId, apiKey, apiBase });
  const active = activeProgram.text;

  let merged;
  try {
    merged = await mergeLiftosaurSources({ base, active, candidate });
  } catch (error) {
    throw new LiftosaurPreparationError(
      `Liftosaur merge preparation failed: ${error instanceof Error ? error.message : String(error)}`,
      "merge"
    );
  }
  const mergeReport = createMergeReport({ base, active, candidate }, merged);
  if (!merged.source) {
    const conflictOutput = process.env.LIFTOSAUR_CI_CONFLICT_OUTPUT?.trim();
    if (!conflictOutput) {
      throw new LiftosaurPreparationError(
        [
          "Liftosaur deployment preparation has unresolved three-way merge conflicts. No deployment was performed.",
          "Live Liftosaur state was NOT written to disk.",
          "To preserve a private conflict workspace for inspection, rerun with:",
          "  --conflict-output <directory>",
          "The workspace will contain athlete-specific live state. Do not commit it.",
        ].join("\n"),
        "merge",
        2
      );
    }
    await writeConflictWorkspace({
      outputDirectory: conflictOutput,
      base,
      active,
      candidate,
      conflictSource: merged.conflictSource,
      mergeReport,
    });
    const baseFile = path.join(conflictOutput, "base.liftoscript");
    const activeFile = path.join(conflictOutput, "active.liftoscript");
    const candidateFile = path.join(conflictOutput, "candidate.liftoscript");
    throw new LiftosaurPreparationError(
      [
        "Liftosaur deployment preparation has unresolved three-way merge conflicts. No deployment was performed.",
        `Private conflict workspace: ${conflictOutput}`,
        "Contains athlete-specific live state. Do not commit it.",
        `Live changes: git diff --no-index \"${baseFile}\" \"${activeFile}\"`,
        `Candidate changes: git diff --no-index \"${baseFile}\" \"${candidateFile}\"`,
      ].join("\n"),
      "merge",
      2
    );
  }

  let validation;
  try {
    validation = validateLiftosaurSource(merged.source);
  } catch (error) {
    throw new LiftosaurPreparationError(
      `Liftosaur deployment validation failed: ${error instanceof Error ? error.message : String(error)}`,
      "validate"
    );
  }
  const validationReport = createValidationReport(merged.source, validation);
  const manifest = await prepareDeploymentBundleFromContents({
    active,
    deploy: merged.source,
    validationText: `${JSON.stringify(validationReport, null, 2)}\n`,
    mergeText: `${JSON.stringify(mergeReport, null, 2)}\n`,
    outputDirectory,
    target: { id: activeProgram.id, name: activeProgram.name },
    programName,
    source,
  });
  return {
    manifest,
    merge: mergeReport.merge,
    validation: validation.summary,
  };
}
