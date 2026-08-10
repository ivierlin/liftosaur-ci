# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

## Status

This repository is an early extraction from a proven migration experiment. It
contains offline three-way merge, native validation, reviewed regression,
repository check, and prepared deployment commands. GitHub orchestration and
credential storage remain the responsibility of the calling repository.

## Setup

Requirements: Node.js 24, npm, and Git.

```sh
npm ci
npm run setup:runtime
```

Runtime setup fetches the exact Liftosaur revision recorded in
`runtime/liftosaur.version` into `.private/liftosaur-runtime` and installs its
dependencies. Set `LIFTOSAUR_RUNTIME` to use another dedicated checkout. CI
may keep this checkout in a persistent cache and reuse it while the pinned
revision and Node ABI remain unchanged.

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

The JSON report binds the exact input and output bytes with SHA-256 values and
includes the versioned parser frontend and merge-core evidence.

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
previous one. Inputs explicitly identify the day, every exercise, and every
completed work set. The immutable output records persistent progression state
plus the next exposure and next scheduled workout prescriptions after each step.
Snapshot changes require review; they do not establish coaching correctness.

## Repository check

```sh
node bin/liftosaur-ci.mjs check --config liftosaur-ci.json
```

`check` discovers configured programs, runs native validation on each one, and
compares reviewed scenario snapshots without rewriting them. See the
[repository check contract](docs/check.md) for the versioned configuration.

## Prepared deployment and rollback

`prepare` fetches the selected active Liftosaur program, merges its state with a
new Git candidate relative to the previously deployed source, runs native
validation, and creates an immutable checksum-bound deployment bundle. It reads
Liftosaur but never writes to it. `prepare-deployment` remains available for
callers that already produced the active source, merged program, and evidence.

`deploy` requires the caller to restate the exact target ID and resulting name,
verifies that the live target is unchanged, writes once, and verifies the
read-back.

If a known successful write does not verify, the command restores and verifies
the prepared rollback source. It never guesses through an ambiguous write.
The API key is read only from `LIFTOSAUR_API_KEY`. See the
[deployment contract](docs/deployment.md) before using the command against a
live program.

## Tests

```sh
npm test
```

The test corpus covers every program in the pinned Liftosaur built-in catalog
plus a digest-pinned public RP Hypertrophy v4.1 program. Deployment tests use a
local fake API and never change Liftosaur.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
