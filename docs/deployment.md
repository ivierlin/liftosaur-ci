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

The Liftosaur-aware three-way merge carries independent live progression into the
new program while applying reviewed code/configuration changes. Conflicting edits
fail closed instead of guessing. Native validation must pass before a deployment
can proceed.

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

## Approval-gated automation

The reusable GitHub Actions workflow deliberately keeps preparation and deploy as
separate steps so a protected environment can approve the live write. It uses the
same core functions as `update`, then opens a state-only pull request after a
verified deployment. See [GitHub Actions integration](github-actions.md).

## Lower-level building blocks

`prepare-git`, `deploy`, and `record-deployment` expose the three stages used by
`update` and the GitHub workflow. `prepare` provides the same merge and validation
path for caller-supplied base and candidate files. `prepare-deployment` assembles
a bundle from already prepared active/deploy sources and validation evidence;
because it is offline, it requires an already resolved exact program ID.

Bundles and deployment receipts contain private program state and should not be
committed or published.
