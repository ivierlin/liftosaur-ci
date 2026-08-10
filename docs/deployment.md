# Prepared deployment and rollback

Deployment is intentionally split into offline preparation and an explicit live
write. The caller owns credential storage, approval, private artifact retention,
and selection of the active source supplied during preparation.

## Git-native preparation

When the program is stored in Git, use an exact Liftosaur program ID plus the
reviewed base and candidate refs:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare-git \
  --repository . \
  --base-ref last-deployed-tag \
  --candidate-ref reviewed-release-tag \
  --program programs/example.liftoscript \
  --program-id exact-program-id \
  --deployed-program-name "New name" \
  --output deployment-bundle
```

The command requires a clean worktree and a credential-free, non-local `origin`
URL. Both refs are resolved to immutable commits and program blobs. The bundle
records the remote identity, Git object format, repository-relative path,
requested refs, commit IDs, and blob IDs. Deployment copies that provenance into
its private receipt.

An expected current name is deliberately unnecessary: the exact program ID
selects the target, and preparation records the name returned by Liftosaur.
`current` is therefore not accepted by `prepare-git`.

## File-based end-to-end preparation

For sources prepared outside a Git worktree, supply the exact previously
deployed source and new candidate as files. This path retains the optional
expected-name guard and `current` alias because it lacks Git target provenance:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs prepare \
  --base previously-deployed.liftoscript \
  --candidate new-git-source.liftoscript \
  --program-id current \
  --expected-program-name "Current name" \
  --deployed-program-name "New name" \
  --output deployment-bundle
```

`--program-id` may be an exact program ID or `current`; the bundle always records
the resolved ID. Preparation uses the API key only for a read and never changes
Liftosaur. Both end-to-end paths produce no deployable bundle when merging or
native validation fails.

## Assemble an externally prepared deployment

For external orchestration, first produce a successful validation report for
the exact source to deploy. When the source came from `merge`, retain its
successful merge report too.

```sh
node bin/liftosaur-ci.mjs prepare-deployment \
  --active active-from-liftosaur.liftoscript \
  --program merged.liftoscript \
  --validation-report validation-report.json \
  --merge-report merge-report.json \
  --program-id program-id \
  --expected-program-name "Current name" \
  --expected-current true \
  --deployed-program-name "New name" \
  --output deployment-bundle
```

`prepare-deployment` is offline. It verifies canonical source formatting and
binds the deployment source to passed validation and merge evidence. Bundles
from either preparation path contain private program state and should never be
committed or published.

## Deploy

Review the bundle, exact operation, and rollback source before authorizing a
live write. Then provide the API key through the environment and restate the
approved target and resulting name:

```sh
LIFTOSAUR_API_KEY=... node bin/liftosaur-ci.mjs deploy \
  --bundle deployment-bundle \
  --confirm-program-id program-id \
  --confirm-program-name "New name" \
  --output private-deployment-record
```

The bundle must be no more than 24 hours old. `--max-age-hours` may choose a
shorter lifetime. Before writing, the command verifies the live program ID,
name, current-program status, and source checksum against the prepared target.
After writing, it verifies the exact resulting name and source.

If the API accepted the write but read-back verification differs, the prepared
name and source are restored and verified automatically. If the write outcome
is ambiguous and the live target matches neither prepared source, no automatic
rollback is attempted. The command fails and preserves a private report for
manual inspection.
