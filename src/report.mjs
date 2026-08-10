import { createHash } from "node:crypto";

export const LIFTOSAUR_CI_CLI = Object.freeze({
  name: "liftosaur-ci",
  version: "0.1.0",
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    progressedSource: { sha256: sha256(result.serializedSource) },
  };
}
