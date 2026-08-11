#!/usr/bin/env node

import process from "node:process";

import { CliError, runLiftosaurCi } from "../src/cli.mjs";
import { runRestoreCli } from "../src/restore.mjs";

const args = process.argv.slice(2);
const globalHelp = args.length === 0 || args[0] === "--help" || args[0] === "-h";
const command = args[0] === "restore"
  ? runRestoreCli(args.slice(1))
  : runLiftosaurCi(args);

command.then(() => {
  if (globalHelp) {
    console.log(`\nAdvanced recovery:\n  liftosaur-ci restore \\\n    --artifact <historical-deployment-bundle> \\\n    [--api-base <url>]`);
  }
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
