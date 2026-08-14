# Built-in detection: upstream history evaluation

## Conclusion

None of the evaluated mechanisms is suitable for deciding an automatic base.
Textual nearest-candidate selection is unsafe, the current initialization
projection is not invariant to real serialized progression, and the final
parser-derived structural experiment crossed the maintenance limit without
achieving complete invariance and edit sensitivity.

Built-in autodetection should be dropped in favor of manual bootstrap. This is
not a production behavior change: no detector was implemented. Similarity may
provide an informational closest-match hint only.

## Accumulated live progression

### Dataset and method

- Official upstream: the pinned Liftosaur runtime at
  `f9c1b1453aaa22ab177d8e7473da08d707c28b60`.
- Corpus: all 60 official Markdown built-ins in `programs/builtin`; no community
  programs or separate registry.
- Lifecycle: the existing native nominal completed-workout path ran Liftosaur's
  real evaluate, construct, update, finish-day, serialize, reload, and
  next-workout operations.
- Accumulation: each exact serialized progressed source was the input to the
  next exposure. Days advanced cyclically through the program.
- Depths: 1, 4, 8, and 16 completed workout exposures.
- Comparison: at each depth,
  `projectLiftosaurSourceForInitialization(progressedSource)` was compared
  byte-for-byte with the projection of the pristine built-in source.
- Control: the same comparison was made against Liftosaur's pristine serialized
  source to separate initial serializer rewrites from progression rewrites.
- Reproduction: run `node test/evaluate-builtin-progression-projection.mjs`
  with `LIFTOSAUR_RUNTIME` pointing at the pinned runtime checkout.

### Coverage and results

| Depth | Executable | Exact pristine match | Projection mismatch |
|---:|---:|---:|---:|
| 1 | 59 | 7 | 52 |
| 4 | 59 | 7 | 52 |
| 8 | 59 | 7 | 52 |
| 16 | 59 | 7 | 52 |

The seven exact matches at every depth were `arnoldgoldensix.md`, `gzcl-vdip.md`,
`metallicadpappl.md`, `mike-mentzer-consolidated.md`, `ss1.md`, `ss2.md`, and
`ss3.md`. Results did not degrade with depth: every program that matched at one
exposure still matched at 16, and every mismatch was already present at the
first exposure.

The 52 mismatches were `arnold-split.md`,
`barbell-medicine-the-bridge.md`, `basicBeginner.md`, `bro-split.md`,
`bullmastiff.md`, `calgary-barbell-16-week.md`, `coolcicada-ppl.md`,
`cube-method.md`, `dbPpl.md`, `deep-water.md`, `doggcrapp.md`,
`doug-hepburn-method.md`, `easy-strength.md`, `fierce-5.md`,
`german-volume-training.md`, `gzcl-general-gainz-burrito-but-big.md`,
`gzcl-general-gainz-riptide.md`, `gzcl-general-gainz.md`,
`gzcl-jacked-and-tan-2.md`, `gzcl-the-rippler.md`,
`gzcl-uhf-5-weeks.md`, `gzcl-uhf-9-weeks.md`, `gzclp-blacknoir.md`,
`gzclp.md`, `ice-cream-fitness-5x5.md`, `ivysaur-4-4-8.md`,
`jay-cutler-split.md`, `juggernaut-method.md`, `lylegenericbulking.md`,
`madcow.md`, `mike-mentzer-heavy-duty.md`, `monolith531.md`, `nsuns.md`,
`phat.md`, `phrakgreyskull.md`, `phul.md`,
`planet-fitness-hypertrophy.md`, `pzerofullbody.md`,
`recommended-routine.md`, `sheiko-29-32.md`, `shortcut-to-size.md`,
`smolov-jr.md`, `smolov-squat.md`, `strongcurves.md`,
`tactical-barbell-mass-protocol.md`, `tactical-barbell-operator.md`,
`texasmethod.md`, `the5314b.md`, `the531bbb.md`,
`tsa-9-week-intermediate.md`, `westside-conjugate-method.md`, and
`westside-for-skinny-bastards.md`.

### Failure classification

The mismatches are projection limitations, not evidence that these users edited
program structure. Observed first differences included:

- a different number or placement of projected exercise-set placeholders after
  Liftosaur advanced the current prescription;
- serializer expansion or movement of reusable `...exercise` forms;
- movement or omission of comments attached to selected exercises;
- multiline versus single-line rendering of otherwise equivalent exercise
  definitions.

