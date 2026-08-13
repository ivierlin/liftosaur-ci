# Use liftosaur-ci on GitHub

GitHub can check your Liftosaur program when you propose a change and deploy it
after the change reaches `main`. You do not need to install `liftosaur-ci`,
Node.js, or Git on your computer.

## Before you start

You need:

- a GitHub repository;
- for the simplest setup, the program currently in Liftosaur saved as the only
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
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-check.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT

  deploy:
    if: github.event_name != 'pull_request'
    needs: program-checks
    permissions:
      contents: write
    uses: ivierlin/liftosaur-ci/.github/workflows/reusable-deploy.yml@TOOL_COMMIT
    with:
      tool_ref: TOOL_COMMIT
      base_ref: ${{ github.event.inputs.base_ref || '' }}
    secrets:
      liftosaur_api_key: ${{ secrets.LIFTOSAUR_API_KEY }}
```

Replace every `TOOL_COMMIT` with the full commit ID of the reviewed
`liftosaur-ci` version you want to use. Pinning an exact commit prevents the tool
from changing unexpectedly. You do not need to understand or edit the rest of
the YAML for the simple setup.

## Run it for the first time

1. Open the repository's **Actions** tab.
2. Select **Liftosaur program**.
3. Choose **Run workflow**.
4. Leave **Base Git revision** blank and run the workflow.

The run checks that the root `.liftoscript` file is byte-for-byte identical to
the source currently in Liftosaur. It also validates the program. When they
match, `liftosaur-ci` adds a canonical `liftosaur-ci.json` file and records the
Git version it verified. It does **not** write the program back to Liftosaur.

If the sources do not match, copy or export the program currently used in
Liftosaur into the root file, save that change in GitHub, and run the workflow
again.

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

The blank first-run field is correct only when the Git file exactly matches the
program currently in Liftosaur. Otherwise, you must provide `base_ref`: the Git
revision that produced the program already in Liftosaur.

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
workflows also accept `config`, `deployment`, `runs_on`, and tool-repository
inputs for custom layouts, named deployments, and self-hosted runners.

Projects with generators or additional release tests can put a job between the
two reusable workflows. For example, add a `project-requirements` job that needs
`program-checks`, then make `deploy` need `project-requirements`. That seam is
optional; beginners do not need a placeholder job. Projects needing a different
release topology can compose the [lower-level CLI commands](cli.md#build-custom-automation)
instead.

## How the workflow is structured

`program-checks` has read-only repository access. `deploy` needs
`contents: write` so it can add canonical config during initialization and
record the verified deployed position in Git. A called reusable workflow cannot
increase the permissions granted by this caller file.

Deployments for the same configured program are serialized so two live changes
cannot race. The reusable workflows use GitHub-hosted Ubuntu runners by default.
Prepared bundles and receipts can contain private progression state, so GitHub
retains them as private workflow artifacts for one day only. If a live write is
verified but recording its Git position fails, retain the receipt and follow the
[failure and recovery contract](deployment.md#failure-and-recovery); the tool
does not silently reverse a verified write.
