# Native Liftosaur validation

Use native validation to answer a narrow question: does this source execute and
behave as reviewed in the pinned Liftosaur runtime? It validates compatibility
and scenarios; it does not prove that a training design is correct.

## What the validator does

The validator runs generated programs against a pinned Liftosaur checkout
instead of maintaining a second parser or evaluator. The report records the
runtime revision, so a behavior change can be tied to a concrete upstream
implementation.

It evaluates the source, constructs every day, serializes the evaluated planner
back to Liftoscript, reloads it, compares the resulting prescriptions, and then
exercises the real workout lifecycle. Validation therefore covers source
compatibility and behavior that appears only after an update or finish script.

## What the built-in corpus covers

The built-in corpus is broader than the small smoke corpus. It extracts every
Liftoscript block from Liftosaur's built-in program Markdown and validates each
source with the same runtime used for external programs.

During the same nominal lifecycle pass, it compares one reviewed snapshot per
built-in. The snapshot records each day's next exposure using exercise names,
progression state, and compact work-set prescriptions. It does not repeat
lifecycle execution or include warm-ups and internal workout metadata.

This does not claim that every built-in program's coaching behavior is correct.
The corpus establishes that the source remains executable through the current
Liftosaur lifecycle and provides a stable base for reviewed behavioral
scenarios.

## Reviewed regression scenarios

The `snapshot` command accepts complete exposures and partial observations.
A complete single exposure has `name`, `day`, and `entries`. A complete sequence
has `name` and between 2 and 100 named, ordered `steps`; every step has its own
`day` and `entries`. Each sequence step receives the exact serialized program
produced by the prior step while sharing the same settings and statistics context.

A scenario may set top-level `units` to `kg` or `lb` when the observed behavior
depends on Liftosaur's active weight-unit setting. If omitted, Liftosaur's normal
default settings are used. This is execution context rather than a conversion
performed by `liftosaur-ci`; equipment fitting and mixed-unit arithmetic remain
entirely Liftosaur behavior. Sequence scenarios use the same unit context for all
steps.

Each entry identifies the evaluated exercise `fullName` and supplies one object
per work set. `reps` is required for completed sets. Repeated same-name exercises
use `occurrence` (default 1). Optional `weight`, `rpe`, `repsLeft`, and `setTime`
values override the prescription; omitted values retain the prescribed input.
Sets requiring an RPE or weight must receive one when the prescription has none.
A prescribed set that exists but is not performed may instead be declared as
`{ "skip": true }`; skipped sets stay uncompleted and do not receive a
post-completion update.

Complete exposures fail if an exercise or set is missing or extra. Their
immutable JSON output binds the source and scenario checksums and records
persistent progression state, the next exposure, and the next scheduled workout.
A sequence records those semantic results after every step and binds the final
serialized source. Both raw `originalWeight` and rounded displayed `weight`
remain in the semantic snapshot.

### Partial observation

Set `"finish": false` on a standalone scenario to stop after exactly the supplied
work sets and observe the workout at that point. Partial observations may name
only the exercises being performed; unrelated entries remain untouched. After
each supplied set, Liftosaur's real update script runs, so `currentWorkout`
captures dynamic set additions or removals, timer changes, drop-set loads,
completed-set fields, prompts, state, descriptions, and other observable workout
behavior. Top-level `units` applies to partial observations in the same way as to
complete exposures.

A partial observation does not run exercise finish scripts or finish-day logic,
does not serialize or reload the program, and does not produce `nextExposure`,
`nextWorkout`, or `progressedSource`. Unfinished observations cannot appear in a
scenario sequence and cannot be resumed. Those constraints are intentional: the
feature is an observation point, not a workout scripting language.

The first reviewed fixtures use Liftosaur's Basic Beginner program with explicit
nominal, underperformance, and overperformance repetitions. Their snapshots are
behavior regressions only: the labels describe the supplied observations, not an
independent claim that the resulting progression is correct.

Sequence scenarios do not supply account history, arbitrary custom settings, or
body statistics. Programs requiring those inputs need a future explicit scenario
contract rather than inferred test data.
