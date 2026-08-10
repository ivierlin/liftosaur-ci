# GitHub Actions integration

Two reusable workflows provide the baseline GitHub integration:

- `reusable-check.yml` validates all configured programs and reviewed snapshots.
- `reusable-deploy.yml` prepares an immutable bundle, pauses at a protected
  environment, deploys with read-back verification and automatic rollback, then
  opens a pull request containing the non-sensitive deployment state.

The workflows use caller-selected runner labels and a caller-pinned tool
revision. They do not assume a GitHub-hosted runner.

## Repository setup

Use `LIFTOSAUR_PROGRAM_ID` as `programIdEnv` for deployments run by the reusable
workflow. Store that program ID and `LIFTOSAUR_API_KEY` as Actions secrets. Create
a protected environment such as `liftosaur` and require approval before a job can
enter it.

The deployment candidate should already be contained in `state_branch`, normally
`main`. The workflow commits only `.liftosaur-ci/deployments/<id>.json` on a new
branch and opens a pull request back to that branch. The private bundle and
deployment receipt are retained as workflow artifacts for one day.

The caller must grant `contents: write` and `pull-requests: write` to the deploy
workflow, and repository settings must allow GitHub Actions to create pull
requests. Store the Liftosaur values as repository or organization secrets; a
caller job cannot pass environment-only secrets to a reusable workflow. If
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
        description: Reviewed commit or tag already on main
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
      liftosaur_program_id: ${{ secrets.LIFTOSAUR_PROGRAM_ID }}
```

Preparation reads the exact current Liftosaur source but cannot write it. The
live write begins only after the protected `liftosaur` environment admits the
deploy job. On success, merge the generated state pull request before preparing
the next deployment.
