# Find the right guide

Start with the repository [README](../README.md) for the shortest setup path.
Then choose the question that matches what you are doing.

## How do I set up automatic checks and deployment on GitHub?

Read [Use liftosaur-ci on GitHub](github-actions.md). It walks through the
copy-paste workflow, first run, normal use, optional approval, protected-branch
recovery, and advanced repository layouts.

## How do I configure and validate my repository?

Read [Check a repository](check.md). It explains zero-config discovery,
`liftosaur-ci.json`, multiple programs, reviewed scenarios, and check results.

## How does deployment preserve my live progression?

Read [Preserve state while deploying program logic](deployment.md). This is the
authoritative safety and recovery contract for initialization, three-way state
preservation, exact targets, Git deployment refs, writes, rollback, restore, and
private artifacts.

Read [Parser-backed generic merge evaluation](parser-backed-merge-evaluation.md)
for the measured, non-production prototype of a parser-derived reversible merge
projection over real progressed built-ins.

## Which local or automation command should I use?

Read [Choose a CLI command](cli.md). It separates the everyday `update` command,
custom automation stages, validation tools, and recovery commands.

## What does native validation guarantee?

Read [Native Liftosaur validation](native-validation.md). It defines the pinned
runtime checks and the complete, sequential, and partial scenario interfaces.

## How is liftosaur-ci released?

Read [Release liftosaur-ci](releasing.md) for version-tag mechanics and the
compatibility policy for the moving `0` workflow tag.
