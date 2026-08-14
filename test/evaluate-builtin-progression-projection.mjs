// Exploratory evaluator for docs/builtin-base-detection-evaluation.md.
// This is not production detection behavior and makes no bootstrap decision.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectLiftosaurSourceForInitialization } from "../src/frontend.mjs";
import {
  progressNominalLiftosaurSourceForTesting,
  validateLiftosaurSource,
} from "../src/validate-core.mjs";

const depths = [1, 4, 8, 16];
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(testDirectory);
const runtime = path.resolve(
  process.env.LIFTOSAUR_RUNTIME
    ?? path.join(repositoryRoot, ".private", "liftosaur-runtime")
);
const builtinDirectory = path.join(runtime, "programs", "builtin");

function extractLiftoscript(markdown, filename) {
  const matches = [...markdown.matchAll(/```liftoscript\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) {
    throw new Error(`${filename} must contain exactly one Liftoscript block`);
  }
  return `${matches[0][1]}\n`;
}

const filenames = (await readdir(builtinDirectory))
  .filter((filename) => filename.endsWith(".md"))
  .sort();
const results = [];

function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const line = expectedLines.findIndex((value, index) => value !== actualLines[index]);
  return line < 0 ? undefined : {
    line: line + 1,
    original: expectedLines.slice(line, line + 3),
    progressed: actualLines.slice(line, line + 3),
  };
}

for (const filename of filenames) {
  const originalSource = extractLiftoscript(
    await readFile(path.join(builtinDirectory, filename), "utf8"),
    filename
  );
  const originalProjection = projectLiftosaurSourceForInitialization(originalSource);
  let source = originalSource;
  let context;
  let day = 1;
  const matches = {};
  const serializedBaselineMatches = {};
  let serializedBaselineFirstDifference;
  let pristineSerializationMatches;
  let serializedBaselineProjection;
  let originalFirstDifference;
  let failure;

  try {
    const validation = validateLiftosaurSource(originalSource);
    serializedBaselineProjection = projectLiftosaurSourceForInitialization(
      validation.serializedSource
    );
    pristineSerializationMatches = serializedBaselineProjection === originalProjection;
    for (let exposure = 1; exposure <= depths.at(-1); exposure += 1) {
      const progressed = progressNominalLiftosaurSourceForTesting(source, day, context);
      source = progressed.serializedSource;
      context = progressed.context;
      day = progressed.nextDay;
      if (depths.includes(exposure)) {
        const progressedProjection = projectLiftosaurSourceForInitialization(source);
        matches[exposure] = progressedProjection === originalProjection;
        serializedBaselineMatches[exposure] = progressedProjection
          === serializedBaselineProjection;
        if (exposure === 1 && !serializedBaselineMatches[exposure]) {
          serializedBaselineFirstDifference = firstDifference(
            serializedBaselineProjection,
            progressedProjection
          );
        }
        if (exposure === 1 && !matches[exposure]) {
          originalFirstDifference = firstDifference(originalProjection, progressedProjection);
        }
      }
    }
  } catch (error) {
    failure = {
      exposure: Object.keys(matches).length === 0 ? 1 : Number(Object.keys(matches).at(-1)) + 1,
      stage: error?.stage ?? "unknown",
      message: error instanceof Error ? error.message : String(error),
      details: error?.details ?? [],
    };
  }

  results.push({
    filename,
    pristineSerializationMatches,
    matches,
    originalFirstDifference,
    serializedBaselineMatches,
    serializedBaselineFirstDifference,
    ...(failure ? { failure } : {}),
  });
}

const summary = Object.fromEntries(depths.map((depth) => [depth, {
  matched: results.filter((result) => result.matches[depth] === true).length,
  mismatched: results.filter((result) => result.matches[depth] === false).length,
  executable: results.filter((result) => Object.hasOwn(result.matches, depth)).length,
  serializedBaselineMatched: results.filter(
    (result) => result.serializedBaselineMatches[depth] === true
  ).length,
  serializedBaselineMismatched: results.filter(
    (result) => result.serializedBaselineMatches[depth] === false
  ).length,
}]));

const pristineSerialization = {
  matched: results.filter((result) => result.pristineSerializationMatches === true).length,
  mismatched: results.filter((result) => result.pristineSerializationMatches === false).length,
  executable: results.filter(
    (result) => typeof result.pristineSerializationMatches === "boolean"
  ).length,
};

process.stdout.write(`${JSON.stringify({
  corpus: filenames.length,
  depths,
  pristineSerialization,
  summary,
  results,
}, null, 2)}\n`);
