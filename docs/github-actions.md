# GitHub Actions integration

Two reusable workflows provide the baseline GitHub integration:

- `reusable-check.yml` validates configured programs and reviewed snapshots.
- `reusable-deploy.yml` prepares an immutable bundle, pauses at a protected
  environment, deploys with read-back verification, then opens a pull request
  containing the non-sensitive deployment state.

The workflows use caller-selected runner labels and a caller-pinned tool
revision. They do not assume a GitHub-hosted runner. `liftosaur-ci` itself has no
npm dependencies, so the workflows do not run `npm ci` or maintain an npm cache;
the pinned Liftosaur runtime has its own setup/cache path.

## Repository setup

Put the Liftosaur target directly in the deployment entry in
`liftosaur-ci.json`. It may be an exact ID or `current`. Only
`LIFTOSAUR_API_KEY` needs to be stored as a deployment secret.

Create a protected environment such as `liftosaur` and require approval before a
job can enter it. The preparation job can read Liftosaur but cannot write it; the
live write starts only after the environment admits the deploy job.

After a verified deployment, the workflow creates
`.liftosaur-ci/deployments/<id>.json`. It copies that generated state onto a new
branch created from `state_branch` and opens a pull request back to
`state_branch`. Starting from the state branch guarantees that the state PR
contains only the state update even when `candidate_ref` came from another
branch.

The private bundle and deployment receipt are retained as workflow artifacts for
one day. The caller must grant `contents: write` and `pull-requests: write`, and
repository settings must allow GitHub Actions to create pull requests. If
`liftosaur-ci` is private, pass a read-only `tool_token`; it is not needed when
the tool repository is public.

## Pull-request and push checks

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
      runs_on: '["self-hosted","Linux","X64"]'
```

Replace `TOOL_COMMIT` with one reviewed commit in both locations. When the tool
repository is private, pass `tool_token` from a read-only repository secret.

## Manual prepare and deployment

```yaml
name: Deploy Liftosaur program

on:
  workflow_dispatch:
    inputs:
      deployment:
        description: Configured deployment ID
        required: true
        type: string
      candidate_ref:
        description: Reviewed commit or tag to deploy
        required: true
        type: string
      base_ref:
        description: Bootstrap base; leave empty after state is tracked
        required: false
        type: string

permissions:
  contents: write
  pull-requests: write

jobs:
  deploy:
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      deployment: ${{ inputs.deployment }}
      candidate_ref: ${{ inputs.candidate_ref }}
      base_ref: ${{ inputs.base_ref }}
      tool_ref: TOOL_COMMIT
      environment: liftosaur
      state_branch: main
      runs_on: '["self-hosted","Linux","X64"]'
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

If a configured deployment uses `current`, preparation resolves it to the exact
ID returned by Liftosaur and stores that ID in the private bundle. The approved
deploy job subsequently reads and writes only that exact ID.

On success, merge the generated state pull request before preparing the next
deployment.
