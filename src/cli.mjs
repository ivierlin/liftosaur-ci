import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { checkRepository } from "./check.mjs";
import { configuredDeployment } from "./config.mjs";
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
import { rollbackRecoveryDirectory } from "./rollback.mjs";
import { updateConfiguredGitDeployment } from "./update.mjs";
import {
  LIFTOSAUR_VALIDATOR,
  LiftosaurValidationError,
  snapshotLiftosaurScenario,
  validateLiftosaurSource,
} from "./validate.mjs";

export { LIFTOSAUR_CI_CLI } from "./report.mjs";

const DEFAULT_CONFIG = "liftosaur-ci.json";

export class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage:

Everyday update:
  liftosaur-ci update \\
    [--base-ref <bootstrap-ref>] \\
    [--config <liftosaur-ci.json>] \\
    [--deployment <stable-id>] \\
    [--api-base <url>]

Composable deployment:
  liftosaur-ci prepare-git \\
    [--repository <git-worktree>] \\
    [--config <liftosaur-ci.json>] \\
    [--deployment <stable-id>] \\
    [--base-ref <last-deployed-ref>] \\
    [--candidate-ref <reviewed-ref>] \\
    [--program <repository-relative-path> --program-id <liftosaur-program-id|current>] \\
    [--program-name <reviewed-liftosaur-program-name>] \\
    --output <deployment-bundle-directory> \\
    [--api-base <url>]

  liftosaur-ci deploy \\
    --bundle <deployment-bundle-directory> \\
    [--config <liftosaur-ci.json>] \\
    [--deployment <stable-id>] \\
    [--confirm-program-id <resolved-liftosaur-program-id>] \\
    --output <private-deployment-record-directory> \\
    [--max-age-hours <hours>] \\
    [--api-base <url>]

  liftosaur-ci record-deployment \\
    [--config <liftosaur-ci.json>] \\
    [--deployment <stable-id>] \\
    --report <private-deployment-report.json>

Recovery:
  liftosaur-ci rollback \\
    --recovery <retained-recovery-directory> \\
    [--api-base <url>]

Advanced/offline building blocks:
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

  liftosaur-ci prepare \\
    --base <previously-deployed.liftoscript> \\
    --candidate <new-source.liftoscript> \\
    --program-id <liftosaur-program-id|current> \\
    [--program-name <reviewed-liftosaur-program-name>] \\
    --output <deployment-bundle-directory> \\
    [--api-base <url>]

  liftosaur-ci prepare-deployment \\
    --active <current-liftosaur.liftoscript> \\
    --program <validated-program.liftoscript> \\
    --validation-report <validation-report.json> \\
    [--merge-report <merge-report.json>] \\
    --program-id <resolved-liftosaur-program-id> \\
    --output <deployment-bundle-directory>

  liftosaur-ci check \\
    [--config <liftosaur-ci.json>] \\
    [--report <check-report.json>]

