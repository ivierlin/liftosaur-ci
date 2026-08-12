import { createHash } from "node:crypto";
export const LIFTOSAUR_CI_CLI = Object.freeze({
  name: "liftosaur-ci",
  version: "0.1.0",
});

export function snapshotForComparison(snapshot) {
  if (!snapshot?.cli || typeof snapshot.cli !== "object" || Array.isArray(snapshot.cli)) {
    return snapshot;
  }
  const { version: _version, ...cli } = snapshot.cli;
  return { ...snapshot, cli };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createMergeReport({ base, active, candidate }, result) {
  return {
    command: "merge",
    cli: LIFTOSAUR_CI_CLI,
    status: result.report.status,
    inputs: {
      base: { sha256: sha256(base) },
      active: { sha256: sha256(active) },
      candidate: { sha256: sha256(candidate) },
    },
    output: result.source ? { sha256: sha256(result.source) } : null,
    merge: result.report,
  };
}

export function createValidationReport(source, result) {
  return {
    command: "validate",
    cli: LIFTOSAUR_CI_CLI,
    status: "passed",
    input: { sha256: sha256(source) },
    serialized: { sha256: sha256(result.serializedSource) },
    validator: result.validator,
    summary: result.summary,
  };
}

export function createBuiltinSnapshot(source, result) {
  return {
    ...result.snapshot,
    command: "builtin-snapshot",
    cli: LIFTOSAUR_CI_CLI,
    input: { sha256: sha256(source) },
  };
}

export function createScenarioSnapshot(source, scenarioText, result) {
  return {
    ...result.snapshot,
    command: "snapshot",
    cli: LIFTOSAUR_CI_CLI,
    inputs: {
      program: { sha256: sha256(source) },
      scenario: { sha256: sha256(scenarioText) },
    },
    ...(result.serializedSource == null
      ? {}
      : { progressedSource: { sha256: sha256(result.serializedSource) } }),
  };
}
