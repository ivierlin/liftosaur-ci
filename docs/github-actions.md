# Use liftosaur-ci on GitHub

GitHub can check your Liftosaur program when you propose a change and deploy it
after the change reaches `main`. You do not need to install `liftosaur-ci`,
Node.js, or Git on your computer.

## Before you start

You need:

- a GitHub repository;
- for the simplest setup, the clean/original program source saved as the only
  root-level file whose name ends in `.liftoscript`; and
- a Liftosaur API key saved in the repository as a secret named
  `LIFTOSAUR_API_KEY`.

To add the secret, open the repository on GitHub. Go to **Settings**, then
**Secrets and variables** > **Actions**, and create a repository secret. Paste
the API key as its value. GitHub hides secret values from workflow logs.

## Add the workflow

Create `.github/workflows/liftosaur.yml` in the repository and paste this file:

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
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@0

  deploy:
    if: github.event_name != 'pull_request'
    needs: program-checks
    permissions:
      contents: write
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@0
    with:
      base_ref: ${{ github.event.inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

The `@0` reference receives compatible pre-1.0 workflow updates automatically.
You do not need to understand or edit the rest of the YAML for the simple setup.

## Run it for the first time

1. Open the repository's **Actions** tab.
2. Select **Liftosaur program**.
3. Choose **Run workflow**.
4. Leave **Base Git revision** blank and run the workflow.

Use the original built-in source if the live program began as a built-in, or the
original clean source if you authored it. Do not use a current progressed export.

The run privately fetches the current Liftosaur source and verifies that it can
be the progressed/stateful form of the clean Git program without changes to its
structure or author-owned logic. It also checks that the normal merge reproduces
the private live source exactly. When both checks pass, `liftosaur-ci` adds a
canonical `liftosaur-ci.json` file and records the clean Git version it verified.
It does **not** write the program back to Liftosaur.

If verification fails, check that Git contains the original clean source for
this live program. If only the progressed source remains, do not blindly commit
it because it can contain athlete-specific state. Use the advanced migration
path only with a trustworthy historical Git revision.

## Normal use

When someone opens or updates a pull request, **Program checks** validates the
proposed program without changing Liftosaur.

After a valid change reaches `main`, GitHub prepares the update, preserves the
progression stored in Liftosaur, deploys the reviewed program logic, verifies the
result, and records the deployed Git version. A change that does not alter the
deployable program finishes successfully without a live update.

## Optional approval before live changes

You can require a person to approve each live update by creating a protected
GitHub Environment, for example `liftosaur`. Then add this input under the
deployment job's existing `with:` section:

```yaml
      environment: liftosaur
```

GitHub applies the Environment's protection rules only when a live update is
needed. The first simple verification does not change Liftosaur, so it does not
wait for approval.

## If initialization cannot update the protected branch

Some branch rules prevent the first run from adding `liftosaur-ci.json`
directly. The failed run makes no Liftosaur change and prints both:

- the complete canonical `liftosaur-ci.json` to add; and
- an exact value labelled `Base Git revision`.

Add the shown config through your repository's normal review or approval
process. Then run **Liftosaur program** manually again and paste the reported
value into **Base Git revision**. Use that value even if other changes have since
reached the branch: it identifies the exact file already verified against
Liftosaur.

## Advanced first migration

The blank first-run field is for the clean-base verification described above.
Use `base_ref` when Git already has history and you know the exact revision that
produced the program already in Liftosaur.

Open **Actions** > **Liftosaur program** > **Run workflow** and enter that commit
ID in **Base Git revision**. This establishes the starting point for the
three-way state-preserving update. After the first successful deployment, leave
the field blank again because `liftosaur-ci` records the deployed position.

If you cannot identify a trustworthy starting revision, stop rather than guess.
The [deployment contract](deployment.md#first-time-initialization) explains why
the starting point matters.

## Advanced and custom repositories

Use [`liftosaur-ci.json`](check.md#when-configuration-is-needed) for multiple
programs, nested files, or explicit Liftosaur program IDs. The reusable
workflows also accept `config`, `deployment`, and `runs_on` for custom layouts,
named deployments, and self-hosted runners.

Project-specific release evidence belongs in the caller repository: your
project knows which generator, tests, or documentation checks make its source
ready, while `liftosaur-ci` owns Liftosaur-specific validation and deployment.
Put those requirements between the two reusable workflows. This example checks
the program first, runs the repository's own tests, and allows deployment only
after both succeed:

```yaml
jobs:
  program-checks:
    permissions:
      contents: read
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@0

  project-requirements:
    needs: program-checks
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test

  deploy:
    if: github.event_name != 'pull_request'
    needs: [program-checks, project-requirements]
    permissions:
      contents: write
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@0
    with:
      base_ref: ${{ github.event.inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

For a self-hosted runner, pass a JSON array of its labels to each reusable
workflow:

```yaml
    with:
      runs_on: '["self-hosted", "linux", "x64"]'
```

For a named deployment in `liftosaur-ci.json`, select it explicitly; an optional
protected Environment can require approval before the live write:

```yaml
    with:
      deployment: strength-program
      environment: liftosaur-production
```

Projects needing a different release topology or a custom generated-program
pipeline can compose the [lower-level CLI commands](cli.md#build-custom-automation).

### Preserve a conflict workspace

The reusable deployment workflow keeps the beginner path private by default and
does not expose conflict files. A custom workflow that needs merge evidence can
opt in when it runs `prepare-git`: add
`--conflict-output "$RUNNER_TEMP/liftosaur-conflict"`, then upload that directory
only when the preparation step fails.

`program` is the deployment ID created by zero-config single-program setup; with
an explicit `liftosaur-ci.json`, use the key defined under `deployments`.

```yaml
- name: Prepare relevant program change
  id: prepare
  shell: bash
  run: |
    node "$GITHUB_WORKSPACE/tool/bin/liftosaur-ci.mjs" prepare-git \
      --repository "$GITHUB_WORKSPACE/repository" \
      --config "$GITHUB_WORKSPACE/repository/liftosaur-ci.json" \
      --deployment program \
      --candidate-ref "$GITHUB_SHA" \
      --output "$RUNNER_TEMP/liftosaur-deployment" \
      --conflict-output "$RUNNER_TEMP/liftosaur-conflict"
  env:
    LIFTOSAUR_API_KEY: ${{ secrets.LIFTOSAUR_API_KEY }}

- name: Retain private conflict workspace
  if: failure() && steps.prepare.outcome == 'failure'
  uses: actions/upload-artifact@v7
  with:
    name: liftosaur-conflict-${{ github.run_id }}-${{ github.run_attempt }}
    path: ${{ runner.temp }}/liftosaur-conflict
    if-no-files-found: ignore
    retention-days: 1
```

Keep the repository and tool checkout, runtime setup, immutable candidate
selection, config path, and deployment ID aligned with the rest of your custom
pipeline. The artifact contains `base.liftoscript`, `active.liftoscript`,
`candidate.liftoscript`, `conflict.txt`, and `merge-report.json` when the failure
is an unresolved merge.

**The workspace may contain athlete-specific live state. Keep the repository
and artifact private, use short retention, and never commit the files or print
their contents in workflow logs.** Follow the
[human recovery procedure](deployment.md#recover-an-unresolved-live-versus-candidate-conflict)
after downloading it.

### Immutable workflow pinning

`@0` is the recommended compatibility channel. If your security policy requires
an immutable dependency, replace `0` in both `uses:` lines with an exact release
tag or full commit ID. The reusable workflow always loads its CLI implementation
from the exact same commit as the workflow definition.

## How the workflow is structured

Maintainers may need this map when changing permissions, adding a release gate,
or investigating why a run did or did not reach Liftosaur:

- **Program checks** validates the program and reviewed scenarios. It is
  read-only.
- **Project release requirements** is an optional caller-owned job for generators,
  tests, or documentation checks. It is read-only by default and must succeed
  before deployment when wired as shown above.
- **Ready to deploy** resolves initialization and whether the deployable program
  changed. It may write canonical config during first-time initialization, so
  the caller grants `contents: write`.
- **Deploy verified program** runs only when the program blob changed. It can
  wait for optional GitHub Environment approval, performs the verified live
  write, and records the deployed Git revision.

### Operational details

- A called reusable workflow cannot increase the permissions granted by the
  caller workflow.
- Deployments for the same configured program are serialized so two live changes
  cannot race.
- Reusable workflows use GitHub-hosted Ubuntu runners by default; `runs_on` can
  select compatible self-hosted runners.
- Prepared bundles and receipts can contain private progression state, so they
  remain private workflow artifacts and are retained for one day only.
- If a live write is verified but recording its Git position fails, retain the
  receipt and follow the [failure and recovery contract](deployment.md#failure-and-recovery).
  The tool does not silently reverse a verified write.