The pristine serialization control matched the pristine built-in projection for
38 of 59 programs and mismatched for 21 before any workout. Comparing progressed
sources with that serialized baseline still matched only 8 of 59 at every
depth. This shows both serializer representation and live-prescription shape are
outside the current projection's equivalence boundary.

One program, `gzcl-ggbb.md`, was not executable at any depth. Its nominal day 1
finish script references the missing `successCounter` state variable for
`t3a: Ab Wheel, Bodyweight`. This is the already tracked upstream Liftosaur
`lifecycle-finish` failure, not a detector or projection mismatch, and it was
kept visible rather than excluded from the corpus.

### Judgment

The current exact projection is not sufficient to bootstrap a long-running but
structurally unmodified built-in automatically: observed coverage is 7/60 of the
full corpus, or 7/59 of the executable corpus. The stable results through 16
exposures are encouraging for the programs already inside its equivalence
boundary, but do not rescue the 52 immediate false negatives.

The parser-derived follow-up below tested the remaining direction. It did not
meet those requirements and closes the production-autodetection investigation.

## Parser-derived structural identity

### Method and complexity

The final experiment used the same pinned Liftosaur runtime and parser-backed
evaluator as validation. The test-only fingerprint emitted deterministic JSON
records for weeks, days, exercises and alternatives, labels, tags, supersets,
and progression/update types and scripts. It omitted live set prescriptions,
warmups, timers, current markers, progress state values, comments, and
serializer-only repeat metadata. Liftosaur's evaluated exercise model supplied
the first semantic normalization of reusable `...exercise` forms. No program
names, family rules, similarity thresholds, or heuristic weights were used.

The implementation is one exploratory file and does not call or change
`projectLiftosaurSourceForInitialization()`. Reproduce it with
`node test/evaluate-builtin-structural-identity.mjs` after setting up the pinned
runtime. Its apparent compactness depends on Liftosaur's evaluator. The model
drops unused reusable definitions and does not preserve a stable resolved
identity for every reuse after live serialization. Fixing those gaps would
require a second parser-level definition table, inheritance resolution, and
special handling for serializer-expanded aliases. That is substantial semantic
reconstruction rather than a small fingerprint.

### Current corpus and accumulated progression

All 60 current official built-ins were fingerprinted. Fifty-nine were
executable; `gzcl-ggbb.md` retained the same upstream lifecycle failure recorded
above. All 59 executable sources matched their pristine Liftosaur serialization.

| Depth | Executable | Exact structural match | Mismatch |
|---:|---:|---:|---:|
| 1 | 59 | 51 | 8 |
| 4 | 59 | 50 | 9 |
| 8 | 59 | 50 | 9 |
| 16 | 59 | 50 | 9 |

The nine depth-16 mismatches were `bullmastiff.md`,
`gzcl-general-gainz-burrito-but-big.md`, `gzcl-general-gainz-riptide.md`,
`gzcl-jacked-and-tan-2.md`, `gzcl-the-rippler.md`,
`recommended-routine.md`, `shortcut-to-size.md`,
`tactical-barbell-mass-protocol.md`, and
`tactical-barbell-operator.md`. First differences were exercise identities that
switched between a resolved exercise and a reusable label after serialization.
`recommended-routine.md` first diverged between exposures 1 and 4; the other
eight diverged at exposure 1.

There were no exact fingerprint collisions among the 60 current built-ins.

### Historical uniqueness

The practical history scan examined 196 bodies across 61 modern built-in paths.
One old body did not parse with the pinned runtime. After deduplicating unchanged
fingerprints within each path, 82 structural revisions remained. The only
cross-path exact collision was the same Westside for Skinny Bastards body before
and after its `ws4sb.md` to `westside-for-skinny-bastards.md` rename. No
materially distinct historical programs or revisions collided.

This is useful uniqueness evidence, but it cannot compensate for false
negatives under ordinary progression or a fingerprint that ignores an
author-owned definition edit.

### Structural-edit sensitivity

| Generic author edit | Fingerprint changed |
|---|---:|
| Exercise substitution | Yes |
| Day/scheme name change | Yes |
| Progress logic change | Yes |
| Reusable-definition prescription change | **No** |
| Author-owned superset property change | Yes |

The reusable-definition failure is a false negative: the evaluated model omits
an unused definition even though later reuse or author maintenance can make that
definition part of program identity. Retaining definitions while also treating
expanded and inherited serialized forms as identical is the semantic
reconstruction described above.

### Provenance check

The pinned Liftosaur storage model does not retain an authoritative built-in
origin after cloning. `Program_cloneProgram()` copies the program, replaces its
ID with a new random ID, and records only `clonedAt`; there is no original
built-in ID or origin field. The stored planner text and program API model
therefore do not provide trustworthy provenance on which to base detection.

