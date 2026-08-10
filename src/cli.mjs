import { createHash } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { mergeLiftosaurSources } from "./merge.mjs";
import {
  LIFTOSAUR_VALIDATOR,
  LiftosaurValidationError,
  validateLiftosaurSource,
} from "./validate.mjs";

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

  liftosaur-ci validate \\
    --program <program.liftoscript> \\
    [--report <validation-report.json>]

Offline only. Commands read immutable inputs and optionally write checksum-bearing
reports. Merge is fail-closed. Existing output or report files are never overwritten.`;
}

function parseOptions(argv, allowedNames) {
  const options = {};
  const allowed = new Set(allowedNames);
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

function parseMergeOptions(argv) {
  return parseOptions(argv, ["base", "active", "candidate", "output", "report"]);
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

async function runValidate(argv) {
  const options = parseOptions(argv, ["program", "report"]);
  const program = requireOption(options, "program");
  const reportFile = options.report ? path.resolve(options.report) : null;
  if (reportFile === program) {
    throw new CliError(`Validation report must not replace the input file: ${program}`);
  }
  if (reportFile) await requireNewFile(reportFile, "Validation report");

  const source = await readFile(program, "utf8");
  try {
    const result = validateLiftosaurSource(source);
    const report = {
      formatVersion: 1,
      command: "validate",
      cli: LIFTOSAUR_CI_CLI,
      status: "passed",
      input: { sha256: sha256(source) },
      serialized: { sha256: sha256(result.serializedSource) },
      validator: result.validator,
      summary: result.summary,
    };
    if (reportFile) {
      await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    console.log(
      `Liftosaur native validation passed: ${result.summary.days} days, `
      + `${result.summary.exercises} exercises, ${result.summary.completedSets} completed sets`
    );
  } catch (error) {
    if (!(error instanceof LiftosaurValidationError)) throw error;
    const report = {
      formatVersion: 1,
      command: "validate",
      cli: LIFTOSAUR_CI_CLI,
      status: "failed",
      input: { sha256: sha256(source) },
      validator: LIFTOSAUR_VALIDATOR,
      failure: {
        stage: error.stage,
        message: error.message,
        details: error.details,
      },
    };
    if (reportFile) {
      await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    }
    throw new CliError(error.message);
  }
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
  if (command !== "merge" && command !== "validate") {
    throw new CliError(`Unknown command: ${command}`);
  }
  if (commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h")) {
    console.log(usage());
    return;
  }
  if (command === "merge") await runMerge(commandArgs);
  else await runValidate(commandArgs);
}
