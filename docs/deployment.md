# Prepared deployment and recovery

Configuration owns target identity. A deployment contains one deployable
`.liftoscript` path and may contain an exact Liftosaur `programId`. Durable
configuration rejects the literal `current`; raw CLI use may still resolve it.

Operational position lives only in
`refs/liftosaur-ci/deployments/<deployment-id>`, pointing to the last verified
deployed commit. The program blob is derived from that commit and configured
path, so no blob hash or program ID is duplicated in hidden state.

## Bootstrap and target binding

With no deployment ref, preparation requires `--base-ref` for the Git revision
corresponding to the program already live in Liftosaur. It is never guessed. If
the config omits `programId`, preparation resolves `current` once and seals the
exact returned ID into the private bundle. After verified deployment, automation
creates the ref and opens one config PR pinning that ID.

Once a ref exists, a missing exact ID fails closed before resolving `current`.
The deployment remains blocked until the binding PR is merged or recreated.

## Relevance and recording

Preparation compares only the configured program blob at the deployment ref
with the candidate commit's blob. Equal blobs are a clean no-op despite unrelated
commits. liftosaur-ci does not infer generator, template, or engine dependencies.

Only after the live write and exact read-back succeed does `record-deployment`
advance the ref with `--force-with-lease=<ref>:<observed-old-sha>`. Concurrent
advances fail closed; deliberate non-fast-forward Git rollbacks remain possible.
The ref is bookkeeping, not authorization.

If the live deployment succeeds but ref recording fails, it is not rolled back.
Retain the private receipt and retry `record-deployment`. A binding-PR failure
also leaves the deployment and ref intact, while later deployments stay blocked.

## Safety and recovery

Preparation combines the previous Git source, current live source, and immutable
candidate. Git owns Liftoscript program bodies; direct live logic edits and merge
conflicts fail closed. Native validation, exact target locking, live-source
concurrency checks, and post-write read-back remain mandatory.

Unknown post-write state is never automatically rolled back. Private recovery
data supports explicit `rollback`; historical `restore` deliberately rewinds all
serialized progression. Bundles and receipts can contain athlete state and must
remain private.
