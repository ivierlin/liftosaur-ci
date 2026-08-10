import { createHash } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { mergeLiftosaurSources } from "./merge.mjs";

export const LIFTOSAUR_CI_CLI = Object.freeze({
  name: "liftosaur-ci",
  version: "0.1.0",
});

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage:
  liftosaur-ci merge \\
    --base <previously-deployed.liftoscript> \\
    --active <current-liftosaur.liftoscript> \\
    --candidate <new-git-source.liftoscript> \\
    --output <merged.liftoscript> \\
    [--report <merge-report.json>]

Offline only. The command reads three immutable inputs, performs a fail-closed
three-way merge, and writes a new output plus optional checksum-bearing report.
Existing output or report files are never overwritten.`;
}

function parseMergeOptions(argv) {
  const options = {};
  const allowed = new Set(["base", "active", "candidate", "output", "report"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new CliError(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (!allowed.has(name)) throw new CliError(`Unknown option: ${argument}`);
    if (Object.hasOwn(options, name)) throw new CliError(`Duplicate option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new CliError(`Missing value for ${argument}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new CliError(`Missing required option: --${name}`);
  return path.resolve(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireNewFile(file, label) {
  try {
    await access(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new CliError(`${label} already exists: ${file}`);
}

function requireDistinctPaths(inputs, outputs) {
  const inputPaths = new Set(Object.values(inputs));
  for (const [label, output] of Object.entries(outputs)) {
    if (output && inputPaths.has(output)) {
      throw new CliError(`${label} must not replace an input file: ${output}`);
    }
  }
  if (outputs.report && outputs.report === outputs.output) {
    throw new CliError("Merge output and report must use different paths");
  }
}

async function runMerge(argv) {
  const options = parseMergeOptions(argv);
  const inputs = {
    base: requireOption(options, "base"),
    active: requireOption(options, "active"),
    candidate: requireOption(options, "candidate"),
  };
  const outputs = {
    output: requireOption(options, "output"),
    report: options.report ? path.resolve(options.report) : null,
  };
  requireDistinctPaths(inputs, outputs);
  await requireNewFile(outputs.output, "Merge output");
  if (outputs.report) await requireNewFile(outputs.report, "Merge report");

  const [base, active, candidate] = await Promise.all(
    Object.values(inputs).map((file) => readFile(file, "utf8"))
  );
  const result = await mergeLiftosaurSources({ base, active, candidate });
  const report = {
    formatVersion: 1,
    command: "merge",
    cli: LIFTOSAUR_CI_CLI,
    status: result.report.status,
    inputs: {
      base: { sha256: sha256(base) },
      active: { sha256: sha256(active) },
      candidate: { sha256: sha256(candidate) },
    },
    output: result.source ? { sha256: sha256(result.source) } : null,
    merge: result.report,
  };

  if (!result.source) {
    if (outputs.report) {
      await writeFile(outputs.report, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    throw new CliError("Liftosaur source has unresolved three-way merge conflicts", 2);
  }
  await writeFile(outputs.output, result.source, { encoding: "utf8", flag: "wx" });
  try {
    if (outputs.report) {
      await writeFile(outputs.report, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
  } catch (error) {
    await rm(outputs.output, { force: true });
    throw error;
  }
  console.log(`Liftosaur three-way merge passed: ${outputs.output}`);
}

export async function runLiftosaurCi(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return;
  }
  if (argv[0] === "--version") {
    console.log(`${LIFTOSAUR_CI_CLI.name} ${LIFTOSAUR_CI_CLI.version}`);
    return;
  }
  const [command, ...commandArgs] = argv;
  if (command !== "merge") throw new CliError(`Unknown command: ${command}`);
  if (commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h")) {
    console.log(usage());
    return;
  }
  await runMerge(commandArgs);
}
