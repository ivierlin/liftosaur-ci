# Documentation

The documentation is organized by the question you are trying to answer. Each
current interface fact has one authoritative home; other pages link to it.

## How do I get started and update one program?

Start with the repository [README](../README.md). It covers requirements, runtime
setup, minimal configuration, the first update, and the normal update command.

## What commands are available, and which layer should I use?

Read [CLI command layers](cli.md) for the everyday `update` command, composable
deployment commands, and advanced or recovery tools.

## How are live progression and deployment safety preserved?

Read [Prepared deployment and recovery](deployment.md). It owns the deployment
configuration and state contract, three-way merge ownership, immutable Git and
Liftosaur target identities, the write transaction, rollback, restore, and
private deployment artifacts.

## How do I validate a repository?

Read [Repository check](check.md). It owns `liftosaur-ci.json` validation inputs,
program discovery, reviewed scenario configuration, reports, and check failures.

## What does native validation guarantee?

Read [Native Liftosaur validation](native-validation.md). It owns runtime-backed
validation guarantees and the public complete, sequential, and partial scenario
interfaces.

## How do I use the current reusable GitHub workflows?

Read [GitHub Actions integration](github-actions.md). It owns the supported
check and automatic deployment workflows, optional approval, their inputs and permissions,
runner/tool selection, and Actions-specific handling of private artifacts.
