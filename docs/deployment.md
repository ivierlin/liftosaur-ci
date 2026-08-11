# Prepared deployment and recovery

Deployment is split into preparation and an explicit live write. The caller owns
credential storage, approval, and private artifact retention. Target identity is
kept deliberately small: the Liftosaur program ID identifies the program and the
prepared source hash identifies the state that is safe to replace.

## Git-native preparation

When the program is stored in Git, provide the reviewed base and candidate refs
plus either an exact Liftosaur program ID or the API alias `current`:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --repository . \
  --base-ref last-deployed-tag \
  --candidate-ref reviewed-release-tag \
  --program programs/example.liftoscript \
  --program-id current \
  --output deployment-bundle
```

Both Git refs are resolved to immutable commits and program blobs. The source is
read from those Git objects, so unrelated staged, modified, or untracked files
in the worktree cannot affect preparation. A credential-free, non-local `origin`
URL is still required as provenance.

If `--program-id current` is used, preparation calls `programs/current` once and
stores the exact ID returned by Liftosaur in the bundle. All later verification
and deployment calls use that resolved exact ID; a later change in which program
is current cannot retarget an already prepared operation.

`--deployed-program-name` is optional. When omitted, deployment preserves the
name observed immediately before the write. When provided, it is an intentional
rename, not part of target identity.

### Configured deployments and tracked bases

A deployment can be declared directly in `liftosaur-ci.json`:

```json
{
  "deployments": {
    "example": {
      "program": "programs/example.liftoscript",
      "programId": "current",
      "deployedProgramName": "Example"
    }
  }
}
```

The first preparation supplies its Git base explicitly:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --config liftosaur-ci.json \
  --deployment example \
  --base-ref first-deployed-ref \
  --candidate-ref reviewed-ref \
  --output deployment-bundle
```

After a verified deployment, record its public Git identity from the private
report:

```sh
node bin/liftosaur-ci.mjs record-deployment \
  --config liftosaur-ci.json \
  --deployment example \
  --report private-deployment-record/deployment-report.json
```

This atomically writes `.liftosaur-ci/deployments/example.json`. The state file
contains only its version plus the deployed Git commit and program blob hashes.
The deployment ID already comes from the file path and the program path comes
from configuration, so neither is duplicated in state.

Commit that state after deployment. Future preparation can omit `--base-ref`;
the recorded commit becomes the base and its program blob must match before
Liftosaur is contacted.

## File-based end-to-end preparation

For sources prepared outside a Git worktree, supply the previously deployed
source and new candidate as files:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare \
  --base previously-deployed.liftoscript \
  --candidate new-git-source.liftoscript \
  --program-id current \
  --output deployment-bundle
```

This command has the same API identity semantics as `prepare-git`: `current` is
resolved during preparation and the bundle records the exact returned ID.
Preparation uses the API key only for reads and creates no deployable bundle if
merge or native validation fails.

## Assemble an externally prepared deployment

For external orchestration, first produce successful validation evidence for the
exact source to deploy. If the source came from `merge`, retain its merge report
too.

```sh
node bin/liftosaur-ci.mjs prepare-deployment \
  --active active-from-liftosaur.liftoscript \
  --program merged.liftoscript \
  --validation-report validation-report.json \
  --merge-report merge-report.json \
  --program-id resolved-program-id \
  --output deployment-bundle
```

`prepare-deployment` is offline, so it cannot resolve `current`; callers must
supply an exact ID. It verifies canonical source formatting and binds the active
source, deployment source, validation evidence, and optional merge evidence by
hash. The manifest contains those hashes directly; there is no duplicate
`SHA256SUMS` file.

Bundles contain private program state and should never be committed or
published.

## Deploy

For an unconfigured bundle, restate only the exact resolved target ID:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs deploy \
  --bundle deployment-bundle \
  --confirm-program-id resolved-program-id \
  --output private-deployment-record
```

Configured deployment uses the target declared in the config, so no separate
confirmation argument is needed.

The bundle must be no more than 24 hours old. `--max-age-hours` may choose a
shorter lifetime. Before writing, deployment fetches the exact resolved program
ID and requires its source hash to match the prepared active source. It then
writes once to that exact ID and reads the same ID back.

A read-back matching the deployment source is success. A read-back still
matching the prepared active source means the write did not take effect. Any
other state is treated as an ambiguous or concurrent change: deployment stops,
records the failure, and **does not automatically roll back**. The private
`rollback-active.liftoscript` remains available for deliberate recovery, but an
unknown third state is never overwritten without a new explicit operation.
