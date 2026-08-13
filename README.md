# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

`liftosaur-ci` keeps program logic in Git while preserving the exercise state
accumulated in Liftosaur. The normal workflow is deliberately small:

1. Change and commit a Liftosaur program in Git.
2. Run `liftosaur-ci update`.
3. The tool merges live progression into the reviewed program, validates it,
   and writes it back to the same Liftosaur program.

## Setup

Requirements: Node.js 24, npm, and Git.

```sh
node scripts/setup-runtime.mjs
```

`liftosaur-ci` itself has no npm dependencies. Runtime setup fetches the exact
Liftosaur revision recorded in `runtime/liftosaur.version` into
`.private/liftosaur-runtime` and installs that runtime's dependencies. Set
`LIFTOSAUR_RUNTIME` to use another dedicated checkout.

Create `liftosaur-ci.json` with the Git program path and Liftosaur target:

```json
{
  "deployments": {
    "program": {
      "program": "programs/example.liftoscript",
      "programId": "current"
    }
  }
}
```

`programId` may be an exact Liftosaur ID or `current`. The live program name is
preserved automatically.

## Update a program

The first update identifies the Git revision corresponding to the program
version already in Liftosaur:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update \
  --base-ref first-deployed-ref
```

After a successful update, commit the generated
`.liftosaur-ci/deployments/program.json` state file. Later updates need no base:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update
```

With one configured deployment, the command infers the deployment and uses
`HEAD` as the reviewed candidate. Repositories with multiple deployments add
`--deployment <id>`.

The [deployment contract](docs/deployment.md) explains state preservation,
target locking, merge ownership, failure behavior, and recovery. For protected
automation, see [GitHub Actions integration](docs/github-actions.md).

## Validate a repository

Validate every configured program and compare reviewed scenario snapshots:

```sh
node bin/liftosaur-ci.mjs check --config liftosaur-ci.json
```

See the [repository check contract](docs/check.md) and
[native validation contract](docs/native-validation.md).

## Documentation

Use the [documentation index](docs/README.md) to find the authoritative guide
for each task. The [CLI guide](docs/cli.md) describes everyday, composable, and
advanced command layers.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
