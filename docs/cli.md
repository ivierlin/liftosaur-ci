# CLI command layers

The command surface has three layers. They share configuration, identities, and
failure semantics while exposing the amount of detail appropriate to each task.

## Everyday updates

`update` is the human-facing command. In a configured single-program repository,
it needs only `--base-ref` for the first deployment and no arguments thereafter.
Its errors identify the corresponding action: configure Liftosaur access, supply
the bootstrap base, resolve a live/Git conflict, move a direct Liftosaur logic
edit into Git, or use explicit recovery after an ambiguous write.

See the [deployment contract](deployment.md) for the complete update, merge, and
recovery behavior.

## Composable deployment

`prepare-git`, `deploy`, and `record-deployment` expose the preparation, live
write, and ref-recording stages used by `update`. They are the integration
surface for automatic or approval-gated CI and program-specific release pipelines.

`prepare-git` exits as a successful no-op when the configured program blob is
unchanged. `record-deployment` validates the verified receipt and pushes the
candidate commit to the deployment ref with an exact old-SHA lease. If recording
fails after the live write, retain the receipt and retry it.

These commands use `liftosaur-ci.json` by default and infer a single configured
deployment. Explicit raw inputs are available when configuration is deliberately
bypassed; configured and raw modes cannot be combined.

`prepare-git --program-name <name>` seals a reviewed name into the private
deployment bundle. `deploy` then verifies the observed name, writes the prepared
name and source, and verifies both on read-back. Without this option, deployment
preserves the live name.

`prepare-git` does not persist private live state when a merge conflicts. Add
`--conflict-output <directory>` to retain the deployed base, live source,
candidate, conflict representation, and merge report. This directory may contain
athlete-specific state; keep it private and use temporary storage in automation.

See [GitHub Actions integration](github-actions.md) for the reusable workflows
that compose these commands.

## Advanced and recovery tools

- `merge` performs the Liftosaur-aware three-way merge offline.
- `validate` runs native Liftosaur validation.
- `snapshot` produces output for a reviewed behavior scenario.
- `prepare` prepares caller-supplied base, live, and candidate sources. It also
  supports opt-in `--conflict-output`.
- `prepare-deployment` assembles a bundle from prepared sources and validation
  evidence.
- `rollback` explicitly restores the pre-update source after an ambiguous write.
- `restore` writes an exact historical deployment snapshot and rewinds its
  serialized progression state.

The [native validation contract](native-validation.md) owns validation and
scenario behavior. The [deployment contract](deployment.md) owns preparation,
rollback, restore, and private-artifact safety.
