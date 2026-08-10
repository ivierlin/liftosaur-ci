# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

## Status

This repository is an early extraction from a proven migration experiment. The
current release contains an offline three-way merge CLI only. It has no GitHub,
credential, preparation, or deployment capability.

## Setup

Requirements: Node.js 24, npm, and Git.

```sh
npm ci
npm run setup:runtime
```

Runtime setup fetches the exact Liftosaur revision recorded in
`runtime/liftosaur.version` into `.private/liftosaur-runtime` and installs its
dependencies. Set `LIFTOSAUR_RUNTIME` to use another dedicated checkout.

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
npm test
```

The test corpus covers every program in the pinned Liftosaur built-in catalog
plus a digest-pinned public RP Hypertrophy v4.1 program.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
