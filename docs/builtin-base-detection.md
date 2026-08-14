# Built-in base detection and bootstrap design

This document records a possible future bootstrap convenience. It is a design,
not implemented behavior.

## Scope and ownership

The core `liftosaur-ci` contract begins once a program and its history are
represented in Git. Program authors own custom and community programs;
`liftosaur-ci` should not maintain a registry of popular programs, known
derivatives, or curated exceptions.

Automatic base detection is limited to official Liftosaur built-ins. Its one
purpose is to help when the live program originated from a built-in but the
correct historical merge base is not yet represented in Git. The catalogue
should be derived from Liftosaur upstream where practical, rather than copied
into this repository. Upstream additions, removals, renames, and changes should
ideally require no `liftosaur-ci` catalogue update or release.

Historical revisions are part of that catalogue. A live program may have been
cloned from an older built-in and modified since then, so the useful candidate is
the historical merge ancestor, not necessarily the current program with the
same name.

## Confidence policy

Detection optimizes for high precision, not high recall. A false negative costs
one manual bootstrap; a false positive supplies the wrong merge ancestor.
Therefore automation proceeds only while there is a single defensible
interpretation.

The preferred automatic decision mechanism is exact structural identity after
removing state that Liftosaur owns while a user trains. It must be invariant to
both normal progression and Liftosaur's own serialization:

1. Extract the Liftoscript program body from each official built-in revision.
2. Project both the live source and candidate into a representation that removes
   live set prescriptions, progression arguments, current markers, and other
   Liftosaur-owned mutable state.
3. Normalize source forms that Liftosaur's serializer can rewrite without an
   author edit, including reusable exercise forms and attached comments.
4. Automate only when exactly one candidate is byte-for-byte identical after
   that projection.

The current initialization projection is not yet sufficient for step 3. The
[progression evaluation](builtin-base-detection-evaluation.md#accumulated-live-progression)
found exact pristine-source matches for only 7 of 59 executable built-ins. This
design therefore remains blocked on a serialization-invariant structural
projection; the experiment does not authorize production autodetection.

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

Exact projected identity still needs historical revision testing after the
projection becomes serialization-invariant. It must distinguish real author
structure changes from live state without relying on a tuned similarity
threshold.

## Workflow outcomes

If exactly one official historical built-in is structurally identical after the
proven projection, `liftosaur-ci` may propose it as the merge base and hand off
to the normal reconciliation workflow.

Otherwise automatic detection stops without deploying. Structurally modified
programs use manual base/ref selection. The message may show the closest
plausible program and immutable upstream revision as a hint, then give the exact
configuration and base/ref instructions needed to confirm the base manually and
rerun. The product behavior need not expose a complex confidence taxonomy: it
only needs to distinguish proven identity from author confirmation.

Confident base detection does not authorize semantic conflict resolution. If
the normal three-way merge conflicts, automation stops through the existing
private conflict-workspace policy. This is the same rule at both stages:

- one defensible base and a clean deterministic merge: proceed;
- uncertain base or conflicting author intent: stop with actionable evidence.

Automatic state-preserving bootstrap may therefore continue only when the base
is identified conservatively, the candidate participates in the expected
lineage workflow, and reconciliation requires no choice between competing
intentions. Otherwise nothing is deployed and control returns to the author.

## Maintenance limit

This feature is worthwhile only while it remains a small convenience around the
ongoing Git-to-Liftosaur workflow. If reliable detection requires a substantial
classifier, manually maintained registry, or permanent platform-specific
knowledge base, the better product decision may be to make manual bootstrap
excellent and stop automation earlier.
