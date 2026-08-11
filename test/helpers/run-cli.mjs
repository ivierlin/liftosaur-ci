import { CliError, runLiftosaurCi } from "../../src/cli.mjs";
import { extractConflictOutput } from "../../src/entry-options.mjs";

export async function runCli(rawArgs, environment = process.env) {
  let stdout = "";
  let stderr = "";
  const originalLog = console.log;
  const originalError = console.error;
  const overridden = new Map();
  let args;
  let conflictOutput;
  try {
    ({ args, conflictOutput } = extractConflictOutput(rawArgs));
  } catch (error) {
    return { code: 1, status: 1, stdout, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  for (const name of ["LIFTOSAUR_API_KEY", "LIFTOSAUR_PROGRAM_ID", "LIFTOSAUR_EXAMPLE_PROGRAM_ID", "LIFTOSAUR_RUNTIME", "LIFTOSAUR_CI_CONFLICT_OUTPUT"]) {
    overridden.set(name, process.env[name]);
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
  if (conflictOutput) process.env.LIFTOSAUR_CI_CONFLICT_OUTPUT = conflictOutput;
  console.log = (...values) => { stdout += `${values.join(" ")}\n`; };
  console.error = (...values) => { stderr += `${values.join(" ")}\n`; };
  let code = 0;
  try {
    await runLiftosaurCi(args);
  } catch (error) {
    code = error instanceof CliError ? error.exitCode : 1;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    for (const [name, value] of overridden) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  return { code, status: code, stdout, stderr };
}
