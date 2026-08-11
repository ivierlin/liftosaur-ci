# liftosaur-ci

Unofficial Git-based migration, validation, and deployment tooling for
[Liftosaur](https://www.liftosaur.com/).

## What it does

The normal workflow is intentionally small:

1. Keep your Liftosaur program in Git.
2. Change and commit the program as usual.
3. Run `liftosaur-ci update`.
4. The tool merges in the progression data accumulated in the app, validates the
   result, and writes it back to the same Liftosaur program.

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
during each preparation to the exact returned ID, and that exact ID is used for
every later read and write. The live program name is preserved automatically.

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

## Update a program

The first update needs one extra fact: which Git revision corresponds to the
program version currently in Liftosaur.

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update \
  --base-ref first-deployed-ref
```

That is the bootstrap. After a successful update, liftosaur-ci records the
deployed Git commit and program blob in `.liftosaur-ci/deployments/program.json`.
Commit that small state file with your repository.

From then on, the normal command is simply:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update
```

With one configured deployment, everything else is inferred:

- `HEAD` is the new reviewed Git version,
- the tracked deployment state identifies the previous deployed Git version,
- the configured program ID or `current` identifies the Liftosaur program,
- Liftosaur provides the live progression state accumulated since the previous
  update.

The command performs the three-way merge, native validation, exact-ID deployment,
read-back verification, and deployment-state update as one operation.

Repositories with multiple deployments add `--deployment <id>`. The reusable
GitHub Actions workflow keeps the same logic but separates preparation and the
live write with a protected approval gate; see
[GitHub Actions integration](docs/github-actions.md).

## Why the merge is safe

The three inputs are:

- the previously deployed Git source,
- the current Liftosaur source containing accumulated progression,
- the new reviewed Git source.

Independent live progression is carried forward while reviewed program changes
are applied. Conflicting changes fail closed instead of being guessed. Repeated
same-exercise statements are distinguished by occurrence.

Git revisions are resolved to immutable commits and blobs, so unrelated dirty
worktree files cannot affect the source being deployed. Before deployment, the
live program must still match the source hash seen during preparation. Deployment
then writes once to the exact resolved Liftosaur ID and verifies the read-back.

If read-back is neither the old prepared state nor the intended new state,
`liftosaur-ci` stops and preserves private recovery files. It does not
automatically overwrite an unknown concurrent state.

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

`update` is the intended manual workflow. The CLI also exposes the individual
building blocks for custom tooling, debugging, and approval-gated automation:

- `prepare-git` — prepare an immutable Git-backed deployment bundle.
- `deploy` — verify and write a prepared bundle.
- `record-deployment` — record the verified deployed Git identity.
- `merge` — offline Liftosaur-aware three-way merge.
- `validate` — native Liftosaur validation.
- `snapshot` — produce reviewed scenario snapshots.
- `prepare` — prepare from caller-supplied base and candidate files.
- `prepare-deployment` — assemble a bundle from already prepared sources and
  validation evidence.

Normal users should not need these pieces separately just to keep a Git-managed
program synchronized with Liftosaur.

## Tests

For normal development:

```sh
npm run test:fast
```

This runs the unit/integration suite plus a deterministic sample of three pinned
Liftosaur built-in programs. Branch pushes rotate that sample by commit SHA, so
coverage changes between commits while any failure remains reproducible.

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
