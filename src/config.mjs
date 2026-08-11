import { glob, readFile } from "node:fs/promises";
import path from "node:path";

export const LIFTOSAUR_CHECK_CONFIG_V1 = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-check-config-v1",
});

export const LIFTOSAUR_CHECK_CONFIG = Object.freeze({
  formatVersion: 2,
  implementation: "liftosaur-check-config-v2",
});

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function requireAllowedKeys(value, allowed, label) {
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

export function requireRelativePath(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) throw new Error(`${label} must stay inside the repository`);
  if (/[\r\n\0]/.test(normalized)) throw new Error(`${label} contains invalid characters`);
  return normalized;
}

function validateScenarios(scenarios = []) {
  if (!Array.isArray(scenarios)) throw new Error("Check config scenarios must be an array");
  return scenarios.map((value, index) => {
    requireObject(value, `Check config scenarios[${index}]`);
    requireAllowedKeys(value, new Set(["program", "scenario", "snapshot"]), `Check config scenarios[${index}]`);
    return {
      program: requireRelativePath(value.program, `Check config scenarios[${index}].program`),
      scenario: requireRelativePath(value.scenario, `Check config scenarios[${index}].scenario`),
      snapshot: requireRelativePath(value.snapshot, `Check config scenarios[${index}].snapshot`),
    };
  });
}

function validateDeployments(deployments = {}) {
  requireObject(deployments, "Check config deployments");
  const result = {};
  for (const [id, value] of Object.entries(deployments)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid deployment ID: ${id}`);
    requireObject(value, `Check config deployment ${id}`);
    requireAllowedKeys(
      value,
      new Set(["program", "programId", "deployedProgramName"]),
      `Check config deployment ${id}`
    );
    if (typeof value.programId !== "string" || !value.programId.trim()) {
      throw new Error(`Check config deployment ${id} programId is required`);
    }
    if (value.deployedProgramName != null && (
      typeof value.deployedProgramName !== "string" || !value.deployedProgramName.trim()
    )) {
      throw new Error(`Check config deployment ${id} deployedProgramName must be a non-empty string`);
    }
    result[id] = {
      program: requireRelativePath(value.program, `Check config deployment ${id}.program`),
      programId: value.programId.trim(),
      deployedProgramName: value.deployedProgramName?.trim() ?? null,
    };
  }
  return result;
}

export async function loadLiftosaurConfig(configFile) {
  const text = await readFile(configFile, "utf8");
  const config = parseJson(text, "Check config");
  requireObject(config, "Check config");
  const isV1 = config.formatVersion === LIFTOSAUR_CHECK_CONFIG_V1.formatVersion
    && config.implementation === LIFTOSAUR_CHECK_CONFIG_V1.implementation;
  const isV2 = config.formatVersion === LIFTOSAUR_CHECK_CONFIG.formatVersion
    && config.implementation === LIFTOSAUR_CHECK_CONFIG.implementation;
  if (!isV1 && !isV2) throw new Error("Unsupported check config format");
  requireAllowedKeys(
    config,
    new Set(["formatVersion", "implementation", "programs", "scenarios", ...(isV2 ? ["deployments"] : [])]),
    "Check config"
  );
  if (config.programs != null && !Array.isArray(config.programs)) {
    throw new Error("Check config programs must be an array");
  }
  const programs = (config.programs ?? []).map((value, index) => (
    requireRelativePath(value, `Check config programs[${index}]`)
  ));
  return {
    formatVersion: config.formatVersion,
    implementation: config.implementation,
    file: path.resolve(configFile),
    root: path.dirname(path.resolve(configFile)),
    programs,
    scenarios: validateScenarios(config.scenarios),
    deployments: isV2 ? validateDeployments(config.deployments) : {},
  };
}

export async function discoverConfiguredPrograms(config) {
  const matches = new Set([
    ...config.scenarios.map(({ program }) => program),
    ...Object.values(config.deployments).map(({ program }) => program),
  ]);
  for (const pattern of config.programs) {
    for await (const file of glob(pattern, {
      cwd: config.root,
      exclude: ["**/.git/**", "**/.private/**", "**/node_modules/**"],
    })) {
      matches.add(file.replaceAll("\\", "/"));
    }
  }
  if (matches.size === 0) throw new Error("Check config does not reference any programs");
  return [...matches].sort();
}

export async function configuredDeployment(configFile, deploymentId) {
  const config = await loadLiftosaurConfig(configFile);
  const deployment = config.deployments[deploymentId];
  if (!deployment) throw new Error(`Unknown configured deployment: ${deploymentId}`);
  return { config, deployment: { id: deploymentId, ...deployment } };
}
