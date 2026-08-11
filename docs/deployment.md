# Prepared deployment and recovery

The normal job is simple: take the reviewed Git version of a Liftosaur program,
merge in the progression data accumulated in the app since the previous update,
validate the result, and write it back to the same Liftosaur program.

The safety identity is deliberately small: the Liftosaur program ID identifies
the target, and the prepared source hash identifies the live state that is safe
to replace. Program names are preserved automatically.

## Default `update` workflow

A deployable repository needs only the program path and target:

```json
{
  "deployments": {
    "program": {
      "program": "programs/example.liftoscript",
      "programId": "current"
    }
  }
}
```

`programId` may be an exact ID or the Liftosaur API alias `current`. When
`current` is used, preparation calls `programs/current` once, stores the exact ID
returned by Liftosaur in the private bundle, and uses only that exact ID from then
on. A later change of the current program cannot retarget an already prepared
write.

The first update must identify the Git revision corresponding to the program
version already in Liftosaur:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update \
  --base-ref first-deployed-ref
```

After success, liftosaur-ci writes `.liftosaur-ci/deployments/program.json` with
the deployed Git commit and program blob hashes. Commit that small state file.
Future updates infer the base automatically:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs update
```

For that zero-argument path:

- `HEAD` is the candidate Git version,
- the tracked state supplies the previous deployed Git version,
- configuration supplies the Liftosaur target,
- Liftosaur supplies the current source containing accumulated real-world state.

`update` is a thin orchestration layer over the same preparation, deployment, and
state-recording functions used by the lower-level commands. It does not implement
a second migration path.

When exactly one deployment is configured, its ID is inferred. Repositories with
multiple deployments add `--deployment <id>`.

## What preparation preserves

Preparation reads three versions of the program:

- the previously deployed Git source,
- the current Liftosaur source containing real-world progression state,
- the new reviewed Git source.

The ownership rule is intentionally simple. Code inside Liftoscript `{ ... }`
bodies is Git-managed program logic. If the live Liftosaur source differs from the
previously deployed Git source inside any such body, preparation stops: the author
must either commit that edit in Git or discard it in Liftosaur before updating.
The CI does not attempt to merge program-code edits made in the app.

Everything outside those bodies is treated as eligible live progression for the
three-way merge. That deliberately avoids trying to classify every prescription,
state argument, timer, or other serialized field. Independent live changes are
carried forward; when both the live source and new Git source change the same
mergeable region incompatibly, the merge still fails closed instead of guessing.

Git revisions are resolved to immutable commits and program blobs. Source is read
from those Git objects, so unrelated staged, modified, or untracked files in the
worktree cannot affect the program being prepared. A credential-free, non-local
`origin` URL is retained as provenance.

## Deployment transaction

Before writing, deployment fetches the exact resolved program ID and requires its
source hash to match the source observed during preparation. It writes the merged
source once while preserving the live program name, then reads the same exact ID
back.

A read-back matching the deployment source is success. A read-back still matching
the prepared active source means the write did not take effect. Any other state
is treated as an ambiguous or concurrent change: deployment stops and **does not
automatically roll back**.

The private rollback source is retained for deliberate recovery. When the
one-command `update` path reaches deployment and then fails, it reports the
private temporary recovery directory instead of deleting it. Preparation failures
that never reached deployment clean up their temporary files automatically.

## Explicit rollback after an ambiguous write

When the deployment write was attempted but read-back cannot establish whether it
succeeded safely, `update` prints an explicit recovery command using the retained
directory:

```sh
liftosaur-ci rollback --recovery "/path/reported/by/update"
```

This command is intentionally not a general deployment-revert mechanism. It only
accepts a recovery directory whose deployment report records an ambiguous write.
Failures before the write, a target that changed before deployment, and verified
successful deployments are outside this command's scope.

Rollback reads the exact prepared target ID and pre-write source from the retained
recovery data. Before replacing the current unknown source, it saves that source
as `record/rollback-observed.liftoscript`. It then writes the pre-update source
while preserving the current program name and verifies the exact target by
read-back. A repeated rollback is idempotent: if the target already matches the
pre-update source, no write is performed.

If rollback itself cannot be verified, the originally observed unknown state
remains in the recovery directory and any readable post-attempt state is retained
as additional private recovery material.

## Version rollback through Git

Rolling back program logic is normally just another reviewed Git change. Revert
the unwanted commit or select the older candidate revision, then use the ordinary
update pipeline. Because the current Liftosaur source remains the live side of the
merge, accumulated progression is carried into the older program logic rather
than rewound.

This is distinct from the emergency `rollback` command above: Git rollback changes
reviewed program logic, while emergency rollback restores the source that existed
immediately before one ambiguous write.

## Advanced historical restore

`restore` is the deliberately destructive disaster-recovery path. Given an
extracted historical deployment bundle, it writes the exact historical
`deploy.liftoscript` back to the bundle's exact resolved program ID:

```sh
LIFTOSAUR_API_KEY=... liftosaur-ci restore \
  --artifact /path/to/historical-deployment-bundle
```

The command validates the historical source against the bundle manifest but does
not apply the normal deployment age or prepared-live-source checks: those checks
would defeat the purpose of restoring a historical snapshot. Before writing, it
fetches today's exact target and saves that complete source in a private temporary
recovery directory. It preserves the current program name, writes the historical
source, and verifies the read-back.

A historical restore therefore rewinds **all** serialized source state, including
progression accumulated after that artifact. It does not modify tracked Git
deployment state; after recovery, the author must deliberately decide what Git
revision should become the next normal candidate/base relationship.

Deployment bundles contain live program state and must remain private. The
reusable workflow keeps uploaded bundles short-lived by default; long-term backup
or archival is an explicit author responsibility rather than part of normal
continuous deployment.

## Approval-gated automation

The reusable GitHub Actions workflow deliberately keeps preparation and deploy as
separate steps so a protected environment can approve the live write. It uses the
same core functions as `update`, then opens a state-only pull request after a
verified deployment. See [GitHub Actions integration](github-actions.md).

## Lower-level building blocks

`prepare-git`, `deploy`, and `record-deployment` expose the three stages used by
`update` and the GitHub workflow. `rollback` provides the explicit recovery path
for an ambiguous one-command update. `restore` provides exact historical-snapshot
recovery and intentionally rewinds progression. `prepare` provides the same merge
and validation path for caller-supplied base and candidate files.
`prepare-deployment` assembles a bundle from already prepared active/deploy sources
and validation evidence; because it is offline, it requires an already resolved
exact program ID.

Bundles and deployment receipts contain private program state and should not be
committed or published.
