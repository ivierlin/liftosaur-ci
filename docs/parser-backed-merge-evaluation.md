# Parser-backed generic merge evaluation

## Corrected conclusion

The parser-backed frontend remains a useful research direction, but the
corrected experiment gives materially weaker evidence than the first pass. It
is not production-ready and this PR remains a draft.

The earlier 58/59 and 57/59 round-trip numbers were misleading: identical base
and candidate sources triggered the production optimization that returned the
active source without invoking the parser-backed projection. The corrected
harness uses a test-only entry point that disables that optimization while
leaving production behavior unchanged.

The genuine parser path round-trips 47/59 executable built-ins at every measured
depth. Six fail closed at candidate-layout identity and six are rejected by the
strict live-code check. That is evidence of a substantially larger
representation problem, not a small two-program reuse edge case. No semantic
reconstruction was attempted.

## Architecture tested

The pinned Liftosaur parser remains the only syntax authority. Parser leaves and
parser-defined gaps become reversible source atoms; opaque Liftoscript and reuse
bodies remain source atoms. Restoration concatenates selected original slices.
There is no copied grammar, custom serializer, evaluator-derived model, fuzzy
matching, or program-family rule.

Production still uses the unchanged-candidate shortcut after the safety check.
Only `mergeLiftosaurSourcesThroughProjectionForTesting()` bypasses it.

## Experiment A: accumulated real progression through projection

The corpus contains 60 official built-ins from the pinned runtime. The known
`gzcl-ggbb.md` `lifecycle-finish` failure is tracked separately, leaving 59
normally executable programs. Each exact serialized result feeds the next
exposure. At 1, 4, 8, and 16 exposures, success requires a merged result from a
non-empty parser projection and exact canonical equality with active.

| Exposure depth | Executable | Exact parser-path round-trip | Failed closed |
|---:|---:|---:|---:|
| 1 | 59 | 47 | 12 |
| 4 | 59 | 47 | 12 |
| 8 | 59 | 47 | 12 |
| 16 | 59 | 47 | 12 |

Candidate-layout conflicts at every depth: `bullmastiff.md`,
`calgary-barbell-16-week.md`, `gzcl-general-gainz-burrito-but-big.md`,
`gzcl-general-gainz-riptide.md`, `gzcl-jacked-and-tan-2.md`, and
`tsa-9-week-intermediate.md`.

Strict live-code safety rejects `easy-strength.md`, `gzcl-uhf-5-weeks.md`,
`gzcl-uhf-9-weeks.md`, `phat.md`, `pzerofullbody.md`, and
`shortcut-to-size.md`. Serializer-expanded reuse is not excused or normalized;
these remain unsupported/safety-limited reuse cases.

## Experiment B: independent candidate changes

The active input is the exact Starting Strength Phase 1 serialization after one
nominal exposure. For every clean classification, parser-derived evidence
checks candidate-only atoms (or the intended statement deletion) and active-only
progression atoms independently.

| Mutation | Outcome | Candidate evidence | Active evidence |
|---|---|---:|---:|
| Add an exercise | CLEAN MERGE | 8/8 atoms | 5/5 atoms |
| Remove an unchanged exercise | CLEAN MERGE | statement absent | 5/5 atoms |
| Change set/rep scheme beside progression | CLEAN MERGE | 1/1 atom | 5/5 atoms |
| Change progression logic beside state | CLEAN MERGE | 1/1 atom | 5/5 atoms |
| Add unrelated exercise property | CLEAN MERGE | 6/6 atoms | 5/5 atoms |
| Change unrelated day | CLEAN MERGE | 1/1 atom | 5/5 atoms |
| Change reusable definition | UNSUPPORTED | not claimed | not claimed |

The corrected matrix has six clean merges, zero spurious conflicts, zero wrong
merges, and one unsupported class. The previous unrelated-day wrong merge was a
weak-oracle result; the corrected case verifies both sides. Reuse is not counted
clean without a safe generic progressed case.

## Experiment C: deliberate true conflicts

Compact generic cases change the same parser atom differently on active and
candidate. All four fail closed as expected: reps, weight, a timer property
argument, and a progression-function argument. Result: 4 expected conflicts,
0 wrong merges.

## Experiment D: strict live-code safety

The check now compares the sorted body arrays exactly, preserving multiplicity.
It rejects deletion, addition, modification, and multiplicity changes in
`{ ... }` / `{~ ... ~}` bodies. Result: 4 expected safety rejections, 0
accepted live-code changes. This deliberately reduces corpus coverage rather
than weakening the invariant.

## Judgment

The frontend is conceptually simpler than the removed hand-written syntax
scanner, but the corrected 47/59 result shows that the remaining work is no
longer plausibly a tiny reuse-only adjustment. Six identity/layout failures and
six strict-safety reuse failures would invite semantic reconstruction if pursued
indiscriminately. Stop here: retain this as characterization evidence and do not
expand production scope.

Reproduce the experiments with:

```text
node test/evaluate-parser-merge.mjs
```
