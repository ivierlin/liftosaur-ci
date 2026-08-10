import { readFile } from "node:fs/promises";

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

export async function prepareLiftosaurDeployment({
  baseFile,
  candidateFile,
  outputDirectory,
  programId,
  expectedProgramName,
  deployedProgramName,
  apiKey,
  apiBase,
}) {
  const [base, candidate, activeProgram] = await Promise.all([
    readFile(baseFile, "utf8"),
    readFile(candidateFile, "utf8"),
    fetchDeploymentTarget({
      programId,
      expectedName: expectedProgramName,
      apiKey,
      apiBase,
    }),
  ]);
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
    throw new LiftosaurPreparationError(
      "Liftosaur deployment preparation has unresolved three-way merge conflicts",
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
    target: {
      id: activeProgram.id,
      name: activeProgram.name,
      isCurrent: activeProgram.isCurrent,
    },
    deployedName: deployedProgramName,
  });
  return {
    manifest,
    merge: mergeReport.merge,
    validation: validation.summary,
  };
}
