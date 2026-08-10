import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { checkRepository } from "./check.mjs";
import { configuredGitPreparation, recordDeploymentState } from "./deployment-state.mjs";
import { deployPreparedBundle, prepareDeploymentBundle } from "./deployment.mjs";
import { prepareGitDeployment } from "./git.mjs";
import { mergeLiftosaurSources } from "./merge.mjs";
import { LiftosaurPreparationError, prepareLiftosaurDeployment } from "./prepare.mjs";
import {
  createMergeReport,
  createScenarioSnapshot,
  createValidationReport,
  LIFTOSAUR_CI_CLI,
  sha256,
} from "./report.mjs";
import {
  LIFTOSAUR_VALIDATOR,
  LiftosaurValidationError,
  snapshotLiftosaurScenario,
  validateLiftosaurSource,
} from "./validate.mjs";

export { LIFTOSAUR_CI_CLI } from "./report.mjs";

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

  liftosaur-ci snapshot \\
    --program <program.liftoscript> \\
    --scenario <scenario.json> \\
    --output <snapshot.json>

  liftosaur-ci prepare-deployment \\
    --active <current-liftosaur.liftoscript> \\
    --program <validated-program.liftoscript> \\
    --validation-report <validation-report.json> \\
    [--merge-report <merge-report.json>] \\
    --program-id <liftosaur-program-id> \\
    --expected-program-name <current-name> \\
    --expected-current <true|false> \\
    --deployed-program-name <new-name> \\
    --output <deployment-bundle-directory>

  liftosaur-ci prepare \\
    --base <previously-deployed.liftoscript> \\
    --candidate <new-git-source.liftoscript> \\
    --program-id <liftosaur-program-id|current> \\
    --expected-program-name <current-name> \\
    --deployed-program-name <new-name> \\
    --output <deployment-bundle-directory> \\
    [--api-base <url>]

  liftosaur-ci prepare-git \\
    [--repository <git-worktree>] \\
    [--config <liftosaur-ci.json> --deployment <stable-id>] \\
    [--base-ref <last-deployed-ref>] \\
    --candidate-ref <reviewed-ref> \\
    [--program <repository-relative-path>] \\
    [--program-id <exact-liftosaur-program-id>] \\
    [--deployed-program-name <new-name>] \\
    --output <deployment-bundle-directory> \\
    [--api-base <url>]

  liftosaur-ci deploy \\
    --bundle <deployment-bundle-directory> \\
    --confirm-program-id <liftosaur-program-id> \\
    --confirm-program-name <new-name> \\
    --output <private-deployment-record-directory> \\
    [--max-age-hours <hours>] \\
    [--api-base <url>]

  liftosaur-ci record-deployment \\
    --config <liftosaur-ci.json> \\
    --deployment <stable-id> \\
    --report <private-deployment-report.json>

  liftosaur-ci check \\
    [--config <liftosaur-ci.json>] \\
    [--report <check-report.json>]

