#!/usr/bin/env node

import process from "node:process";

import { CliError, runLiftosaurCi } from "../src/cli.mjs";

runLiftosaurCi(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
});
