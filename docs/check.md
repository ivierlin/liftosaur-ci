# Repository check

`liftosaur-ci check` is the minimal generic CI entry point. It reads a versioned
JSON config, validates every referenced program, and compares every configured
reviewed snapshot. It never updates a program, scenario, or snapshot.

## Configuration

Paths and patterns are relative to the config file and may not escape its
directory. `.git`, `.private`, and `node_modules` are excluded from glob
discovery.

```json
{
  "formatVersion": 3,
  "implementation": "liftosaur-check-config-v3",
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
      "programId": "exact-liftosaur-program-id",
      "deployedProgramName": "Example"
    }
  }
}
```

`programs` is optional. Glob matches, scenario program references, and deployment
program references are combined into one validation set, so an explicitly
referenced program does not need to be declared twice. The configuration must
reference at least one program in total.

Version 3 adds named deployments with the Liftosaur target directly in
`programId`. The value may be an exact ID or `current`; `current` is resolved to
the exact returned ID during preparation and that resolved ID is used for the
rest of the deployment transaction. `deployedProgramName` is optional. When it
is omitted, deployment preserves the live program name.

Version 1 check-only configs remain supported. Version 2 deployment configs used
environment-variable program IDs and are intentionally not accepted by the
simplified schema.

Scenario files are strict: unknown scenario, step, entry, and set fields are
rejected instead of being silently ignored.

## CI usage

```sh
node bin/liftosaur-ci.mjs check \
  --config liftosaur-ci.json \
  --report liftosaur-ci-report.json
```

The command exits nonzero when validation fails or a snapshot differs. A report
path is optional and must not already exist. Snapshot mismatches include the
first differing JSON path in the report.
