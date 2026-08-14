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

The first approach to evaluate is deliberately simple:

1. Extract the Liftoscript program body from each official built-in revision.
2. Normalize inconsequential representation details such as appropriate
   whitespace and comments.
3. Compare the live body with the historical catalogue using ordinary textual
   or edit distance.
4. Apply an absolute admissibility threshold to the best candidate.
5. Only after it passes that threshold, require adequate separation from the
   next plausible candidate.

A large winner margin cannot rescue a poor absolute match. The least-distant
candidate may still be unrelated. Conversely, close phases or variants may be
genuinely ambiguous even when both are good matches.

Do not add semantic weighting, a Liftoscript classifier, a maintained knowledge
base, or other sophisticated machinery unless upstream data demonstrates that
the simple conservative approach is insufficient and that the added maintenance
cost is proportionate to this first-run convenience.

## Evidence for thresholds

Thresholds must come from upstream history rather than intuition. The evaluation
should include:

- all current built-in pairs, including each program's nearest and
  second-nearest neighbors;
- known close families such as Starting Strength, GZCL/GZCLP, and 5/3/1;
- time-travel lineage tests that compare a later built-in revision against the
  catalogue available before that revision;
- absolute distance to the known prior revision, winner margin, whether that
  lineage is recovered, and misleading or ambiguous results.

Historical lineage tests are the primary basis for the acceptance boundary.
Community modifications may later be useful as an independent validation set,
but they do not become product catalogue entries.

The eventual threshold should define a conservative acceptance zone supported
by observed successful lineage cases while rejecting known wrong-winner and
close-family cases. It should not be tuned merely to maximize the fraction of
programs classified.

## Workflow outcomes

If exactly one official historical built-in passes both the absolute threshold
and the winner-margin requirement, `liftosaur-ci` may propose it as the merge
base and hand off to the normal reconciliation workflow.

Otherwise automatic detection stops without deploying. The message should show
the closest plausible program and immutable upstream revision when useful, then
give the exact configuration and base/ref instructions needed to confirm the
base manually and rerun. The product behavior need not expose a complex
confidence taxonomy: it only needs to distinguish safe automation from author
confirmation.

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
