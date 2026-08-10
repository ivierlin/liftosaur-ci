# Repository check

`liftosaur-ci check` is the minimal generic CI entry point. It reads a versioned
JSON config, discovers programs with POSIX-style glob patterns, validates every
program, and compares every configured reviewed snapshot. It never updates a
program, scenario, or snapshot.

## Configuration

Paths and patterns are relative to the config file and may not escape its
directory. `.git`, `.private`, and `node_modules` are excluded from discovery.

```json
{
  "formatVersion": 2,
  "implementation": "liftosaur-check-config-v2",
  "programs": ["programs/*.liftoscript"],
  "scenarios": [
    {
      "program": "programs/example.liftoscript",
      "scenario": "test/example.json",
      "snapshot": "test/example.expected.json"
    }
  ],
  "deployments": {
    "example": {
      "program": "programs/example.liftoscript",
      "programIdEnv": "LIFTOSAUR_EXAMPLE_PROGRAM_ID",
      "deployedProgramName": "Example"
    }
  }
}
```

`programs` must contain at least one pattern and discovery must find at least
one file. `scenarios` is optional. Each scenario program must be included by the
program patterns.

Version 2 adds optional named `deployments`. Each stable deployment ID connects
a discovered program to a fixed resulting name and the name of an environment
variable containing its exact Liftosaur program ID. Program IDs and credentials
therefore stay out of the repository. Version 1 check-only configs remain
supported.

## CI usage

```sh
node bin/liftosaur-ci.mjs check \
  --config liftosaur-ci.json \
  --report liftosaur-ci-report.json
```

The command exits nonzero when validation fails or a snapshot differs. A report
path is optional and must not already exist. Snapshot mismatches include the
first differing JSON path in the report.
