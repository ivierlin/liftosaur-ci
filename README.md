# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

## What it does

The default workflow is intentionally small:

1. Keep your Liftosaur program in Git.
2. Change and commit the program as usual.
3. Let `liftosaur-ci` merge in the progression data accumulated in the app since
   the previous deployment.
4. Validate the merged program and write it back to the same Liftosaur program.

The goal is **updated program logic without losing real-world exercise state**.
The normal user should not need to describe that state, rename the program, or
configure merge rules manually.

A minimal deployment config contains only the Git program path and Liftosaur
target:

```json
{
  "formatVersion": 3,
  "implementation": "liftosaur-check-config-v3",
  "deployments": {
    "program": {
      "program": "programs/example.liftoscript",
      "programId": "current"
    }
  }
}
```

`programId` may be an exact Liftosaur ID or `current`. `current` is resolved once
during preparation to the exact returned ID, and that exact ID is used for every
later read and write. The live program name is preserved automatically.

## Setup

Requirements: Node.js 24, npm, and Git.

```sh
node scripts/setup-runtime.mjs
```

`liftosaur-ci` itself has no npm dependencies. Runtime setup fetches the exact
Liftosaur revision recorded in `runtime/liftosaur.version` into
`.private/liftosaur-runtime` and installs that runtime's dependencies. Set
`LIFTOSAUR_RUNTIME` to use another dedicated checkout. CI may keep this checkout
in a persistent cache while the pinned revision and Node ABI remain unchanged.

## Default Git deployment

The first deployment needs one extra fact: which Git revision corresponds to the
program currently in Liftosaur.

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --config liftosaur-ci.json \
  --base-ref first-deployed-ref \
  --output deployment-bundle
```

`prepare-git` defaults the candidate to `HEAD`. With one configured deployment it
also infers the deployment ID. It reads the previous Git version, the live
Liftosaur version, and the new Git version, then performs a Liftosaur-aware
three-way merge and native validation.

Deploy the prepared result with:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs deploy \
  --bundle deployment-bundle \
  --config liftosaur-ci.json \
  --output private-deployment-record
```

After a verified deployment, record the deployed Git identity:

```sh
node bin/liftosaur-ci.mjs record-deployment \
  --config liftosaur-ci.json \
  --report private-deployment-record/deployment-report.json
```

This writes a tiny state file containing only the deployed Git commit and program
blob hashes. Once that state is committed, future preparations need no explicit
base ref:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --config liftosaur-ci.json \
  --output deployment-bundle
```

Repositories with multiple deployments add `--deployment <id>` where needed.
The reusable GitHub Actions workflow automates the same prepare → approval →
deploy → state-PR sequence; see [GitHub Actions integration](docs/github-actions.md).

## Why the merge is safe

The three inputs are:

- the previously deployed Git source,
- the current Liftosaur source containing accumulated progression,
- the new reviewed Git source.

Independent live progression is carried forward while reviewed program changes
are applied. Conflicting changes fail closed instead of being guessed. Repeated
same-exercise statements are distinguished by occurrence.

Preparation resolves Git refs to immutable commits and blobs, so unrelated dirty
worktree files cannot affect the prepared source. Before deployment, the live
program must still match the source hash seen during preparation. Deployment then
writes once to the exact resolved Liftosaur ID and verifies the read-back.

If read-back is neither the old prepared state nor the intended new state,
`liftosaur-ci` stops and preserves the rollback source for explicit recovery. It
does not automatically overwrite an unknown concurrent state.

See the full [deployment contract](docs/deployment.md).

## Validation and regression checks

Validate one program directly:

```sh
node bin/liftosaur-ci.mjs validate \
  --program program.liftoscript \
  --report validation-report.json
```

Validation uses the pinned Liftosaur runtime to evaluate the program, construct
every workout day, verify serialization parity, complete nominal work sets,
execute update and finish scripts, and reload progressed programs. See the
[native validation policy](docs/native-validation.md).

Repository-wide checks are configured in `liftosaur-ci.json`:

```sh
node bin/liftosaur-ci.mjs check --config liftosaur-ci.json
```

Optional reviewed scenarios can capture expected behavior over one or several
exposures. Unknown scenario fields are rejected rather than silently ignored.
See the [repository check contract](docs/check.md).

## Lower-level tools

The normal Git workflow above is the intended path. The CLI also exposes smaller
building blocks for custom tooling:

- `merge` — offline Liftosaur-aware three-way merge.
- `snapshot` — produce reviewed scenario snapshots.
- `prepare` — prepare from caller-supplied base and candidate files.
- `prepare-deployment` — assemble a bundle from already prepared sources and
  validation evidence.

These commands are useful for integration and debugging, but normal users should
not need them to keep a Git-managed program synchronized with Liftosaur.

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

It checks every program in the pinned Liftosaur built-in catalog and runs on pull
requests, `main`, and manual CI runs. The digest-pinned public RP Hypertrophy v4.1
network corpus is available separately:

```sh
npm run test:external
```

Deployment tests use a local fake API and never change Liftosaur.

## Licensing

`liftosaur-ci` is licensed under `AGPL-3.0-only`. It loads parser/runtime
internals from the AGPL-licensed Liftosaur project; see [NOTICE](NOTICE).

Liftosaur and its trademarks are owned by their respective holders. This
community project is not affiliated with or endorsed by Liftosaur.
