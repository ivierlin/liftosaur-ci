import { loadLiftosaurRuntime, pinnedRuntimeRevision } from "./runtime.mjs";
import { LiftosaurValidationError } from "./validate-core.mjs";

function formatLoggedValue(value) {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function withoutLoggedErrors(stage, operation) {
  const logged = [];
  const previous = console.error;
  console.error = (...values) => logged.push(values.map(formatLoggedValue).join(" "));
  try {
    const result = operation();
    if (logged.length > 0) {
      throw new LiftosaurValidationError(
        `Liftosaur logged ${logged.length} swallowed error${logged.length === 1 ? "" : "s"}`,
        stage,
        logged.map((message) => ({ message }))
      );
    }
    return result;
  } finally {
    console.error = previous;
  }
}

function loadApi() {
  const runtime = loadLiftosaurRuntime();
  const {
    Program_create,
    Program_evaluate,
    Program_getProgramExerciseForKeyAndDay,
    Program_nextHistoryRecord,
  } = runtime.require("src/models/program.ts");
  const { Progress_runUpdateScript } = runtime.require("src/models/progress.ts");
  const { Settings_build } = runtime.require("src/models/settings.ts");
  const { Stats_getEmpty } = runtime.require("src/models/stats.ts");
  const { PlannerProgramExercise_getState } = runtime.require(
    "src/pages/planner/models/plannerProgramExercise.ts"
  );
  const { PlannerProgram_evaluateText } = runtime.require(
    "src/pages/planner/models/plannerProgram.ts"
  );
  return {
    Program_create,
    Program_evaluate,
    Program_getProgramExerciseForKeyAndDay,
    Program_nextHistoryRecord,
    Progress_runUpdateScript,
    Settings_build,
    Stats_getEmpty,
    PlannerProgramExercise_getState,
    PlannerProgram_evaluateText,
  };
}

function stableSet(set) {
  return {
    index: set.index,
    reps: set.reps,
    originalWeight: set.originalWeight,
    weight: set.weight,
    minReps: set.minReps,
    rpe: set.rpe,
    logRpe: set.logRpe,
    isAmrap: set.isAmrap,
    label: set.label,
    timer: set.timer,
    setTimer: set.setTimer,
    isOverflowSetTimer: set.isOverflowSetTimer,
    auto: set.auto,
    askWeight: set.askWeight,
    isUnilateral: set.isUnilateral,
    programSetIndex: set.programSetIndex,
    completedReps: set.completedReps,
    completedRepsLeft: set.completedRepsLeft,
    completedWeight: set.completedWeight,
    completedRpe: set.completedRpe,
    completedSetTimer: set.completedSetTimer,
    isCompleted: set.isCompleted,
  };
}

function stableEntry(entry) {
  return {
    exercise: {
      id: entry.exercise.id,
      equipment: entry.exercise.equipment,
    },
    index: entry.index,
    sets: entry.sets.map(stableSet),
    warmupSets: entry.warmupSets.map(stableSet),
    state: entry.state,
    vars: entry.vars,
    notes: entry.notes,
    isSuppressed: entry.isSuppressed,
    superset: entry.superset,
    updatePrints: entry.updatePrints,
    descriptionSnapshot: entry.descriptionSnapshot,
    progressSnapshot: entry.progressSnapshot,
  };
}

function stableBehaviorRecord(record, evaluated, api) {
  return {
    day: record.day,
    week: record.week,
    dayInWeek: record.dayInWeek,
    dayName: record.dayName,
    entries: record.entries.map((entry) => {
      const exercise = entry.programExerciseId
        ? api.Program_getProgramExerciseForKeyAndDay(
          evaluated,
          record.day,
          entry.programExerciseId
        )
        : undefined;
      return {
        fullName: exercise?.fullName,
        progressState: exercise
          ? api.PlannerProgramExercise_getState(exercise)
          : undefined,
        ...stableEntry(entry),
      };
    }),
  };
}

function programFromSource(source, api) {
  return {
    ...api.Program_create("Validation Program"),
    planner: {
      vtype: "planner",
      name: "Validation Program",
      weeks: api.PlannerProgram_evaluateText(source),
    },
  };
}

function completeReviewedSet(set, input, exerciseName, setIndex, label) {
  if (!input || !Number.isInteger(input.reps) || input.reps < 0) {
    throw new LiftosaurValidationError(
      `${label} requires non-negative integer reps for ${exerciseName} set ${setIndex + 1}`,
      "scenario"
    );
  }
  if (input.rpe != null && (typeof input.rpe !== "number" || input.rpe < 0 || input.rpe > 10)) {
    throw new LiftosaurValidationError(
      `${label} RPE must be between 0 and 10 for ${exerciseName} set ${setIndex + 1}`,
      "scenario"
    );
  }
  if (set.logRpe && set.rpe == null && input.rpe == null) {
    throw new LiftosaurValidationError(
      `${label} must provide RPE for ${exerciseName} set ${setIndex + 1}`,
      "scenario"
    );
  }
  if (set.weight == null && input.weight == null) {
    throw new LiftosaurValidationError(
      `${label} must provide weight for ${exerciseName} set ${setIndex + 1}`,
      "scenario"
    );
  }

  set.completedReps = input.reps;
  if (set.isUnilateral) set.completedRepsLeft = input.repsLeft ?? input.reps;
  set.completedWeight = input.weight ?? set.weight;
  set.completedRpe = input.rpe ?? set.rpe;
  set.completedSetTimer = input.setTime ?? set.setTimer;
  set.isCompleted = true;
}

function scenarioEntries(scenario) {
  if (typeof scenario.name !== "string" || scenario.name.trim().length === 0) {
    throw new LiftosaurValidationError("Scenario must have a name", "scenario");
  }
  if (!Number.isInteger(scenario.day) || scenario.day < 1) {
    throw new LiftosaurValidationError("Scenario day must be a positive integer", "scenario");
  }
  if (!Array.isArray(scenario.entries) || scenario.entries.length === 0) {
    throw new LiftosaurValidationError("Scenario must provide completed entries", "scenario");
  }

  const entries = new Map();
  for (const entry of scenario.entries) {
    if (
      !entry
      || typeof entry.exercise !== "string"
      || !Array.isArray(entry.sets)
      || entry.sets.length === 0
    ) {
      throw new LiftosaurValidationError("Scenario entries require exercise and sets", "scenario");
    }
    const occurrence = entry.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1) {
      throw new LiftosaurValidationError(
        `Scenario occurrence must be a positive integer for ${entry.exercise}`,
        "scenario"
      );
    }
    const key = JSON.stringify([entry.exercise, occurrence]);
    if (entries.has(key)) {
      throw new LiftosaurValidationError(
        `Scenario has duplicate exercise occurrence: ${entry.exercise} #${occurrence}`,
        "scenario"
      );
    }
    entries.set(key, { ...entry, occurrence });
  }
  return entries;
}

