# Repository check

`liftosaur-ci check` is the minimal generic CI entry point. It reads a JSON
config, validates every referenced program, and compares configured reviewed
snapshots. It never updates a program, scenario, or snapshot.

## Configuration

A deployable repository can start with only the program path and Liftosaur
target:

```json
{
  "deployments": {
    "example": {
      "program": "programs/example.liftoscript",
      "programId": "current"
    }
  }
}
```

`programId` may be an exact Liftosaur ID or `current`. `current` is resolved to
the exact returned ID during preparation and that exact ID is used for the rest
of the deployment transaction. Program names are preserved automatically.

Paths and patterns are relative to the config file and may not escape its
directory. Optional `programs` globs, scenario program references, and deployment
program references are combined into one validation set, so a program does not
need to be declared twice. The configuration must reference at least one program
in total.

Reviewed scenarios are optional:

```json
{
  "programs": ["programs/*.liftoscript"],
  "scenarios": [
    {
      "program": "programs/example.liftoscript",
      "scenario": "test/example.json",
      "snapshot": "test/example.expected.json"
    }
  ]
}
```

`.git`, `.private`, and `node_modules` are excluded from glob discovery. Scenario
files are strict: unknown scenario, step, entry, and set fields are rejected
instead of being silently ignored. A scenario with `day` and `entries` describes
one exposure; a scenario with `steps` describes an ordered sequence of exposures.

## CI usage

```sh
node bin/liftosaur-ci.mjs check \
  --config liftosaur-ci.json \
  --report liftosaur-ci-report.json
```

The command exits nonzero when validation fails or a snapshot differs. A report
path is optional and must not already exist. Snapshot mismatches include the
first differing JSON path in the report.

Generated snapshots retain the producing `liftosaur-ci` name and version for
provenance. Comparison ignores only that producer version, so upgrading the tool
does not invalidate every reviewed behavior snapshot. The producer name and all
program, input, progression, and output fields remain exact comparisons.
