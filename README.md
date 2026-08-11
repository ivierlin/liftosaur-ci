# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

## Status

This repository is an early extraction from a proven migration experiment. It
contains offline three-way merge, native validation, reviewed regression,
repository check, prepared deployment commands, and reusable GitHub workflows.
Credential storage and deployment approval remain the responsibility of the
calling repository.

## Setup

Requirements: Node.js 24, npm, and Git.

```sh
node scripts/setup-runtime.mjs
```

`liftosaur-ci` itself has no npm dependencies. Runtime setup fetches the exact
Liftosaur revision recorded in `runtime/liftosaur.version` into
`.private/liftosaur-runtime` and installs that runtime's dependencies. Set
`LIFTOSAUR_RUNTIME` to use another dedicated checkout. CI may keep this checkout
in a persistent cache and reuse it while the pinned revision and Node ABI remain
unchanged.

## Offline merge

```sh
node bin/liftosaur-ci.mjs merge \
  --base previously-deployed.liftoscript \
  --active current-liftosaur.liftoscript \
  --candidate new-git-source.liftoscript \
  --output merged.liftoscript \
  --report merge-report.json
```

The inputs are read without modification. Existing output files are never
overwritten. A successful merge exits with status 0. An unresolved merge exits
with status 2, writes no program, and may write the requested conflict report.
Other failures exit with status 1.

The merge frontend preserves repeated exercise statements by occurrence, so the
same exercise can appear more than once on a day without creating an artificial
identity collision.

## Validation

```sh
node bin/liftosaur-ci.mjs validate \
  --program program.liftoscript \
  --report validation-report.json
```

Validation uses the pinned Liftosaur runtime to evaluate the program, construct
every workout day, compare stable prescriptions across serialization, complete
nominal work sets, execute update and finish scripts, and reload each progressed
program. Input files and existing reports are never modified. See the
[native validation policy](docs/native-validation.md) for the exact inputs and
scope.

## Regression snapshots

```sh
node bin/liftosaur-ci.mjs snapshot \
  --program program.liftoscript \
  --scenario reviewed-scenario.json \
  --output snapshot.json
```

Format 1 scenarios describe one exposure. Format 2 scenarios contain two or
more named, ordered steps and feed each step the exact serialized result of the
previous one. Repository checks reject unknown scenario fields rather than
silently ignoring likely typos. Snapshot changes require review; they do not
establish coaching correctness.

## Repository check

```sh
node bin/liftosaur-ci.mjs check --config liftosaur-ci.json
```

`check` validates the union of programs discovered by optional globs and programs
referenced directly by scenarios or deployments. Explicit references therefore
do not need to be duplicated in `programs`. See the
[repository check contract](docs/check.md) for the versioned configuration.

## Prepared deployment and recovery

Configured deployments map a stable deployment ID to a program path and a
Liftosaur `programId` directly. `programId` may be an exact ID or `current`.
When `current` is used, preparation resolves it once and stores the exact
returned ID in the deployment bundle; every later verification and write uses
that exact ID.

`prepare-git` resolves reviewed Git refs to immutable commits and blobs, fetches
the target from Liftosaur, merges live state with the Git candidate, validates
the result, and creates a hash-bound private bundle. Because source is read from
Git objects, unrelated dirty worktree files cannot affect preparation.

A verified deployment can be recorded as a tiny non-sensitive state file
containing only the deployed Git commit and program blob hashes, allowing the
next preparation to select and verify its base automatically.

`prepare` provides the same merge and validation path for caller-supplied files.
`prepare-deployment` remains available for callers that already produced the
active source, merged program, and evidence; because it is offline, it requires
an already resolved exact program ID.

`deploy` verifies the exact target ID and prepared source hash, writes once, and
verifies the read-back. Program names are metadata rather than identity: an
optional configured deployment name intentionally renames the program; otherwise
the live name is preserved.

If read-back is neither the old prepared source nor the intended new source, the
command stops and preserves the rollback source for explicit recovery. It never
automatically overwrites an unknown third state. See the
[deployment contract](docs/deployment.md) before using the command against a live
program.

See [GitHub Actions integration](docs/github-actions.md) for reusable check and
approval-gated deployment workflows. Runner labels and tool revisions are
explicit inputs; no hosted runner image is assumed.

## Tests

For normal development:

```sh
npm run test:fast
```

This runs the unit/integration suite plus a deterministic sample of three pinned
Liftosaur built-in programs. Branch pushes use this fast tier.

The full deterministic suite is:

```sh
npm test
```

It checks every program in the pinned Liftosaur built-in catalog and is used on
pull requests, `main`, and manual CI runs. The digest-pinned public RP
Hypertrophy v4.1 network corpus is available separately with:

```sh
npm run test:external
```

Keeping the live external fetch outside `npm test` prevents network availability
from deciding the normal CI gate. Deployment tests use a local fake API and
never change Liftosaur.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
