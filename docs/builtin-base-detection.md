# Built-in base detection and bootstrap design

This document records the evaluated bootstrap design and its final disposition.
Built-in autodetection is not implemented and should not be pursued; manual
bootstrap remains the supported direction.

## Scope and ownership

The core `liftosaur-ci` contract begins once a program and its history are
represented in Git. Program authors own custom and community programs;
`liftosaur-ci` should not maintain a registry of popular programs, known
derivatives, or curated exceptions.

The experiment limited automatic base detection to official Liftosaur built-ins.
Its proposed purpose was to help when the live program originated from a
built-in but the correct historical merge base was not yet represented in Git.

Historical revisions were part of that candidate catalogue. A live program may
have been cloned from an older built-in and modified since then, so the useful
candidate is the historical merge ancestor, not necessarily the current program
with the same name.

## Confidence policy

The experiment optimized for high precision, not high recall. A false negative
costs one manual bootstrap; a false positive supplies the wrong merge ancestor.
Automation therefore could have proceeded only with a single defensible
interpretation.

The final candidate mechanism was exact structural identity after removing state
that Liftosaur owns while a user trains:

1. Extract the Liftoscript program body from each official built-in revision.
2. Project both the live source and candidate into a representation that removes
   live set prescriptions, progression arguments, current markers, and other
   Liftosaur-owned mutable state.
3. Normalize source forms that Liftosaur's serializer can rewrite without an
   author edit, including reusable exercise forms and attached comments.
4. Automate only when exactly one candidate is byte-for-byte identical after
   that projection.

The [evaluation](builtin-base-detection-evaluation.md#parser-derived-structural-identity)
found that a compact parser-derived representation matched only 50 of 59
executable built-ins after 16 accumulated exposures and failed to detect a
reusable-definition edit. Fixing both gaps requires semantic reconstruction of
definitions, inheritance, and serializer-expanded aliases. This crosses the
maintenance limit, so the design decision is manual bootstrap rather than a
blocked future autodetector.

Textual or edit-distance similarity must not decide an automatic base. The
historical experiment found a close, confidently separated wrong winner for
Starting Strength Phase 2. A closest-match result may remain an informational
hint accompanying manual base/ref selection, but it cannot supply the merge
ancestor automatically.

## Evidence requirements

Candidate representations must be tested against upstream history rather than
intuition. The evaluation should include:

- all current built-in pairs, including each program's nearest and
  second-nearest neighbors;
- known close families such as Starting Strength, GZCL/GZCLP, and 5/3/1;
- time-travel lineage tests that compare a later built-in revision against the
  catalogue available before that revision;
- absolute distance to the known prior revision, winner margin, whether that
  lineage is recovered, and misleading or ambiguous results.

Historical lineage tests are a primary check on the identity boundary.
Community modifications may later be useful as an independent validation set,
but they do not become product catalogue entries.

See the [upstream history evaluation](builtin-base-detection-evaluation.md) for
the exploratory current-pair and time-travel results that informed this design.

Exact structural identity was tested against current and historical revisions.
Uniqueness was encouraging, but progression invariance and edit sensitivity
failed; historical uniqueness alone does not make an identity function safe.

## Workflow outcomes

Users confirm the base through manual base/ref selection. A closest plausible
program and immutable upstream revision may be shown as an informational hint,
but neither similarity nor the exploratory fingerprint supplies the merge base
automatically.

Author confirmation of a base does not authorize semantic conflict resolution.
If the normal three-way merge conflicts, automation stops through the existing
private conflict-workspace policy:

- one defensible base and a clean deterministic merge: proceed;
- uncertain base or conflicting author intent: stop with actionable evidence.

State-preserving bootstrap continues only after the author identifies the base
and reconciliation requires no choice between competing intentions. Otherwise
nothing is deployed and control returns to the author.

## Maintenance limit

Reliable detection required semantic definition/inheritance reconstruction and
serializer-specific exceptions even without a classifier, maintained family
registry, or heuristic thresholds. The experiment therefore reached this limit:
make manual bootstrap excellent and stop automatic base detection here.
