#!/usr/bin/env node

import process from "node:process";

import { CliError, runLiftosaurCi } from "../src/cli.mjs";
import { runRestoreCli } from "../src/restore.mjs";

const args = process.argv.slice(2);
const restoreCommand = args[0] === "restore";
const coreHelp = !restoreCommand && (
  args.length === 0
  || args[0] === "--help"
  || args[0] === "-h"
  || (args.length === 2 && (args[1] === "--help" || args[1] === "-h"))
);
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
});
