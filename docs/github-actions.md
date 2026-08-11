# GitHub Actions integration

Two reusable workflows provide the baseline integration:

- `reusable-check.yml` validates configured programs and reviewed snapshots.
- `reusable-deploy.yml` prepares the updated program, pauses at a protected
  environment, deploys with read-back verification, then opens a pull request
  containing the non-sensitive deployment state.

## Minimal setup

Use the conventional deployment ID `program` and configure only the program path
and Liftosaur target:

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

Only `LIFTOSAUR_API_KEY` needs to be stored as a deployment secret. Create a
protected environment such as `liftosaur` and require approval before the live
write.

The reusable deployment workflow defaults to deployment `program` and to the
caller commit, so a normal caller does not need to pass a program ID, program
path, program name, deployment ID, or candidate ref.

```yaml
name: Deploy Liftosaur program

on:
  workflow_dispatch:
    inputs:
      base_ref:
        description: Bootstrap base; leave empty after the first tracked deployment
        required: false
        type: string

permissions:
  contents: write
  pull-requests: write

jobs:
  deploy:
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      base_ref: ${{ inputs.base_ref }}
      tool_ref: TOOL_COMMIT
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

`base_ref` is required only for the first deployment, when liftosaur-ci needs to
know which Git revision corresponds to the program already in the app. After the
resulting deployment-state pull request is merged, later deployments infer that
base automatically.

If `programId` is `current`, preparation resolves it to the exact ID returned by
Liftosaur. The approved deployment later reads and writes only that exact ID.
The live program name is preserved automatically.

## Checks

```yaml
name: Liftosaur check

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  liftosaur:
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT
```

Replace `TOOL_COMMIT` with one reviewed liftosaur-ci commit in both locations.
Runner labels may be overridden with `runs_on`; the default is a self-hosted
Linux X64 runner. If the tool repository is private, pass a read-only
`tool_token`.

## Private merge-conflict artifacts

A real three-way merge conflict can contain athlete-specific live state. By
default `prepare` and `prepare-git` do not persist that state. Their conflict
message prominently shows how to opt in with `--conflict-output <directory>`.

For a custom GitHub Actions deployment workflow, write that workspace under
`$RUNNER_TEMP`, never inside the checked-out repository, and upload it only when
preparation fails. Keep retention short:

```yaml
- name: Prepare deployment
  env:
    LIFTOSAUR_API_KEY: ${{ secrets.LIFTOSAUR_API_KEY }}
  run: |
    liftosaur-ci prepare-git \
      --deployment program \
      --output "$RUNNER_TEMP/liftosaur-deployment" \
      --conflict-output "$RUNNER_TEMP/liftosaur-conflict"

- name: Retain private conflict workspace
  if: failure()
  uses: actions/upload-artifact@v7
  with:
    name: liftosaur-conflict-${{ github.run_id }}-${{ github.run_attempt }}
    path: ${{ runner.temp }}/liftosaur-conflict
    if-no-files-found: ignore
    retention-days: 1

- name: Remove private conflict workspace
  if: always()
  run: rm -rf "$RUNNER_TEMP/liftosaur-conflict"
```

The conflict artifact may contain `active.liftoscript` and therefore must be
treated as private operational data. Do not commit it, place it on a pull-request
branch, print its contents to the workflow log, or store it with long-lived
public build artifacts. The ordinary deployment-state pull request remains safe
because it contains only Git identity metadata.

If a repository needs stronger privacy than its normal Actions artifact access
model provides, omit `--conflict-output` entirely and reproduce the conflict in a
trusted local environment instead.

## Multiple programs and advanced overrides

Repositories with multiple configured deployments pass `deployment`. A specific
reviewed commit or tag can be selected with `candidate_ref`. `environment`,
`state_branch`, `config`, `runs_on`, and `tool_repository` are also overridable,
but none are required for the common single-program layout.

After a verified deployment, the workflow creates
`.liftosaur-ci/deployments/<id>.json`, copies only that state onto a branch based
on `state_branch`, and opens a pull request. This prevents candidate code changes
from leaking into the state-only PR.

The private bundle and deployment receipt are retained as workflow artifacts for
one day. `liftosaur-ci` itself has no npm dependencies, so the workflows skip
`npm ci` and npm caching; the pinned Liftosaur runtime has its own setup/cache
path.
