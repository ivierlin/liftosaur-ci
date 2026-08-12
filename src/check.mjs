import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { discoverConfiguredPrograms, loadLiftosaurConfig } from "./config.mjs";
import { createScenarioSnapshot, snapshotForComparison } from "./report.mjs";
import { assertScenarioSchema } from "./scenario-schema.mjs";
import {
  snapshotLiftosaurScenario,
  validateLiftosaurSource,
} from "./validate.mjs";

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
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
  const definition = await loadLiftosaurConfig(configFile);
  const root = definition.root;
  const programs = await discoverConfiguredPrograms(definition);

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
        assertScenarioSchema(scenarioDefinition);
        const expected = snapshotForComparison(parseJson(expectedText, `Snapshot ${scenario.snapshot}`));
        const actual = snapshotForComparison(JSON.parse(JSON.stringify(createScenarioSnapshot(
          source,
          scenarioText,
          snapshotLiftosaurScenario(source, scenarioDefinition)
        ))));
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
