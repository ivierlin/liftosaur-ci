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
