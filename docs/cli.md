# CLI layers

`liftosaur-ci` serves three related use cases. The command surface should stay consistent without pretending that every caller needs the same level of detail.

## Everyday updates

`update` is the human-facing convenience command. In a configured single-program repository it should normally need no arguments after bootstrap. Its output should describe what the author needs to know and do next, not internal deployment identities, report formats, or state-file plumbing.

Errors from `update` should therefore translate common failures into actions: configure Liftosaur access, supply the bootstrap base, resolve a live/Git conflict, or move a direct Liftosaur logic edit back into Git. Recovery paths remain explicit when an attempted write has an ambiguous result.

## Composable deployment

`prepare-git`, `deploy`, and `record-deployment` are the stable primitives for CI workflows and integrations such as program-specific release pipelines. They use the same repository configuration conventions as `update`: `liftosaur-ci.json` is the default config and a single deployment is inferred.

These commands keep technical errors and exact identities visible because callers may need them for logs, policy checks, or orchestration. Explicit raw inputs remain available when configuration is intentionally bypassed, but configured and raw modes are mutually exclusive rather than partially mixed.

## Advanced and recovery tools

`merge`, `validate`, `snapshot`, `prepare`, and `prepare-deployment` expose lower-level or offline building blocks. `rollback` and `restore` are explicit recovery operations. These commands favor precise contracts and technical diagnostics over convenience wording.

The distinction is intentional: consistency means predictable flags, defaults, identities, and failure semantics across the CLI, while presentation follows the audience of each command.
