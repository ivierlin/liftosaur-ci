#!/usr/bin/env node

import process from "node:process";

import { CliError, runLiftosaurCi } from "../src/cli.mjs";
import { extractConflictOutput } from "../src/entry-options.mjs";
import { runRestoreCli } from "../src/restore.mjs";

let args = process.argv.slice(2);
let conflictOutput = null;
try {
  ({ args, conflictOutput } = extractConflictOutput(args));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

if (process.exitCode) {
  // Entry-option parsing failed before command dispatch.
} else {
  const restoreCommand = args[0] === "restore";
  const coreHelp = !restoreCommand && (
    args.length === 0
    || args[0] === "--help"
    || args[0] === "-h"
    || (args.length === 2 && (args[1] === "--help" || args[1] === "-h"))
  );
  if (conflictOutput) process.env.LIFTOSAUR_CI_CONFLICT_OUTPUT = conflictOutput;
  const command = restoreCommand
    ? runRestoreCli(args.slice(1))
    : runLiftosaurCi(args);

  command.then(() => {
    if (coreHelp) {
      console.log(`\nAdvanced recovery:\n  liftosaur-ci restore \\\n    --artifact <historical-deployment-bundle> \\\n    [--api-base <url>]`);
    }
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }).finally(() => {
    delete process.env.LIFTOSAUR_CI_CONFLICT_OUTPUT;
  });
}
