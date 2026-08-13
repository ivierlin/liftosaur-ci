# GitHub Actions integration

The recommended public flow is PR checks only, then **Ready to deploy** and
**Deploy verified program** after a push to `main`. Deployment exits successfully
when the deployable program blob is unchanged.

GitHub-only users do not install `liftosaur-ci`, Node.js, or local tooling. For
the minimal case, put the program currently used in Liftosaur in exactly one
regular root `*.liftoscript` file. With no `liftosaur-ci.json`, the first run
fetches the exact current target and verifies its source byte-for-byte against
Git. A match creates canonical config and the deployment ref without writing to
Liftosaur. Later program changes follow the normal deployment transaction.

```yaml
name: Liftosaur program
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      base_ref:
        description: Base Git revision (advanced first migration only)
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
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT
      base_ref: ${{ inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

Reusable workflows cannot elevate the caller's `GITHUB_TOKEN` permissions, so
the deployment job grants `contents: write` for the direct canonical-config
commit and deployment ref. No pull-request permission is required. Check and
project-requirement jobs remain read-only.

The repository owns the `project-requirements` job; `liftosaur-ci` is not a
general CI policy engine. Replace the trivial step with generators, tests, docs,
fuzzing, or other project-specific release evidence. Do not duplicate program
paths in `paths:` filters: discovery/config plus the deployment ref are the
relevance source of truth for the default deployable-script path.

For simple initialization, leave the manual `base_ref` field blank. For an
advanced first migration, enter the known Git revision corresponding to the
program already in Liftosaur. The same clickable Actions route therefore covers
advanced users without requiring a local installation. Once a deployment ref
exists, blank is again correct. Per-deployment concurrency serializes live
transactions.

Automatic deployment is the default. To require approval, create a GitHub
Environment and pass `environment: liftosaur`; leaving it empty adds no approval
gate. The reusable workflows use GitHub-hosted `ubuntu-latest` runners by default;
advanced repositories can override `runs_on` for self-hosted runners.

The optional Environment gates the live-write job. Simple initialization has no
live write, so it does not wait for approval. Target pinning for an advanced first
migration also occurs before the approval gate: if the branch moved, branch
protection, a ruleset, or token policy rejects the config-only commit, the run
fails before Liftosaur changes. After a verified simple initialization, that
failure prints the complete canonical `liftosaur-ci.json` and the exact verified
revision as `Base Git revision: <sha>`. Create and commit the shown config on the
current branch, rerun the workflow, and enter the shown revision in the optional
**Base Git revision** field. This remains the recovery path when the branch moved:
add the config to the new branch tip, but use the reported revision because it is
the Git version already verified byte-for-byte against Liftosaur. The workflow
does not bypass branch policy with a PAT or hidden token.

Repositories with multiple programs, nested program layouts, or other ambiguity
use `liftosaur-ci.json` and pass the deployment ID where needed. Advanced
repositories that generate deployable scripts or need different release topology
can compose the lower-level CLI commands instead of using this convenience
workflow.

Private prepared bundles and deployment receipts are retained for one day. A
verified live deployment followed by ref-recording failure is recoverable and is
not automatically reversed; the [deployment contract](deployment.md) owns those
failure and recovery semantics.
