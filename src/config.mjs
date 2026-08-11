import { glob, readFile } from "node:fs/promises";
import path from "node:path";

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
    requireAllowedKeys(value, new Set(["program", "programId"]), `Check config deployment ${id}`);
    if (typeof value.programId !== "string" || !value.programId.trim()) {
      throw new Error(`Check config deployment ${id} programId is required`);
    }
    result[id] = {
      program: requireRelativePath(value.program, `Check config deployment ${id}.program`),
      programId: value.programId.trim(),
    };
  }
  return result;
}

export async function loadLiftosaurConfig(configFile) {
  const text = await readFile(configFile, "utf8");
  const config = parseJson(text, "Check config");
  requireObject(config, "Check config");
  requireAllowedKeys(
    config,
    new Set(["programs", "scenarios", "deployments"]),
    "Check config"
  );
  if (config.programs != null && !Array.isArray(config.programs)) {
    throw new Error("Check config programs must be an array");
  }
  const programs = (config.programs ?? []).map((value, index) => (
    requireRelativePath(value, `Check config programs[${index}]`)
  ));
  return {
    file: path.resolve(configFile),
    root: path.dirname(path.resolve(configFile)),
    programs,
    scenarios: validateScenarios(config.scenarios),
    deployments: validateDeployments(config.deployments),
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

export async function configuredDeployment(configFile, deploymentId = null) {
  const config = await loadLiftosaurConfig(configFile);
  let id = deploymentId;
  if (!id) {
    const ids = Object.keys(config.deployments);
    if (ids.length !== 1) {
      throw new Error("Deployment ID is required unless exactly one deployment is configured");
    }
    [id] = ids;
  }
  const deployment = config.deployments[id];
  if (!deployment) throw new Error(`Unknown configured deployment: ${id}`);
  return { config, deployment: { id, ...deployment } };
}
