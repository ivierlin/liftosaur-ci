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
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT

  project-requirements:
    name: Project release requirements
    needs: program-checks
    runs-on: self-hosted
    steps:
      - run: "true" # replace with generators, tests, docs, fuzzing, etc.

  deploy:
    if: github.event_name != 'pull_request'
    needs: project-requirements
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT
      base_ref: ${{ inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

The repository owns the project-requirements job; liftosaur-ci is not a general
CI policy engine. Do not duplicate program paths in `paths:` filters. Config and
the deployment ref are the relevance source of truth.

`workflow_dispatch` supplies the first `base_ref` and remains available for
recovery. After initialization, release-branch pushes are zero-touch.
Per-deployment concurrency serializes transactions.

Automatic deployment is the default. To require approval, create a GitHub
Environment and pass `environment: liftosaur`; leaving it empty adds no gate.
The workflow needs contents write access for custom refs and pull-request access
only for an omitted target's one-time binding PR. Exact IDs avoid that PR.

Private bundles and receipts are retained for one day. A verified live deployment
followed by a ref or PR failure is recoverable and is not automatically reversed.
