# liftosaur-ci

Unofficial Git-based validation and safe deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

`liftosaur-ci` keeps program logic in Git while preserving the progression
accumulated in Liftosaur when that logic changes. The recommended workflow is
simple: pull requests check the program, and a valid change to the deployable
`.liftoscript` on `main` is safely deployed automatically. Unrelated changes are
a no-op.

## Get started

If you keep the program on GitHub and use the provided Actions workflows, you do
not need to install `liftosaur-ci`, Node.js, or any other local tooling. GitHub
runs it for you.

For the simplest repository, put exactly one `.liftoscript` file in the repository
root. No config file is needed initially:

```text
my-program/
├── program.liftoscript
└── .github/
    └── workflows/
        └── liftosaur.yml
```

Use the recommended [GitHub Actions workflow](docs/github-actions.md) and store
your Liftosaur API key as the documented GitHub secret. The first deployment
needs the Git revision corresponding to the program already in Liftosaur. It uses
Liftosaur's current program as the initial target and opens a one-time PR creating
`liftosaur-ci.json` with the discovered program path and exact target ID. Merge
that PR once; later valid program changes deploy without manual steps.

Discovery is intentionally strict: it considers only regular root-level files
ending in `.liftoscript`. If there are none, more than one, or your repository has
a custom layout, add `liftosaur-ci.json` explicitly. The canonical config also
supports several named deployments with exact target IDs.

Projects with generators, custom tests, or a more specialized release process can
use the same CLI primitives directly.

## Use the CLI directly

For local or custom CLI use, requirements are Node.js 24, npm, and Git. Set up the
pinned Liftosaur validation runtime with:

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

Validate every discovered or configured program and compare reviewed scenario
snapshots:

```sh
node bin/liftosaur-ci.mjs check
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
