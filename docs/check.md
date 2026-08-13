# Check a repository

`liftosaur-ci check` validates the programs a repository owns and compares any
reviewed scenario snapshots. It never updates Liftosaur, a program file, a
scenario, or a snapshot.

## The zero-config case

You do not need a config file when the repository root contains exactly one
regular file whose name ends in `.liftoscript`. The command discovers that file
as deployment `program`.

Discovery is deliberately strict and root-only. No match, more than one match,
or a program in a subdirectory requires explicit configuration.

## When configuration is needed

Add `liftosaur-ci.json` when you have a custom layout, multiple programs,
reviewed scenarios, or an exact Liftosaur target to record. Paths and patterns
are relative to the config file and cannot escape its directory.

A single configured deployment looks like this:

```json
{
  "deployments": {
    "example": {
      "program": "programs/example.liftoscript"
    }
  }
}
```

`programId` is optional. When present, it must be an exact, non-empty Liftosaur
program ID; durable config does not accept the shortcut `current`. GitHub
automation can resolve and save an omitted ID during first migration. The
[deployment contract](deployment.md#first-time-initialization) owns those rules.

A repository with several deployments can pin each target explicitly:

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

An explicit config must reference at least one program. Optional `programs`
patterns, scenario program references, and deployment program references are
combined into one validation set, so the same file need not be declared twice.
Configured glob discovery excludes `.git`, `.private`, and `node_modules`.

## Add reviewed scenarios

Scenarios describe expected program behavior and compare it with an immutable
JSON snapshot:

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

Scenario input is strict: unknown scenario, step, entry, and set fields fail
instead of being ignored. A scenario with `day` and `entries` describes one
exposure; one with `steps` describes an ordered sequence. See the
[native validation contract](native-validation.md#reviewed-regression-scenarios)
for the complete scenario format.

## What gets validated

The command validates every discovered or configured source with the pinned
Liftosaur runtime. It also runs each configured scenario and compares the result
with its reviewed snapshot. A missing program, invalid config or source,
scenario error, or snapshot difference makes the command fail.

Target resolution, first-time setup, deployed-position tracking, merging, and
recovery belong to the [deployment contract](deployment.md); `check` does not
perform those operations.

## Run the command

```sh
node bin/liftosaur-ci.mjs check
```

Use `--config <path>` when the config is not `liftosaur-ci.json`. The command
exits with a nonzero status on failure. An optional report path must not already
exist; when a snapshot differs, the report includes the first differing JSON
path.
