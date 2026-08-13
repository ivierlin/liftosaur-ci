# Prepared deployment and recovery

The normal job is simple: take the reviewed Git version of a Liftosaur program,
merge in progression accumulated in the app since the previous update, validate
the result, and write it back to the same Liftosaur program.

Configuration owns target identity. A deployment contains one deployable
`.liftoscript` path and may contain an exact Liftosaur `programId`. Durable
configuration rejects the literal `current`; raw CLI use may still resolve it.
Program names are preserved automatically unless preparation seals a reviewed
replacement with `--program-name`.

Operational position lives only in
`refs/liftosaur-ci/deployments/<deployment-id>`, pointing to the last verified
deployed commit. The program blob is derived from that commit and configured
path, so no blob hash or program ID is duplicated in hidden state.

## Bootstrap and target binding

With no deployment ref, preparation requires `--base-ref` for the Git revision
corresponding to the program already live in Liftosaur. It is never guessed.

If config contains an exact `programId`, that target is used from the start. If
it omits `programId`, preparation resolves Liftosaur's `current` alias once and
seals the exact returned ID into the private deployment bundle. After verified
deployment, automation creates the deployment ref and opens one config PR pinning
that exact ID.

Once a deployment ref exists, a missing exact ID fails closed before resolving
`current`. The deployment remains blocked until the binding PR is merged or the
exact ID is otherwise committed. Repositories with multiple deployments can set
exact IDs up front and avoid this bootstrap PR entirely.

## Relevance and deployed position

For an initialized deployment, preparation compares only the configured program
blob at the deployment ref with the candidate commit's blob. Equal blobs are a
clean no-op even when unrelated repository files or commits changed.
`liftosaur-ci` deliberately does not infer generator, template, engine, or other
project-specific dependency graphs.

Only after the live write and exact read-back succeed does `record-deployment`
advance the deployment ref. Existing refs are updated with an exact old-SHA lease;
a concurrent advance therefore fails closed rather than overwriting newer state.
The deployed pointer may move non-fast-forward for deliberate Git rollbacks, so
ancestry is not the safety invariant. The exact previously observed ref value is.

If the live deployment succeeds but ref recording fails, the verified live write
is not automatically rolled back. Retain the private deployment receipt and retry
`record-deployment`. If the one-time target-binding PR fails after bootstrap, the
verified deployment and ref remain intact, while later deployments stay blocked
until config contains the exact target ID.

## What preparation preserves

Preparation reads three versions of the program:

- the previously deployed Git source,
- the current Liftosaur source containing real-world progression state,
- the new reviewed Git source.

Code inside Liftoscript `{ ... }` bodies is Git-managed program logic. If the live
Liftosaur source differs from the previously deployed Git source inside those
bodies, preparation stops: the author must commit that logic change in Git or
discard it in Liftosaur before updating. The tool does not merge program-code
edits made directly in the app.

Everything outside those bodies is eligible live progression for the three-way
merge. Independent live changes are carried forward. If the live source and new
Git source change the same mergeable region incompatibly, preparation fails
closed rather than guessing.

Git revisions are resolved to immutable commits and program blobs, and source is
read from those objects. Unrelated staged, modified, or untracked worktree files
cannot affect the prepared program. A credential-free, non-local `origin` URL is
retained as provenance.

## Deployment transaction

Before writing, deployment fetches the exact resolved Liftosaur program ID and
requires its source hash and name to match the target observed during preparation.
It writes the prepared source once, preserving the live name by default or
applying a reviewed name sealed by `--program-name`, then reads the same exact ID
back.

A read-back matching the prepared deployment source and name is success. A
read-back still matching the prepared pre-write source means the write did not
take effect. Any other readable state is treated as an ambiguous or concurrent
change. Deployment stops and **does not automatically roll back**.

The private rollback source is retained for deliberate recovery. The one-command
`update` path reports its recovery directory when deployment has started and then
fails; failures before any live write clean up temporary recovery data.

## Explicit rollback after an ambiguous write

When a live write was attempted but read-back cannot establish a safe outcome,
`update` reports an explicit recovery command:

```sh
liftosaur-ci rollback --recovery "/path/reported/by/update"
```

`rollback` is not a general version-revert command. It accepts recovery data from
an ambiguous write, restores the exact pre-write source to the exact prepared
target, preserves the current program name, and verifies the result by read-back.
Before replacing an unknown current source, it retains that observed source as
additional private recovery material. Repeating a successful rollback is
idempotent.

Failures before the write, a target that changed before deployment, and already
verified successful deployments are outside this emergency rollback contract.

## Version rollback through Git

Rolling back reviewed program logic is normally another Git change: revert the
unwanted commit or choose an older candidate and run the ordinary update path.
The current Liftosaur source remains the live side of the merge, so accumulated
progression is carried into the older program logic rather than rewound.

This is distinct from emergency `rollback`: Git rollback changes reviewed program
logic, while emergency rollback restores the source that existed immediately
before one ambiguous live write.

After a verified Git rollback deployment, `record-deployment` moves the custom
deployment ref to that verified candidate commit using the same exact-old-SHA
lease as any other deployment.

## Advanced historical restore

`restore` is the deliberately destructive disaster-recovery path. Given an
extracted historical deployment bundle, it writes the exact historical
`deploy.liftoscript` to the bundle's exact resolved program ID:

```sh
LIFTOSAUR_API_KEY=... liftosaur-ci restore \
  --artifact /path/to/historical-deployment-bundle
```

It validates the historical source against the bundle manifest but deliberately
does not apply normal deployment-age or prepared-live-source checks. Before
writing, it saves today's complete target source in a private recovery directory,
preserves the current program name, writes the historical source, and verifies
read-back.

A historical restore therefore rewinds **all** serialized source state, including
progression accumulated after that artifact. It does not advance the deployment
ref automatically; after disaster recovery, the author must deliberately decide
which Git revision should become the next normal deployed position.

## Private artifacts

Deployment bundles, conflict workspaces, receipts, rollback observations, and
restore recovery data may contain athlete-specific live state. They must not be
committed, printed in logs, or published. Automation should use temporary private
storage and short retention. Long-term backup is an explicit author decision, not
part of normal continuous deployment.

See [GitHub Actions integration](github-actions.md) for the recommended automation
flow and [CLI command layers](cli.md) for the composable commands implementing
this contract.
