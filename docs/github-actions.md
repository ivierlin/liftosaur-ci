# GitHub Actions integration

The recommended public flow is PR checks only, then **Ready to deploy** and
**Deploy verified program** after a push to `main`. Deployment exits successfully
when the configured program blob is unchanged.

```yaml
name: Liftosaur program
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      base_ref:
        description: Bootstrap base (first deployment only)
        required: false
        type: string

jobs:
  program-checks:
    name: Program checks
    permissions:
      contents: read
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT

  project-requirements:
    name: Project release requirements
    needs: program-checks
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: "true" # replace with generators, tests, docs, fuzzing, etc.

  deploy:
    if: github.event_name != 'pull_request'
    needs: project-requirements
    permissions:
      contents: write
      pull-requests: write
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT
      base_ref: ${{ inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

Reusable workflows cannot elevate the caller's `GITHUB_TOKEN` permissions, so
the deployment job grants `contents: write` for deployment refs and
`pull-requests: write` for the optional one-time target-binding PR. Check and
project-requirement jobs remain read-only. Repositories that always configure
exact target IDs never need pull-request write access at runtime, but keeping the
documented minimal deployment job uniform avoids a separate bootstrap variant.

The repository owns the `project-requirements` job; `liftosaur-ci` is not a
general CI policy engine. Replace the trivial step with generators, tests, docs,
fuzzing, or other project-specific release evidence. Do not duplicate program
paths in `paths:` filters: config plus the deployment ref are the relevance source
of truth for the default deployable-script path.

`workflow_dispatch` supplies the first `base_ref` and remains available for
bootstrap, recovery, and deliberate manual runs. After initialization,
release-branch pushes are zero-touch. Per-deployment concurrency serializes live
transactions.

Automatic deployment is the default. To require approval, create a GitHub
Environment and pass `environment: liftosaur`; leaving it empty adds no approval
gate. The reusable workflows use GitHub-hosted `ubuntu-latest` runners by default;
advanced repositories can override `runs_on` for self-hosted runners.

Repositories with multiple configured deployments pass the deployment ID to the
reusable workflow. Advanced repositories that generate deployable scripts or need
different release topology can compose the lower-level CLI commands instead of
using this convenience workflow.

Private prepared bundles and deployment receipts are retained for one day. A
verified live deployment followed by ref recording or binding-PR failure is
recoverable and is not automatically reversed; the [deployment contract](deployment.md)
owns those failure and recovery semantics.
