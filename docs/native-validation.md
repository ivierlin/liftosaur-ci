# Native validation

The generic validator checks runtime executability, not whether a program's
coaching decisions are correct. Each workout day is tested independently from
the reviewed input source with default Liftosaur settings and empty statistics.

## Nominal completion policy

For every non-suppressed work set, the validator records:

- prescribed repetitions, or the minimum when repetitions are open-ended, or
  one repetition when neither exists;
- the same repetitions on both sides for unilateral sets;
- prescribed weight when present;
- prescribed RPE, or RPE 8 only when the set requires an RPE log;
- prescribed set duration when present.

Warm-up sets are not progression evidence and are not completed. After each
work set, the validator runs Liftosaur's update script and follows any resulting
set additions or removals. A day fails closed after 1,000 dynamically generated
sets.

For each completed exercise, the validator directly checks finish-script
success before applying all finish-day changes. It then serializes the progressed
program, reloads it, checks evaluation again, and constructs the next workout.
Thrown errors and errors swallowed through Liftosaur's error logger both fail
validation.

## Boundary

Nominal inputs are deliberately generic. They do not model underperformance,
overperformance, user-prompted state, history-dependent statistics, or coaching
intent. Those require reviewed scenarios or program-specific assertions.

The pinned built-in `gzcl-ggbb.md` currently has one tracked upstream lifecycle
failure: an exercise overriding inherited `lp(...)` with `progress: none` still
runs the inherited finish script without its `successCounter` state. The corpus
requires that exact failure until the pinned upstream source/runtime is fixed;
all other built-ins must pass the full nominal lifecycle.

## Reviewed regression scenarios

The `snapshot` command accepts two scenario formats. Format 1 has `name`, `day`,
and `entries` for one exposure. Format 2 has `name` and between 2 and 100 named,
ordered `steps`; every step has its own `day` and `entries`. Each sequence step
receives the exact serialized program produced by the prior step while sharing
the same default settings and statistics context.

Each entry identifies the evaluated exercise `fullName` and supplies one object
per work set. `reps` is required. Repeated same-name exercises use `occurrence`
(default 1). Optional `weight`, `rpe`, `repsLeft`, and `setTime` values override
the prescription; omitted values retain the prescribed input. Sets requiring an
RPE or weight must receive one when the prescription has none.

The command fails if an exercise or set is missing or extra. Its immutable JSON
output binds the source and scenario checksums and records persistent progression
state, the next exposure, and the next scheduled workout. A sequence records
those semantic results after every step and binds the final serialized source.
Both raw `originalWeight` and rounded displayed `weight` remain in the semantic
snapshot.

The first reviewed fixtures use Liftosaur's Basic Beginner program with explicit
nominal, underperformance, and overperformance repetitions. Their snapshots are
behavior regressions only: the labels describe the supplied observations, not an
independent claim that the resulting progression is correct.

Sequence scenarios do not supply account history, custom settings, or body
statistics. Programs requiring those inputs need a future explicit scenario
contract rather than inferred test data.