Merge, validation, snapshots, checks, and prepare-deployment are offline.
Prepare and prepare-git read LIFTOSAUR_API_KEY but only read Liftosaur. Deploy
uses the same environment variable and changes exactly one prepared target.
Existing output files and directories are never overwritten.`;
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

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new CliError(`Missing required option: --${name}`);
  return path.resolve(value);
}

function requireTextOption(options, name) {
  const value = options[name];
  if (!value) throw new CliError(`Missing required option: --${name}`);
  return value;
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
  const options = parseOptions(argv, ["base", "active", "candidate", "output", "report"]);
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
  const report = createMergeReport({ base, active, candidate }, result);
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
  if (reportFile === program) throw new CliError(`Validation report must not replace the input file: ${program}`);
  if (reportFile) await requireNewFile(reportFile, "Validation report");
  const source = await readFile(program, "utf8");
  try {
    const result = validateLiftosaurSource(source);
    const report = createValidationReport(source, result);
    if (reportFile) {
      await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
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
      failure: { stage: error.stage, message: error.message, details: error.details },
    };
    if (reportFile) {
      await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    throw new CliError(error.message);
  }
}

async function runSnapshot(argv) {
  const options = parseOptions(argv, ["program", "scenario", "output"]);
  const inputs = {
    program: requireOption(options, "program"),
    scenario: requireOption(options, "scenario"),
  };
  const output = requireOption(options, "output");
  requireDistinctPaths(inputs, { output });
  await requireNewFile(output, "Scenario snapshot");
  const [source, scenarioText] = await Promise.all([
    readFile(inputs.program, "utf8"),
    readFile(inputs.scenario, "utf8"),
  ]);
  let scenario;
  try {
    scenario = JSON.parse(scenarioText);
  } catch (error) {
    throw new CliError(`Scenario is not valid JSON: ${error.message}`);
  }
  const snapshot = createScenarioSnapshot(
    source,
    scenarioText,
    snapshotLiftosaurScenario(source, scenario)
  );
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`Liftosaur scenario snapshot written: ${output}`);
}

async function runPrepareDeployment(argv) {
  const options = parseOptions(argv, [
    "active",
    "program",
    "validation-report",
    "merge-report",
    "program-id",
    "expected-program-name",
    "expected-current",
    "deployed-program-name",
    "output",
  ]);
  const expectedCurrent = requireTextOption(options, "expected-current");
  if (expectedCurrent !== "true" && expectedCurrent !== "false") {
    throw new CliError("--expected-current must be true or false");
  }
  const outputDirectory = requireOption(options, "output");
  await prepareDeploymentBundle({
    activeFile: requireOption(options, "active"),
    deployFile: requireOption(options, "program"),
    validationReportFile: requireOption(options, "validation-report"),
    mergeReportFile: options["merge-report"] ? path.resolve(options["merge-report"]) : null,
    outputDirectory,
    target: {
      id: requireTextOption(options, "program-id"),
      name: requireTextOption(options, "expected-program-name"),
      isCurrent: expectedCurrent === "true",
    },
    deployedName: requireTextOption(options, "deployed-program-name"),
  });
  console.log(`Liftosaur deployment bundle prepared: ${outputDirectory}`);
}

async function runPrepare(argv) {
  const options = parseOptions(argv, [
    "base",
    "candidate",
    "program-id",
    "expected-program-name",
    "deployed-program-name",
    "output",
    "api-base",
  ]);
  const outputDirectory = requireOption(options, "output");
  try {
    const result = await prepareLiftosaurDeployment({
      baseFile: requireOption(options, "base"),
      candidateFile: requireOption(options, "candidate"),
      outputDirectory,
      programId: requireTextOption(options, "program-id"),
      expectedProgramName: requireTextOption(options, "expected-program-name"),
      deployedProgramName: requireTextOption(options, "deployed-program-name"),
      apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
      apiBase: options["api-base"],
    });
    console.log(
      `Liftosaur deployment prepared: ${result.manifest.target.name} → `
      + `${result.manifest.deployment.name}; ${result.validation.days} days validated`
    );
  } catch (error) {
    if (error instanceof LiftosaurPreparationError) {
      throw new CliError(error.message, error.exitCode);
    }
    throw error;
  }
}

async function runPrepareGit(argv) {
  const options = parseOptions(argv, [
    "repository",
    "config",
    "deployment",
    "base-ref",
    "candidate-ref",
    "program",
    "program-id",
    "deployed-program-name",
    "output",
    "api-base",
  ]);
  const outputDirectory = requireOption(options, "output");
  try {
    const configured = options.config || options.deployment;
    let preparation;
    if (configured) {
      if (!options.config || !options.deployment) {
        throw new CliError("--config and --deployment must be provided together");
      }
      if (options.program || options["program-id"] || options["deployed-program-name"]) {
        throw new CliError("Configured prepare-git must not override program deployment settings");
      }
      preparation = await configuredGitPreparation({
        configFile: path.resolve(options.config),
        deploymentId: options.deployment,
        candidateRef: requireTextOption(options, "candidate-ref"),
        baseRef: options["base-ref"] ?? null,
        repository: options.repository ? path.resolve(options.repository) : null,
      });
    } else {
      preparation = {
        repository: path.resolve(options.repository ?? "."),
        baseRef: requireTextOption(options, "base-ref"),
        candidateRef: requireTextOption(options, "candidate-ref"),
        programPath: requireTextOption(options, "program"),
        programId: requireTextOption(options, "program-id"),
        deployedProgramName: requireTextOption(options, "deployed-program-name"),
        expectedBase: null,
      };
    }
    const result = await prepareGitDeployment({
      repository: preparation.repository,
      baseRef: preparation.baseRef,
      candidateRef: preparation.candidateRef,
      programPath: preparation.programPath,
      outputDirectory,
      programId: preparation.programId,
      deployedProgramName: preparation.deployedProgramName,
      expectedBase: preparation.expectedBase,
      apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
      apiBase: options["api-base"],
    });
    console.log(
      `Git deployment prepared: ${result.manifest.source.candidate.commitSha} → `
      + `${result.manifest.target.id}; ${result.validation.days} days validated`
    );
  } catch (error) {
    if (error instanceof LiftosaurPreparationError) {
      throw new CliError(error.message, error.exitCode);
    }
    throw error;
  }
}

async function runRecordDeployment(argv) {
  const options = parseOptions(argv, ["config", "deployment", "report"]);
  const result = await recordDeploymentState({
    configFile: requireOption(options, "config"),
    deploymentId: requireTextOption(options, "deployment"),
    reportFile: requireOption(options, "report"),
  });
  console.log(`Deployment state recorded: ${result.file}`);
}

async function runDeploy(argv) {
  const options = parseOptions(argv, [
    "bundle",
    "confirm-program-id",
    "confirm-program-name",
    "output",
    "max-age-hours",
    "api-base",
  ]);
  const outputDirectory = requireOption(options, "output");
  const report = await deployPreparedBundle({
    bundleDirectory: requireOption(options, "bundle"),
    outputDirectory,
    apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
    expectedProgramId: requireTextOption(options, "confirm-program-id"),
    expectedDeployedName: requireTextOption(options, "confirm-program-name"),
    apiBase: options["api-base"],
    maxAgeHours: Number(options["max-age-hours"] ?? "24"),
  });
  console.log(`Liftosaur deployment verified: ${report.target.name} (${report.target.id})`);
}

async function runCheck(argv) {
  const options = parseOptions(argv, ["config", "report"]);
  const configFile = path.resolve(options.config ?? "liftosaur-ci.json");
  const reportFile = options.report ? path.resolve(options.report) : null;
  if (reportFile === configFile) throw new CliError("Check report must not replace the config file");
  if (reportFile) await requireNewFile(reportFile, "Check report");
  const report = await checkRepository(configFile);
  if (reportFile) {
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  if (report.status !== "passed") {
    throw new CliError(`Liftosaur repository check failed: ${report.summary.failed} program(s)`);
  }
  console.log(
    `Liftosaur repository check passed: ${report.summary.programs} programs, `
    + `${report.summary.scenarios} reviewed scenarios`
  );
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
  const commands = new Set([
    "merge",
    "validate",
    "snapshot",
    "prepare-deployment",
    "prepare",
    "prepare-git",
    "deploy",
    "record-deployment",
    "check",
  ]);
  if (!commands.has(command)) throw new CliError(`Unknown command: ${command}`);
  if (commandArgs.length === 1 && (commandArgs[0] === "--help" || commandArgs[0] === "-h")) {
    console.log(usage());
    return;
  }
  if (command === "merge") await runMerge(commandArgs);
  else if (command === "validate") await runValidate(commandArgs);
  else if (command === "snapshot") await runSnapshot(commandArgs);
  else if (command === "prepare-deployment") await runPrepareDeployment(commandArgs);
  else if (command === "prepare") await runPrepare(commandArgs);
  else if (command === "prepare-git") await runPrepareGit(commandArgs);
  else if (command === "deploy") await runDeploy(commandArgs);
  else if (command === "record-deployment") await runRecordDeployment(commandArgs);
  else await runCheck(commandArgs);
}
