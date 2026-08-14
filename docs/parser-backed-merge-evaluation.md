# Parser-backed generic merge evaluation

## Conclusion

A reversible projection built directly from the pinned Liftosaur parser is
promising, but this prototype is not production-ready. It removes the previous
hand-written section splitter and custom-state argument parser, merges five of
six supported independent candidate-change classes cleanly, and exactly
round-trips 57 of 59 executable built-ins through 16 accumulated exposures.

The remaining limitations are safety handling for serializer-expanded reused
code and statement identity/layout around reuse. More importantly, the matrix
found one wrong merge when changing an unrelated day. A wrong merge is a hard
stop: the prototype must not be described as ready for deployment.

This experiment concerns the core known-base merge engine. It does not infer a
base, identify built-ins, use similarity, or reopen the rejected autodetection
design recorded in draft PR #25.

## Architecture tested

The pinned official parser is the only Liftoscript syntax authority. Every
`ExerciseExpression` is projected into deterministic line-oriented records for
parser leaves and parser-defined gaps. Node paths distinguish exercise
variations, sets and set parts, weights, percentages, RPE, timers, labels,
properties, function names and arguments, reuse sections, supersets, and
week/day statement identity. Liftoscript and reused code bodies remain opaque
source atoms.

Atom values contain reversible source slices, not normalized syntax. Restoration
concatenates the selected original fragments; there is no Liftoscript serializer
or evaluator-derived program model. Stable atom end markers give ordinary
`git merge-file` enough separation to merge deletion of one function argument
beside progression of another.

When `candidate == base`, ordinary three-way semantics select the exact active
source directly after the live-code safety check. This avoids manufacturing
conflicts from serializer-only statement layout.

## Experiment A: accumulated real progression

The corpus contains 60 official built-ins from the pinned runtime. Fifty-nine
are normally executable. `gzcl-ggbb.md` remains the separately tracked upstream
`lifecycle-finish` failure involving the missing `successCounter` state.

Each exact serialized progressed source was fed into the next nominal exposure.
The merge used pristine source as both base and candidate and required exact
canonical equality with active.

| Exposure depth | Executable | Exact round-trip | Merge limitation |
|---:|---:|---:|---:|
| 1 | 59 | 58 | 1 |
| 4 | 59 | 57 | 2 |
| 8 | 59 | 57 | 2 |
| 16 | 59 | 57 | 2 |

`pzerofullbody.md` fails at exposure 1 because serialization expands reused code
bodies that the fail-closed live-code check currently treats as a live edit.
`shortcut-to-size.md` passes at exposure 1 and reaches the same safety limitation
before exposure 4. These are merge/safety limitations, not lifecycle failures.

## Experiment B: independent candidate changes

The initial matrix uses a genuinely progressed Starting Strength Phase 1 source
after one exposure. Every supported mutation has an explicit source predicate;
the harness does not equate `status: merged` with correctness.

| Mutation class | Outcome |
|---|---|
| Add an exercise | CLEAN MERGE |
| Remove an unchanged exercise | CLEAN MERGE |
| Change set/rep scheme beside live progression | CLEAN MERGE |
| Change progression logic beside live state | CLEAN MERGE |
| Add unrelated exercise property | CLEAN MERGE |
| Change unrelated day | **WRONG MERGE** |
| Change reusable definition | UNSUPPORTED TEST |

Totals: 5 clean merges, 0 expected conflicts, 0 spurious conflicts, 1 wrong
merge, and 1 unsupported test. The matrix is deliberately small and generic;
it is evidence about the representation, not a production conformance claim.

## Experiment C: progression-change inventory

At exposure 1, the harness compares parser-projected atoms from pristine
Liftosaur serialization with the progressed serialization. Counts include atoms
whose statement identity changed, so they describe projection pressure rather
than unique semantic edits.

| Parser-backed class | Differing projected atoms |
|---|---:|
| Sets, reps, and minimum reps | 3,009 |
| Timers | 2,446 |
| Other parser fragments | 1,621 |
| Weights | 1,395 |
| Percentages | 1,134 |
| Properties | 1,069 |
| RPE | 758 |
| Reuse representation | 659 |
| Progress/function arguments | 83 |

The inventory confirms that real progression is not confined to custom-state
arguments or `{ ... }` regions. Prescription fields dominate, while reuse
representation remains a material cross-cutting class.

## Complexity judgment

The parser-backed projection makes `frontend.mjs` conceptually simpler in one
important respect: it deletes the hand-written top-level slash scanner, custom
argument parser, and regex-based statement projector. It does not copy the
grammar, evaluate whole programs, or serialize Liftoscript.

The unresolved wrong merge and reuse safety cases show where the simplicity
limit currently lies. Fixing them is justified only if it remains a small change
to identity and opaque-body handling. If it requires definition inheritance,
program-specific rules, fuzzy matching, or a semantic reconstruction layer,
stop. Parser-backed reversible projection remains viable as a research
direction, but the measured prototype is not yet viable for production.

Reproduce all three experiments with:

```text
node test/evaluate-parser-merge.mjs
```