export function snapshotPartialLiftosaurScenario(source, scenario) {
  const api = loadApi();
  const requested = scenarioEntries(scenario);
  const program = programFromSource(source, api);
  const settings = api.Settings_build();
  if (scenario.units != null) settings.units = scenario.units;
  const stats = api.Stats_getEmpty();
  const evaluated = withoutLoggedErrors("scenario-evaluate", () => (
    api.Program_evaluate(program, settings)
  ));
  if (scenario.day > evaluated.weeks.flatMap((week) => week.days).length) {
    throw new LiftosaurValidationError(
      `Scenario day ${scenario.day} exceeds the program's available days`,
      "scenario"
    );
  }

  let record = withoutLoggedErrors("scenario-construct", () => (
    api.Program_nextHistoryRecord(program, settings, stats, scenario.day)
  ));
  const seenOccurrences = new Map();
  const used = new Set();

  for (let entryIndex = 0; entryIndex < record.entries.length; entryIndex += 1) {
    const entry = record.entries[entryIndex];
    if (entry.isSuppressed || !entry.programExerciseId) continue;
    const exercise = api.Program_getProgramExerciseForKeyAndDay(
      evaluated,
      scenario.day,
      entry.programExerciseId
    );
    if (!exercise) continue;
    const occurrence = (seenOccurrences.get(exercise.fullName) ?? 0) + 1;
    seenOccurrences.set(exercise.fullName, occurrence);
    const key = JSON.stringify([exercise.fullName, occurrence]);
    const definition = requested.get(key);
    if (!definition) continue;
    used.add(key);

    for (let setIndex = 0; setIndex < definition.sets.length; setIndex += 1) {
      const current = record.entries[entryIndex];
      const set = current?.sets[setIndex];
      if (!set) {
        throw new LiftosaurValidationError(
          `Scenario set count exceeds the progressed workout for ${exercise.fullName} #${occurrence}`,
          "scenario"
        );
      }
      completeReviewedSet(set, definition.sets[setIndex], exercise.fullName, setIndex, "Scenario");
      record = withoutLoggedErrors("scenario-update", () => api.Progress_runUpdateScript(
        record,
        exercise,
        evaluated.states,
        entryIndex,
        setIndex,
        "workout",
        settings,
        stats
      ));
    }
  }

  for (const [key, definition] of requested) {
    if (!used.has(key)) {
      throw new LiftosaurValidationError(
        `Scenario exercise was not found: ${definition.exercise} #${definition.occurrence}`,
        "scenario"
      );
    }
  }

  return {
    snapshot: {
      runtimeRevision: pinnedRuntimeRevision,
      scenario: {
        name: scenario.name,
        day: scenario.day,
        finish: false,
        ...(scenario.units == null ? {} : { units: scenario.units }),
      },
      currentWorkout: stableBehaviorRecord(record, evaluated, api),
    },
    serializedSource: null,
  };
}
