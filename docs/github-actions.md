# GitHub Actions integration

Two reusable workflows provide the current integration:

- `reusable-check.yml` validates configured programs and reviewed snapshots.
- `reusable-deploy.yml` prepares an update, pauses at a protected environment,
  deploys with read-back verification, and opens a pull request containing only
  non-sensitive deployment state.

Configure the repository before calling either workflow. The [README](../README.md)
shows the minimal configuration; the [deployment contract](deployment.md) owns
target resolution, bootstrap state, merge behavior, and recovery semantics.

## Deployment workflow

Store `LIFTOSAUR_API_KEY` as a deployment secret. Create a protected environment,
such as `liftosaur`, and require approval before the live write.

The workflow defaults to deployment `program` and the caller commit:

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

Pass `base_ref` for the first deployment only. Merge the resulting
deployment-state pull request before the next deployment so later runs can infer
the deployed Git base.

## Check workflow

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

Replace `TOOL_COMMIT` with one reviewed liftosaur-ci commit in both workflows.
Runner labels may be overridden with the JSON-array `runs_on` input; the default
is `["self-hosted"]`. If the tool repository is private, pass a read-only
`tool_token`.

## Private merge-conflict artifacts

A three-way merge conflict can contain athlete-specific live state. By default,
`prepare` and `prepare-git` do not persist it. A custom workflow may opt in with
`--conflict-output <directory>` under `$RUNNER_TEMP`, upload the directory only
on preparation failure, and keep retention short:

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

The artifact may contain `active.liftoscript`. Do not commit it, place it on a
pull-request branch, print it in logs, or retain it with public build artifacts.
The deployment-state pull request remains non-sensitive because it contains only
Git identity metadata. For a stricter privacy boundary, omit `--conflict-output`
and reproduce the conflict in a trusted local environment.

## Overrides and resulting state

Repositories with multiple deployments pass `deployment`. `candidate_ref`
selects a reviewed commit or tag. The workflow also accepts `environment`,
`state_branch`, `config`, `runs_on`, and `tool_repository` overrides.

After a verified deployment, the workflow copies only
`.liftosaur-ci/deployments/<id>.json` onto a branch based on `state_branch` and
opens a pull request. Candidate code changes are not included in that state-only
pull request. The private preparation bundle and deployment receipt are retained
as workflow artifacts for one day.

`liftosaur-ci` has no npm dependencies, so these workflows skip `npm ci` and npm
caching. The pinned Liftosaur runtime uses its own setup and cache path.
