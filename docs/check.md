# Repository check

`liftosaur-ci check` is the minimal generic CI entry point. It validates every discovered or configured program and compares configured reviewed snapshots. It never updates a program, scenario, or snapshot.

## Configuration

If `liftosaur-ci.json` is absent and the repository root contains exactly one regular file ending in `.liftoscript`, that file is discovered as deployment `program`. Discovery is intentionally root-only and based on the filename; validation handles the file contents separately. Zero or multiple root-level matches require explicit configuration.

The canonical configuration remains the multi-deployment form:

```json
{
  "deployments": {
    "example": {
      "program": "programs/example.liftoscript"
    }
  }
}
```

Configuration paths and patterns are relative to the config file and may not escape its directory. `programId` is optional. When present, it must be an exact non-empty Liftosaur program ID; durable config rejects the literal `current`. Omitting it enables the one-time bootstrap path described in the [deployment contract](deployment.md): the first verified deployment resolves Liftosaur's current program and opens a PR pinning the resulting exact ID.

Multi-program repositories can set exact IDs up front:

```json
{
  "deployments": {
    "strength": {
      "program": "programs/strength.liftoscript",
      "programId": "exact-strength-id"
    },
    "hypertrophy": {
      "program": "programs/hypertrophy.liftoscript",
      "programId": "exact-hypertrophy-id"
    }
  }
}
```

The [deployment contract](deployment.md) owns target resolution, bootstrap, deployed-position tracking, merge behavior, and recovery. Optional `programs` globs, scenario program references, and deployment program references are combined into one validation set, so a program does not need to be declared twice. An explicit configuration must reference at least one program in total.

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

`.git`, `.private`, and `node_modules` are excluded from configured glob discovery. Scenario files are strict: unknown scenario, step, entry, and set fields are rejected instead of being silently ignored. A scenario with `day` and `entries` describes one exposure; a scenario with `steps` describes an ordered sequence of exposures.

## CI usage

```sh
node bin/liftosaur-ci.mjs check
```

Pass `--config <path>` for a non-default config location. The command exits nonzero when validation fails or a snapshot differs. A report path is optional and must not already exist. Snapshot mismatches include the first differing JSON path in the report.
