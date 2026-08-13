# Choose a CLI command

Most people using the provided GitHub workflow do not need these commands. Use
the CLI when you update locally, build custom automation, or perform an explicit
recovery.

## Update locally

Use `update` for a normal state-preserving update from a configured repository.
In a single-program repository, the first update needs `--base-ref` with the Git
revision that produced the program currently in Liftosaur. Later updates need no
base because the successful deployed position is recorded.

`update` performs the complete operation: prepare, validate, write, verify, and
record. Its errors tell you whether to configure API access, supply the first
base, resolve a live/Git conflict, move a direct Liftosaur logic edit into Git,
or use explicit recovery after an ambiguous write.

Read the [deployment contract](deployment.md) before a first migration or
recovery.

## Build custom automation

Use these commands when a release pipeline needs separate checking, approval,
deployment, and recording stages:

- `initialize-git` verifies simple first-time setup or pins the exact Liftosaur
  target for a based migration. It can commit canonical config and push, so it
  requires an explicit release branch.
- `prepare-git` reads immutable Git objects, performs the three-way merge, and
  creates a private deployment bundle. An unchanged program is a successful
  no-op.
- `deploy` verifies the prepared target, writes once, reads the exact target
  back, and produces a receipt.
- `record-deployment` verifies that receipt and moves the deployment ref using
  the exact position previously observed. If recording fails after a verified
  write, retain the receipt and retry this command.

These commands use `liftosaur-ci.json` by default and infer a single configured
deployment. Configured and raw input modes cannot be mixed.

Use `prepare-git --program-name <name>` to include a reviewed program-name
change. Without it, deployment preserves the live name. Use
`--conflict-output <directory>` only when you need private merge evidence; that
directory can contain athlete-specific state and must not be published.

The [GitHub Actions guide](github-actions.md) shows the supported reusable
workflow that composes these stages.

## Validate or inspect behavior

- `check` validates a repository and its reviewed snapshots.
- `validate` runs native Liftosaur validation for a source.
- `snapshot` runs a reviewed behavior scenario.
- `merge` performs the Liftosaur-aware three-way merge offline.
- `prepare` prepares caller-supplied base, live, and candidate sources.
- `prepare-deployment` assembles a bundle from prepared sources and validation
  evidence.

See [Check a repository](check.md) and the
[native validation contract](native-validation.md) for their authoritative
inputs and guarantees.

## Recovery commands

`rollback` is only for an ambiguous write. It consumes the private recovery
directory reported by `update`, restores the exact pre-write source to the exact
prepared target, and verifies the result.

`restore` is the destructive historical-disaster-recovery path. It writes the
complete historical source, including historical progression state, from an
extracted deployment bundle. It does not advance the deployment ref.

Do not use either command as an ordinary program-logic revert. The
[failure, rollback, and restore sections](deployment.md#failure-and-recovery)
explain the difference and the required private data.
