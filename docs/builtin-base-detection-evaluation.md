# Built-in detection: upstream history evaluation

## Conclusion

A simple normalized program-body detector looks sufficient **only as a
conservative accept-or-defer gate**. It is useful for exact and very close
historical matches, but nearest-candidate selection is unsafe and winner margin
does not eliminate every close-family false positive.

The evidence supports starting simple and accepting low recall. It does not
support choosing a production threshold yet.

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

The simple detector remains viable if its product contract is deliberately
narrow:

- exact matches and a small, empirically clean near-match zone may automate;
- everything else returns the closest candidate and immutable revision with
  manual base/ref instructions;
- close families must be represented in threshold tests, not treated as rare
  anomalies;
- normal merge conflicts continue through the existing conflict-workspace path.

Before choosing a threshold, the final metric and normalization should be fixed,
then evaluated against more upstream transitions and realistic held-out user
modifications. The decisive evidence is zero observed false positives in the
acceptance zone, especially across close families, with stability under small
normalization changes. Recall is secondary.

If no useful zero-false-positive zone survives that validation, the feature
should defer more often or remain manual rather than grow into a sophisticated
classifier.
