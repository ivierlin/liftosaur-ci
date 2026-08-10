import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { createScenarioSnapshot } from "./report.mjs";
import {
  snapshotLiftosaurScenario,
  validateLiftosaurSource,
} from "./validate.mjs";

export const LIFTOSAUR_CHECK_CONFIG = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-check-config-v1",
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

function requireRelativePath(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) throw new Error(`${label} must stay inside the repository`);
  return normalized;
}

function validateConfig(config) {
  requireObject(config, "Check config");
  requireAllowedKeys(
    config,
    new Set(["formatVersion", "implementation", "programs", "scenarios"]),
    "Check config"
  );
  if (
    config.formatVersion !== LIFTOSAUR_CHECK_CONFIG.formatVersion
    || config.implementation !== LIFTOSAUR_CHECK_CONFIG.implementation
  ) {
    throw new Error("Unsupported check config format");
  }
  if (!Array.isArray(config.programs) || config.programs.length === 0) {
    throw new Error("Check config programs must contain at least one glob");
  }
  const programs = config.programs.map((value, index) => (
    requireRelativePath(value, `Check config programs[${index}]`)
  ));
  const scenarios = config.scenarios ?? [];
  if (!Array.isArray(scenarios)) throw new Error("Check config scenarios must be an array");
  const checkedScenarios = scenarios.map((value, index) => {
    requireObject(value, `Check config scenarios[${index}]`);
    requireAllowedKeys(value, new Set(["program", "scenario", "snapshot"]), `Check config scenarios[${index}]`);
    return {
      program: requireRelativePath(value.program, `Check config scenarios[${index}].program`),
      scenario: requireRelativePath(value.scenario, `Check config scenarios[${index}].scenario`),
      snapshot: requireRelativePath(value.snapshot, `Check config scenarios[${index}].snapshot`),
    };
  });
  return { programs, scenarios: checkedScenarios };
}

async function discoverPrograms(root, patterns) {
  const matches = new Set();
  for (const pattern of patterns) {
    for await (const file of glob(pattern, {
      cwd: root,
      exclude: ["**/.git/**", "**/.private/**", "**/node_modules/**"],
    })) {
      matches.add(file.replaceAll("\\", "/"));
    }
  }
  if (matches.size === 0) throw new Error("Check config did not discover any programs");
  return [...matches].sort();
}

function failure(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    ...(error?.stage ? { stage: error.stage } : {}),
  };
}

function firstDifference(actual, expected, location = "$") {
  if (Object.is(actual, expected)) return null;
  if (
    !actual
    || !expected
    || typeof actual !== "object"
    || typeof expected !== "object"
    || Array.isArray(actual) !== Array.isArray(expected)
  ) {
    return { path: location, expected, actual };
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    const difference = firstDifference(actual[key], expected[key], `${location}.${key}`);
    if (difference) return difference;
  }
  return null;
}

export async function checkRepository(configFile) {
  const configText = await readFile(configFile, "utf8");
  const root = path.dirname(configFile);
  const definition = validateConfig(parseJson(configText, "Check config"));
  const programs = await discoverPrograms(root, definition.programs);
  const programSet = new Set(programs);
  for (const scenario of definition.scenarios) {
    if (!programSet.has(scenario.program)) {
      throw new Error(`Scenario program is not discovered by programs globs: ${scenario.program}`);
    }
  }

  const results = [];
  for (const program of programs) {
    const programFile = path.join(root, program);
    let source;
    try {
      source = await readFile(programFile, "utf8");
      const result = validateLiftosaurSource(source);
      results.push({ program, status: "passed", summary: result.summary, scenarios: [] });
    } catch (error) {
      results.push({ program, status: "failed", failure: failure(error), scenarios: [] });
      continue;
    }
    const programResult = results.at(-1);
    for (const scenario of definition.scenarios.filter((item) => item.program === program)) {
      try {
        const [scenarioText, expectedText] = await Promise.all([
          readFile(path.join(root, scenario.scenario), "utf8"),
          readFile(path.join(root, scenario.snapshot), "utf8"),
        ]);
        const scenarioDefinition = parseJson(scenarioText, `Scenario ${scenario.scenario}`);
        const expected = parseJson(expectedText, `Snapshot ${scenario.snapshot}`);
        const actual = JSON.parse(JSON.stringify(createScenarioSnapshot(
          source,
          scenarioText,
          snapshotLiftosaurScenario(source, scenarioDefinition)
        )));
        if (!isDeepStrictEqual(actual, expected)) {
          const error = new Error(`Reviewed snapshot changed: ${scenario.snapshot}`);
          error.difference = firstDifference(actual, expected);
          throw error;
        }
        programResult.scenarios.push({
          scenario: scenario.scenario,
          snapshot: scenario.snapshot,
          status: "passed",
        });
      } catch (error) {
        programResult.status = "failed";
        programResult.scenarios.push({
          scenario: scenario.scenario,
          snapshot: scenario.snapshot,
          status: "failed",
          failure: {
            ...failure(error),
            ...(error?.difference ? { difference: error.difference } : {}),
          },
        });
      }
    }
  }

  const passed = results.filter(({ status }) => status === "passed").length;
  return {
    formatVersion: 1,
    command: "check",
    status: passed === results.length ? "passed" : "failed",
    config: path.basename(configFile),
    summary: {
      programs: results.length,
      passed,
      failed: results.length - passed,
      scenarios: results.reduce((count, result) => count + result.scenarios.length, 0),
    },
    programs: results,
  };
}
