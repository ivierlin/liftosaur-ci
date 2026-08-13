# Preserve state while deploying program logic

`liftosaur-ci` keeps reviewed program logic in Git without losing the progression
that accumulates in Liftosaur. It treats Git as the owner of code and Liftosaur
as the owner of live training state, then combines both when a program changes.

## The mental model

A normal update uses three sources:

```text
previously deployed Git source + current Liftosaur state + new Git source
                              -> prepared deployment
```

The previously deployed source is the common starting point, or **base**. The
current source fetched from Liftosaur is **live**. The reviewed Git version to
deploy is the **candidate**.

The configured deployment identifies one `.liftoscript` path and may identify
one exact Liftosaur `programId`. A Git ref named
`refs/liftosaur-ci/deployments/<deployment-id>` records the commit last verified
as deployed. A ref is a Git pointer; this one is operational state, not a branch
people edit.

## First-time initialization

### Simple verified setup

Automatic initialization is intentionally narrow. It applies when:

- `liftosaur-ci.json` does not exist;
- exactly one regular root-level `.liftoscript` file is discovered;
- deployment `program` has no recorded deployment ref; and
- no `base_ref` was supplied.

The tool resolves Liftosaur's current program to an exact ID, fetches its source,
and compares its UTF-8 bytes with the candidate file. Native validation must
also pass, but validation alone is not proof that the two sources are identical.

When they match, no Liftosaur write is needed. Automation creates canonical
`liftosaur-ci.json`, commits it to the selected release branch, and creates the
initial deployment ref at that config-only commit. The program file is identical
before and after the config commit, so the recorded position is exact.

A mismatch stops without creating config, a deployment ref, or a live write.
Replace the Git file with the source currently used in Liftosaur and retry.

### Advanced first migration

Every other first deployment needs an explicit `base_ref`: the Git revision that
produced the program already live in Liftosaur. This includes explicit config,
nested or multiple programs, generators, and historical migrations.

If config omits `programId`, automation first resolves Liftosaur's `current`
program and commits that exact ID to canonical config. It then uses the
config-only descendant as the candidate; the program blob is provably unchanged.
An exact configured ID skips that commit. Once a deployment ref exists, it
becomes the durable base and `base_ref` is no longer needed.

## Later updates

Preparation reads the base program from the recorded Git commit, the current
live source from the exact configured Liftosaur target, and the candidate from
an immutable Git commit. It does not read modified, staged, or untracked
worktree files.

For an initialized deployment, only the configured program blob determines
whether deployment is relevant. Equal base and candidate blobs are a successful
no-op even when other repository files changed. The tool does not infer whether
templates, generators, engines, or other files should trigger deployment; a
project with those dependencies must express them in its own release pipeline.

## What Git owns and what Liftosaur owns

Code inside Liftoscript `{ ... }` bodies is Git-managed program logic. If live
Liftosaur code differs from the base, preparation stops. Commit that edit to Git
or discard it in Liftosaur before continuing; the tool will not silently merge
direct edits to program code.

Serialized values outside those bodies are eligible live progression state.
Independent live changes are carried into the candidate. If live state and the
candidate change the same mergeable region incompatibly, preparation fails
instead of guessing.

The live program name is preserved unless preparation explicitly seals a
reviewed replacement with `--program-name`.

## Safety checks before and after writing

Preparation resolves Git revisions to immutable commits and reads the program
blob directly from those objects. It also retains a credential-free, non-local
`origin` URL as provenance.

Before writing, deployment fetches the exact Liftosaur program ID again. Its
source hash and name must match what preparation observed. The tool then writes
once and reads that same ID back.

The result is successful only when the read-back source and name match the
prepared deployment. If read-back still matches the pre-write source, the write
did not take effect. Any other readable state is an ambiguous or concurrent
change. The tool stops and does not automatically roll it back.

Only after a successful exact read-back does `record-deployment` advance the
deployment ref.

## Deployment position in Git

The deployment ref points to the last verified deployed commit. The program
blob is derived from that commit and the configured path, so hidden state does
not duplicate a program hash or target ID.

Both initialization and later recording use a **lease**: the write succeeds only
if the branch or ref still has the exact value previously observed. A concurrent
change therefore fails closed instead of being overwritten. The deployment ref
may move backward for a deliberate Git rollback; ancestry is not the safety
rule. The exact observed old value is.

During initialization, the canonical-config commit is leased against the exact
observed release-branch commit. The initial deployment ref is then created only
if it is still absent. Branch protection or a concurrent push stops this before
any Liftosaur write.

## Failure and recovery

### Failure before a write

Validation, merge, target, branch, or lease failures before the live write leave
Liftosaur unchanged. Correct the reported problem and rerun.

If protected-branch policy rejects the initialization config commit, the error
prints the complete canonical config and exact `base_ref`. Commit that config
through normal repository policy and rerun the manual workflow with the reported
value. No alternate token or hidden policy bypass is attempted.

If the config commit succeeds but initial ref creation fails, no live write has
occurred. Rerun the manual path using the reported config commit as `base_ref`.

### Ambiguous live write

When a write was attempted but read-back cannot prove a safe outcome, the
one-command `update` path retains private recovery data and prints:

```sh
liftosaur-ci rollback --recovery "/path/reported/by/update"
```

`rollback` restores the exact pre-write source to the exact prepared target,
preserves the current name, and verifies read-back. Before replacing an unknown
current source, it saves that observed source as additional private recovery
material. Repeating a successful rollback is safe.

This command applies only to an ambiguous write. It does not apply to failures
before writing or to an already verified deployment.

### Ref recording failure after a verified write

A verified live write is not automatically reversed when deployment-ref
recording fails. Retain the private deployment receipt and retry
`record-deployment`; its exact-old-value lease prevents overwriting a newer
recorded position.

## Rolling back program logic

An ordinary program-logic rollback is another reviewed Git change: revert the
unwanted commit or select an older candidate and run the normal update. Current
Liftosaur progression remains the live side of the merge and is carried into the
older logic. After verification, the deployment ref moves to that candidate with
the normal lease.

This differs from emergency `rollback`, which restores the source that existed
immediately before one ambiguous write.

## Historical restore

`restore` is the deliberately destructive disaster-recovery command. Given an
extracted historical bundle, it writes the bundle's exact `deploy.liftoscript`
to its exact recorded program ID:

```sh
LIFTOSAUR_API_KEY=... liftosaur-ci restore \
  --artifact /path/to/historical-deployment-bundle
```

It verifies the bundle source, saves today's complete target in a private
recovery directory, preserves the current program name, writes the historical
source, and verifies read-back. Normal deployment-age and prepared-live-source
checks deliberately do not apply.

A restore rewinds all serialized source state, including later progression. It
does not move the deployment ref; the author must deliberately choose the next
normal deployed Git position.

## Private artifacts

Deployment bundles, conflict workspaces, receipts, rollback observations, and
restore recovery data may contain athlete-specific state. Do not commit them,
print them in logs, or publish them. Automation should use temporary private
storage and short retention. Long-term backup is an explicit author decision.

See [Use liftosaur-ci on GitHub](github-actions.md) for the recommended
automation and [Choose a CLI command](cli.md) for the commands implementing this
contract.