Configured commands default to ${DEFAULT_CONFIG}. prepare-git and deploy use that
configuration unless explicit --program/--program-id or --confirm-program-id inputs
select their lower-level unconfigured mode. Single deployments are inferred.`;
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

function defaultConfig(options) {
  return path.resolve(options.config ?? DEFAULT_CONFIG);
}

function explicitPair(options, first, second) {
  const hasFirst = Boolean(options[first]);
  const hasSecond = Boolean(options[second]);
  if (hasFirst !== hasSecond) {
    throw new CliError(`--${first} and --${second} must be used together`);
  }
  return hasFirst;
}

function friendlyUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/LIFTOSAUR_API_KEY|API key/i.test(message)) {
    return "Liftosaur access is not configured. Set LIFTOSAUR_API_KEY and try again.";
  }
  if (/base-ref|deployment state|previously deployed/i.test(message)) {
    return `${message}\nIf this is the first tracked update, rerun with --base-ref <deployed-ref>.`;
  }
  if (/merge conflict|conflict/i.test(message)) {
    return "The live program and the new Git version changed the same state incompatibly. No deployment was performed. Review the conflicting changes or use an explicit migration workflow.";
  }
  if (/Git-managed|program logic|live edit/i.test(message)) {
    return "Program logic was edited directly in Liftosaur. Commit that logic change to Git or discard the live edit, then run update again.";
  }
  return message;
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

async function runUpdate(argv) {
  const options = parseOptions(argv, ["base-ref", "config", "deployment", "api-base"]);
  try {
    const result = await updateConfiguredGitDeployment({
      configFile: defaultConfig(options),
      deploymentId: options.deployment ?? null,
      baseRef: options["base-ref"] ?? null,
      apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
      apiBase: options["api-base"],
    });
    if (!result.deploymentRequired) {
      console.log(`Liftosaur update not required: configured program blob already matches ${result.deploymentRef}`);
    } else {
      console.log(`Liftosaur updated: ${result.target.name}`);
      if (result.targetBindingRequired) {
        console.log(`Pin programId ${result.targetId} in liftosaur-ci.json before the next deployment`);
      }
    }
  } catch (error) {
    const message = friendlyUpdateError(error);
    const recovery = error?.recoveryDirectory
      ? `\nRecovery files retained at: ${error.recoveryDirectory}`
      : "";
    const rollback = error?.recoveryDirectory && /ambiguous/i.test(error?.message ?? "")
      ? `\nTo restore the previous source:\n  liftosaur-ci rollback --recovery "${error.recoveryDirectory}"`
      : "";
    if (error instanceof LiftosaurPreparationError) {
      throw new CliError(`${message}${recovery}${rollback}`, error.exitCode);
    }
    throw new CliError(`${message}${recovery}${rollback}`);
  }
}

async function runRollback(argv) {
  const options = parseOptions(argv, ["recovery", "api-base"]);
  const report = await rollbackRecoveryDirectory({
    recoveryDirectory: requireOption(options, "recovery"),
    apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
    apiBase: options["api-base"],
  });
  const verb = report.status === "already-restored" ? "already restored" : "restored";
  console.log(`Liftosaur rollback verified: ${report.target.name} (${report.target.id}) ${verb}`);
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
    "output",
  ]);
  const programId = requireTextOption(options, "program-id");
  if (programId === "current") {
    throw new CliError("prepare-deployment is offline and requires a resolved program ID, not current");
  }
  const outputDirectory = requireOption(options, "output");
  await prepareDeploymentBundle({
    activeFile: requireOption(options, "active"),
    deployFile: requireOption(options, "program"),
    validationReportFile: requireOption(options, "validation-report"),
    mergeReportFile: options["merge-report"] ? path.resolve(options["merge-report"]) : null,
    outputDirectory,
    target: { id: programId },
  });
  console.log(`Liftosaur deployment bundle prepared: ${outputDirectory}`);
}

async function runPrepare(argv) {
  const options = parseOptions(argv, ["base", "candidate", "program-id", "program-name", "output", "api-base"]);
  const outputDirectory = requireOption(options, "output");
  try {
    const result = await prepareLiftosaurDeployment({
      baseFile: requireOption(options, "base"),
      candidateFile: requireOption(options, "candidate"),
      outputDirectory,
      programId: requireTextOption(options, "program-id"),
      apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
      apiBase: options["api-base"],
      programName: options["program-name"] ?? null,
    });
    console.log(
      `Liftosaur deployment prepared for ${result.manifest.target.id}; `
      + `${result.validation.days} days validated`
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
    "program-name",
    "output",
    "api-base",
  ]);
  const outputDirectory = requireOption(options, "output");
  try {
    const explicitProgram = explicitPair(options, "program", "program-id");
    if (explicitProgram && (options.config || options.deployment)) {
      throw new CliError("Explicit --program/--program-id mode cannot be combined with --config or --deployment");
    }
    const preparation = explicitProgram
      ? {
          repository: path.resolve(options.repository ?? "."),
          baseRef: requireTextOption(options, "base-ref"),
          candidateRef: options["candidate-ref"] ?? "HEAD",
          programPath: options.program,
          programId: options["program-id"],
          expectedBase: null,
        }
      : await configuredGitPreparation({
          configFile: defaultConfig(options),
          deploymentId: options.deployment ?? null,
          candidateRef: options["candidate-ref"] ?? "HEAD",
          baseRef: options["base-ref"] ?? null,
          repository: options.repository ? path.resolve(options.repository) : null,
        });
    if (!explicitProgram && !preparation.deploymentRequired) {
      console.log(`Git deployment not required: configured program blob already matches ${preparation.deploymentRef}`);
      return;
    }
    const result = await prepareGitDeployment({
      repository: preparation.repository,
      baseRef: preparation.baseRef,
      candidateRef: preparation.candidateRef,
      programPath: preparation.programPath,
      outputDirectory,
      programId: preparation.programId,
      expectedBase: preparation.expectedBase,
      apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
      apiBase: options["api-base"],
      programName: options["program-name"] ?? null,
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
  const options = parseOptions(argv, ["repository", "config", "deployment", "report"]);
  const result = await recordDeploymentState({
    configFile: defaultConfig(options),
    deploymentId: options.deployment ?? null,
    reportFile: requireOption(options, "report"),
    repository: options.repository ? path.resolve(options.repository) : null,
  });
  console.log(`Deployment ref recorded: ${result.ref} → ${result.commitSha}`);
}

async function runDeploy(argv) {
  const options = parseOptions(argv, [
    "bundle",
    "config",
    "deployment",
    "confirm-program-id",
    "output",
    "max-age-hours",
    "api-base",
  ]);
  const outputDirectory = requireOption(options, "output");
  const explicitProgramId = Boolean(options["confirm-program-id"]);
  if (explicitProgramId && (options.config || options.deployment)) {
    throw new CliError("Explicit --confirm-program-id mode cannot be combined with --config or --deployment");
  }
  let expectedProgramId;
  if (explicitProgramId) {
    expectedProgramId = options["confirm-program-id"];
    if (expectedProgramId === "current") {
      throw new CliError("Deployment confirmation requires the exact resolved program ID, not current");
    }
  } else {
    const resolved = await configuredDeployment(defaultConfig(options), options.deployment ?? null);
    if (resolved.deployment.programId) expectedProgramId = resolved.deployment.programId;
    else {
      const manifest = JSON.parse(await readFile(path.join(requireOption(options, "bundle"), "deployment-manifest.json"), "utf8"));
      expectedProgramId = manifest.target?.id;
    }
  }
  const report = await deployPreparedBundle({
    bundleDirectory: requireOption(options, "bundle"),
    outputDirectory,
    apiKey: process.env.LIFTOSAUR_API_KEY?.trim(),
    expectedProgramId,
    apiBase: options["api-base"],
    maxAgeHours: Number(options["max-age-hours"] ?? "24"),
  });
  console.log(`Liftosaur deployment verified: ${report.target.name ?? "program"} (${report.target.id})`);
}

async function runCheck(argv) {
  const options = parseOptions(argv, ["config", "report"]);
  const configFile = defaultConfig(options);
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
    "update",
    "rollback",
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
  if (command === "update") await runUpdate(commandArgs);
  else if (command === "rollback") await runRollback(commandArgs);
  else if (command === "merge") await runMerge(commandArgs);
  else if (command === "validate") await runValidate(commandArgs);
  else if (command === "snapshot") await runSnapshot(commandArgs);
  else if (command === "prepare-deployment") await runPrepareDeployment(commandArgs);
  else if (command === "prepare") await runPrepare(commandArgs);
  else if (command === "prepare-git") await runPrepareGit(commandArgs);
  else if (command === "deploy") await runDeploy(commandArgs);
  else if (command === "record-deployment") await runRecordDeployment(commandArgs);
  else await runCheck(commandArgs);
}
