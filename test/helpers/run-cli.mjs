import { CliError, runLiftosaurCi } from "../../src/cli.mjs";

export async function runCli(args, environment = process.env) {
  let stdout = "";
  let stderr = "";
  const originalLog = console.log;
  const originalError = console.error;
  const overridden = new Map();
  for (const name of ["LIFTOSAUR_API_KEY", "LIFTOSAUR_PROGRAM_ID", "LIFTOSAUR_EXAMPLE_PROGRAM_ID", "LIFTOSAUR_RUNTIME"]) {
    overridden.set(name, process.env[name]);
    if (environment[name] === undefined) delete process.env[name];
    else process.env[name] = environment[name];
  }
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
