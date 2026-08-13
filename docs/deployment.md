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

## Verified initialization and advanced first migration

Automatic initialization is deliberately narrow. It applies only when the
default config is absent, discovery finds exactly one regular root-level
`.liftoscript`, deployment `program` has no ref, and no `base_ref` was supplied.
It resolves Liftosaur `current` once to an exact ID, fetches that target's source,
and compares its UTF-8 bytes exactly with the discovered program blob at the
candidate commit. Native validation is also required, but validation is not used
as identity evidence.

An exact match needs no Liftosaur write. Automation creates canonical
`liftosaur-ci.json`, commits it directly to the selected release branch with a
lease against the exact observed branch SHA, and only after that succeeds creates
`refs/liftosaur-ci/deployments/program` at the new config-only commit with an
empty-ref lease. The program blob is identical in the original candidate and the
config-only descendant, so the descendant is the canonical initialized position.

A mismatch stops with instructions to export or copy the program currently used
in Liftosaur into the root file, commit it, and try again. No config, deployment
ref, or live write is made. A concurrent branch push or repository policy that
rejects the direct config commit also stops before ref creation or live mutation.
For a protected branch, pin canonical config manually and use the explicit
`base_ref` route, or deliberately adjust repository policy; no alternate token or
automatic pull request bypass is attempted.

Every other first deployment requires an explicit `base_ref` identifying the Git
revision already live in Liftosaur. This includes explicit config, custom or
nested layouts, multiple programs, generators, and historical migrations. If
`programId` is omitted, automation resolves `current` and commits the exact ID to
canonical config with the same branch lease **before** preparing or writing the
live update. Preparation then uses that config-only descendant as its candidate;
its deployable program blob is provably unchanged. Exact IDs configured up front
skip this commit. Once a deployment ref exists, it is always the durable base and
`base_ref` is unnecessary.

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
`record-deployment`. If initialization records config but deployment-ref creation
fails, no live write occurred; rerun the manual path with the reported config
commit as `base_ref`.

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
