# Prepared deployment and recovery

The normal job is simple: take the reviewed Git version of a Liftosaur program,
merge in the progression data accumulated in the app since the previous deploy,
validate the result, and write it back to the same Liftosaur program.

The safety identity is deliberately small: the Liftosaur program ID identifies
the target, and the prepared source hash identifies the live state that is safe
to replace. Program names are preserved automatically.

## Configured Git workflow

A deployable repository needs only the program path and target:

```json
{
  "formatVersion": 3,
  "implementation": "liftosaur-check-config-v3",
  "deployments": {
    "example": {
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
deployment.

For the first deployment, provide the Git revision that corresponds to the
program version currently in Liftosaur:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --config liftosaur-ci.json \
  --base-ref first-deployed-ref \
  --output deployment-bundle
```

When exactly one deployment is configured, `--deployment` is unnecessary.
Preparation defaults the candidate to `HEAD`, so the normal command does not need
to restate the program path, target, candidate revision, or program name.

Both Git revisions are resolved to immutable commits and program blobs. Source is
read from those Git objects, so unrelated staged, modified, or untracked files in
the worktree cannot affect the prepared program. A credential-free, non-local
`origin` URL is retained as provenance.

After a verified deployment, `record-deployment` writes only the deployed Git
commit and program blob hashes to `.liftosaur-ci/deployments/<id>.json`. Future
preparations use that recorded revision automatically, so `--base-ref` is needed
only for bootstrap:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --config liftosaur-ci.json \
  --output deployment-bundle
```

Repositories with multiple deployments add `--deployment <id>` where needed.

## What preparation preserves

Preparation reads three versions of the program:

- the previously deployed Git source,
- the current Liftosaur source containing real-world progression state,
- the new reviewed Git source.

The Liftosaur-aware three-way merge carries independent live progression into the
new program while applying reviewed code/configuration changes. Conflicting edits
fail closed instead of guessing. Native validation must pass before a deployment
bundle is created.

## Deploy

For a configured deployment:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs deploy \
  --bundle deployment-bundle \
  --config liftosaur-ci.json \
  --output private-deployment-record
```

A single configured deployment is inferred automatically. Unconfigured callers
must restate the exact resolved target with `--confirm-program-id`.

The bundle must be no more than 24 hours old. Before writing, deployment fetches
the exact resolved program ID and requires its source hash to match the prepared
active source. It writes the merged source once while preserving the live program
name, then reads the same exact ID back.

A read-back matching the deployment source is success. A read-back still matching
the prepared active source means the write did not take effect. Any other state
is treated as an ambiguous or concurrent change: deployment stops and **does not
automatically roll back**. The private `rollback-active.liftoscript` remains
available for deliberate recovery, but an unknown third state is never
overwritten automatically.

## Advanced building blocks

`prepare` provides the same merge and validation path for caller-supplied base
and candidate files. `prepare-deployment` assembles a bundle from already
prepared active/deploy sources and validation evidence; because it is offline,
it requires an already resolved exact program ID.

Bundles and deployment receipts contain private program state and should not be
committed or published.
