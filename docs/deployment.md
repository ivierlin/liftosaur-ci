# Prepared deployment and rollback

Deployment is intentionally split into offline preparation and an explicit live
write. The caller owns credential storage, approval, private artifact retention,
and selection of the active source supplied during preparation.

## Prepare

First produce a successful validation report for the exact source to deploy.
When the source came from `merge`, retain its successful merge report too.

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

Preparation is offline. It verifies canonical source formatting and binds the
deployment source to passed validation and merge evidence. The new bundle
directory contains private program state and should never be committed or
published.

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