### Final judgment

The structural representation is much better than textual projection, but it
is not empirically strong enough for automatic identity: 9 of 59 executable
built-ins are false negatives after normal progression, and the compact version
misses a deliberate reusable-definition edit. Addressing both problems requires
definition/reuse semantic reconstruction and serializer exceptions, crossing
the experiment's hard-stop criterion.

Do not implement production autodetection. Manual bootstrap is the durable
design; the exploratory evaluator remains only to make this conclusion
reproducible.

## Dataset and method

- Official upstream: `astashov/liftosaur` at
  `1a28522fd6eefcd45dd7e28cbac785100534481a` (2026-08-12).
- Current corpus: 60 official built-ins and all 1,770 unordered pairs.
- Historical corpus: 56 commits touching the modern `programs/builtin`
  directory. After excluding additions, documentation-only changes, and
  duplicate merge representations, 27 unique program-body transitions remained.
- Body extraction: the single fenced `liftoscript` block in each built-in
  Markdown file.
- Normalization: LF line endings, trimmed and collapsed whitespace, blank lines
  removed, and full-line `//` comments removed.
- Exploratory distance: `1 - SequenceMatcher ratio` over normalized lines;
  lower is closer. This is a lightweight textual proxy, not a proposed final
  metric.
- Time travel: for each later changed body, rank it against every built-in body
  present in the parent revision. The same earlier path is treated as the known
  lineage.

The modern Markdown history begins in February 2026. A much older
`lambda/programs.json` snapshot exists, but it stores pre-Liftoscript structured
program data and is not directly comparable with the normalized Liftoscript
experiment.

## Current built-ins

The nearest current pair was Starting Strength Phase 1 / Phase 2 at distance
`0.1111`. The next closest pairs were much farther apart:

| Pair | Distance |
|---|---:|
| Starting Strength Phase 1 / Phase 2 | 0.1111 |
| Tactical Barbell Mass / Operator | 0.3451 |
| Basic Beginner / Phrak's Greyskull | 0.3636 |
| GZCLP / GZCLP Blacknoir | 0.4545 |
| Smolov Jr / 5/3/1 BBB | 0.5000 |
| GZCL UHF 5-week / 9-week | 0.5613 |
| 5/3/1 Beginners / BBB | 0.5946 |

This supports the hypothesis that most current programs are textually distinct,
while known families supply the hard negatives. The surprising Smolov Jr /
5/3/1 BBB neighbor also cautions against treating methodology labels or filenames
as the similarity model.

## Historical time travel

The same-path ancestor ranked first in 23 of 27 unique substantive transitions.
The median true-ancestor distance among recovered cases was `0.2500`, but broad
rewrites reached much farther. Four transitions were misleading:

| Later program | True ancestor distance/rank | Wrong winner | Winner distance | Margin |
|---|---:|---|---:|---:|
| Basic Beginner | 0.8000 / 3 | Phrak's Greyskull | 0.6585 | 0.1015 |
| Metallicadpa PPL | 0.9756 / 17 | Starting Strength Phase 1 | 0.9600 | 0.0000 |
| Starting Strength Phase 2 | 0.5556 / 2 | Starting Strength Phase 1 | 0.1111 | 0.4444 |
| Phrak's Greyskull | 0.6585 / 2 | Basic Beginner | 0.3636 | 0.2949 |

The Starting Strength result is the critical counterexample: the wrong winner
was both absolutely close and separated by a large margin. An absolute threshold
plus winner margin would still accept it at thresholds above `0.1111`.

As a sensitivity check on these 27 transitions:

| Maximum winner distance | Accepted | Correct | False |
|---:|---:|---:|---:|
| 0.05 | 5 | 5 | 0 |
| 0.08 | 6 | 6 | 0 |
| 0.10 | 8 | 8 | 0 |
| 0.12 | 10 | 9 | 1 |
| 0.30 | 17 | 16 | 1 |

Adding margin requirements up to `0.30` did not remove the Starting Strength
false positive. These figures describe this sample and metric only; they are not
production thresholds.

## Review judgment

This historical experiment rules out similarity as an automatic decision
mechanism:

- similarity may return the closest candidate and immutable revision as an
  informational hint with manual base/ref instructions;
- even apparently clean near-match zones are sample-dependent and cannot prove
  identity;
- close families remain important negative cases for any later exact structural
  representation;
- normal merge conflicts continue through the existing conflict-workspace path.

The next experiment therefore tests exact projected identity under accumulated
real progression. It does not choose or tune a similarity threshold.
