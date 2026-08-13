# liftosaur-ci

Unofficial Git-based validation and safe deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

`liftosaur-ci` keeps program logic in Git while preserving the progression
accumulated in Liftosaur when that logic changes. The recommended workflow is
simple: pull requests check the program, and a valid change to the deployable
`.liftoscript` on `main` is safely deployed automatically. Unrelated changes are
a no-op.

## Get started

A minimal repository needs a deployable program and `liftosaur-ci.json`:

```json
{
  "deployments": {
    "program": {
      "program": "programs/example.liftoscript"
    }
  }
}
```

Then use the recommended [GitHub Actions workflow](docs/github-actions.md). The
first deployment needs the Git revision corresponding to the program already in
Liftosaur. If `programId` is omitted, that first deployment uses Liftosaur's
current program and opens a one-time PR pinning its exact ID. Later valid program
changes deploy without manual steps.

Repositories with several maintained programs can configure an exact `programId`
for each deployment from the start. Projects with generators, custom tests, or a
more specialized release process can use the same CLI primitives directly.

## Use the CLI directly

Requirements: Node.js 24, npm, and Git. Set up the pinned Liftosaur validation
runtime with:

```sh
node scripts/setup-runtime.mjs
```

The first state-preserving update identifies the Git revision corresponding to
the program version already live in Liftosaur. After that, the deployment
position is recorded in Git and later updates need no base. See the
[CLI guide](docs/cli.md) for the commands and options.

The [deployment contract](docs/deployment.md) explains state preservation,
target locking, failure behavior, and recovery.

## Validate a repository

Validate every configured program and compare reviewed scenario snapshots:

```sh
node bin/liftosaur-ci.mjs check --config liftosaur-ci.json
```

See the [repository check contract](docs/check.md) and
[native validation contract](docs/native-validation.md).

## Documentation

Use the [documentation index](docs/README.md) to find the authoritative guide
for each task.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
