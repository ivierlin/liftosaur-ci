import { isDeepStrictEqual } from "node:util";

import { loadLiftosaurRuntime, pinnedRuntimeRevision } from "./runtime.mjs";

export const LIFTOSAUR_VALIDATOR = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-native-v1",
  runtimeRevision: pinnedRuntimeRevision,
});

export const LIFTOSAUR_SCENARIO_SNAPSHOT = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-scenario-v1",
  runtimeRevision: pinnedRuntimeRevision,
});

export const LIFTOSAUR_SCENARIO_SEQUENCE_SNAPSHOT = Object.freeze({
  formatVersion: 2,
  implementation: "liftosaur-scenario-sequence-v1",
  runtimeRevision: pinnedRuntimeRevision,
});

export class LiftosaurValidationError extends Error {
  constructor(message, stage, details = []) {
    super(message);
    this.stage = stage;
    this.details = details;
  }
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

function stableRecord(record) {
  return {
    day: record.day,
    week: record.week,
    dayInWeek: record.dayInWeek,
    dayName: record.dayName,
    entries: record.entries.map(stableEntry),
  };
}

function stableBehaviorRecord(record, evaluated, api) {
  return {
    ...stableRecord(record),
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

function evaluationErrors(evaluated) {
  return evaluated.errors.map(({ error, dayData }) => ({
    day: dayData.day,
    week: dayData.week,
    dayInWeek: dayData.dayInWeek,
    message: error instanceof Error ? error.message : String(error),
  }));
}

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
    Program_numberOfDays,
    Program_runAllFinishDayScripts,
    Program_runFinishDayScript,
  } = runtime.require("src/models/program.ts");
  const {
    Progress_getDayData,
    Progress_runUpdateScript,
  } = runtime.require("src/models/progress.ts");
  const { Settings_build } = runtime.require("src/models/settings.ts");
  const { Stats_getEmpty } = runtime.require("src/models/stats.ts");
  const { PlannerProgramExercise_getState } = runtime.require(
    "src/pages/planner/models/plannerProgramExercise.ts"
  );
  const {
    PlannerProgram_evaluateText,
    PlannerProgram_generateFullText,
  } = runtime.require(
    "src/pages/planner/models/plannerProgram.ts"
  );
  return {
    Program_create,
    Program_evaluate,
    Program_getProgramExerciseForKeyAndDay,
    Program_nextHistoryRecord,
    Program_numberOfDays,
    Program_runAllFinishDayScripts,
    Program_runFinishDayScript,
    Progress_getDayData,
    Progress_runUpdateScript,
    Settings_build,
    Stats_getEmpty,
    PlannerProgramExercise_getState,
    PlannerProgram_evaluateText,
    PlannerProgram_generateFullText,
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

function evaluateSource(source, api) {
  const program = programFromSource(source, api);
  const settings = api.Settings_build();
  const evaluated = withoutLoggedErrors("evaluate", () => api.Program_evaluate(program, settings));
  const errors = evaluationErrors(evaluated);
  if (errors.length > 0) {
    throw new LiftosaurValidationError(
      `Liftosaur evaluation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}`,
      "evaluate",
      errors
    );
  }

  const days = api.Program_numberOfDays(evaluated);
  const records = Array.from({ length: days }, (_, index) => stableRecord(
    withoutLoggedErrors("construct", () => api.Program_nextHistoryRecord(
      program,
      settings,
      api.Stats_getEmpty(),
      index + 1
    ))
  ));
  return { program, days, records };
}

function completeNominalSet({ set }) {
  const completedReps = set.reps ?? set.minReps ?? 1;
  set.completedReps = completedReps;
  if (set.isUnilateral) set.completedRepsLeft = completedReps;
  set.completedWeight = set.weight;
  set.completedRpe = set.rpe ?? (set.logRpe ? 8 : undefined);
  set.completedSetTimer = set.setTimer;
  set.isCompleted = true;
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

function completeDay(source, day, api, completeSet, context = {}) {
  const program = programFromSource(source, api);
  const settings = context.settings ?? api.Settings_build();
  const stats = context.stats ?? api.Stats_getEmpty();
  const evaluated = withoutLoggedErrors("lifecycle-evaluate", () => (
    api.Program_evaluate(program, settings)
  ));
  const errors = evaluationErrors(evaluated);
  if (errors.length > 0) {
    throw new LiftosaurValidationError(
      `Liftosaur lifecycle evaluation failed for day ${day}`,
      "lifecycle-evaluate",
      errors
    );
  }

  let record = withoutLoggedErrors("lifecycle-construct", () => (
    api.Program_nextHistoryRecord(program, settings, stats, day)
  ));
  let completedSets = 0;
  for (let entryIndex = 0; entryIndex < record.entries.length; entryIndex += 1) {
    let setIndex = 0;
    while (
      !record.entries[entryIndex]?.isSuppressed
      && setIndex < record.entries[entryIndex].sets.length
    ) {
      if (completedSets >= 1000) {
        throw new LiftosaurValidationError(
          `Nominal completion exceeded 1000 dynamically generated sets on day ${day}`,
          "lifecycle-update",
          [{ day }]
        );
      }
      const entry = record.entries[entryIndex];
      const set = entry.sets[setIndex];
      const exercise = entry.programExerciseId
        ? api.Program_getProgramExerciseForKeyAndDay(evaluated, day, entry.programExerciseId)
        : undefined;
      if (!exercise) {
        throw new LiftosaurValidationError(
          `Could not resolve exercise ${entry.programExerciseId ?? entryIndex + 1} on day ${day}`,
          "lifecycle-update",
          [{ day, entry: entryIndex + 1 }]
        );
      }
      if (!set.isCompleted) {
        completeSet({ set, entry, exercise, entryIndex, setIndex });
        completedSets += 1;
      }
      record = withoutLoggedErrors("lifecycle-update", () => api.Progress_runUpdateScript(
        record,
        exercise,
        evaluated.states,
        entryIndex,
        setIndex,
        "workout",
        settings,
        stats
      ));
      setIndex += 1;
    }
  }

  const dayData = api.Progress_getDayData(record);
  for (const [entryIndex, entry] of record.entries.entries()) {
    if (entry.isSuppressed || !entry.sets.some((set) => set.isCompleted)) continue;
    const exercise = entry.programExerciseId
      ? api.Program_getProgramExerciseForKeyAndDay(evaluated, day, entry.programExerciseId)
      : undefined;
    if (!exercise) {
      throw new LiftosaurValidationError(
        `Could not resolve finished exercise ${entry.programExerciseId ?? entryIndex + 1} on day ${day}`,
        "lifecycle-finish",
        [{ day, entry: entryIndex + 1 }]
      );
    }
    const result = withoutLoggedErrors("lifecycle-finish", () => api.Program_runFinishDayScript(
      exercise,
      evaluated,
      dayData,
      entry,
      settings,
      stats,
      record.userPromptedStateVars?.[exercise.key]
    ));
    if (!result.success) {
      throw new LiftosaurValidationError(
        `Progress script failed for ${exercise.fullName} on day ${day}: ${result.error}`,
        "lifecycle-finish",
        [{
          day,
          entry: entryIndex + 1,
          exercise: exercise.fullName,
          message: result.error,
        }]
      );
    }
  }

  const finished = withoutLoggedErrors("lifecycle-finish", () => (
    api.Program_runAllFinishDayScripts(program, record, stats, settings)
  ));
  const serializedSource = api.PlannerProgram_generateFullText(finished.program.planner?.weeks ?? []);
  const reloaded = programFromSource(serializedSource, api);
  const reloadedEvaluation = withoutLoggedErrors("lifecycle-reload", () => (
    api.Program_evaluate(reloaded, settings)
  ));
  const reloadErrors = evaluationErrors(reloadedEvaluation);
  if (reloadErrors.length > 0) {
    throw new LiftosaurValidationError(
      `Progressed source failed evaluation after day ${day}`,
      "lifecycle-reload",
      reloadErrors
    );
  }
  const nextDay = day % api.Program_numberOfDays(reloadedEvaluation) + 1;
  withoutLoggedErrors("lifecycle-next-workout", () => (
    api.Program_nextHistoryRecord(reloaded, settings, stats, nextDay)
  ));
  return {
    completedSets,
    progressedProgram: finished.program,
    serializedSource,
    reloaded,
    reloadedEvaluation,
    settings,
    stats,
    nextDay,
  };
}

function scenarioEntries(step, label) {
  if (!Number.isInteger(step.day) || step.day < 1) {
    throw new LiftosaurValidationError(`${label} day must be a positive integer`, "scenario");
  }
  if (!Array.isArray(step.entries) || step.entries.length === 0) {
    throw new LiftosaurValidationError(`${label} must provide completed entries`, "scenario");
  }
  const entries = new Map();
  for (const entry of step.entries) {
    if (
      !entry
      || typeof entry.exercise !== "string"
      || !Array.isArray(entry.sets)
      || entry.sets.length === 0
    ) {
      throw new LiftosaurValidationError(`${label} entries require exercise and sets`, "scenario");
    }
    const occurrence = entry.occurrence ?? 1;
    if (!Number.isInteger(occurrence) || occurrence < 1) {
      throw new LiftosaurValidationError(
        `${label} occurrence must be a positive integer for ${entry.exercise}`,
        "scenario"
      );
    }
    const key = JSON.stringify([entry.exercise, occurrence]);
    if (entries.has(key)) {
      throw new LiftosaurValidationError(
        `${label} has duplicate exercise occurrence: ${entry.exercise} #${occurrence}`,
        "scenario"
      );
    }
    entries.set(key, { exercise: entry.exercise, occurrence, sets: entry.sets });
  }
  return entries;
}

function completeScenarioStep(source, step, api, context, label) {
  const entries = scenarioEntries(step, label);
  const original = evaluateSource(source, api);
  if (step.day > original.days) {
    throw new LiftosaurValidationError(
      `${label} day ${step.day} exceeds the program's ${original.days} days`,
      "scenario"
    );
  }
  const usedSets = new Map([...entries].map(([key]) => [key, 0]));
  const seenOccurrences = new Map();
  const entryKeys = new Map();
  const result = completeDay(
    source,
    step.day,
    api,
    ({ set, exercise, entryIndex, setIndex }) => {
      if (!entryKeys.has(entryIndex)) {
        const occurrence = (seenOccurrences.get(exercise.fullName) ?? 0) + 1;
        seenOccurrences.set(exercise.fullName, occurrence);
        entryKeys.set(entryIndex, JSON.stringify([exercise.fullName, occurrence]));
      }
      const key = entryKeys.get(entryIndex);
      const definition = entries.get(key);
      if (!definition) {
        const occurrence = seenOccurrences.get(exercise.fullName);
        throw new LiftosaurValidationError(
          `${label} is missing exercise: ${exercise.fullName} #${occurrence}`,
          "scenario"
        );
      }
      completeReviewedSet(set, definition.sets[setIndex], exercise.fullName, setIndex, label);
      usedSets.set(key, setIndex + 1);
    },
    context
  );

  for (const [key, definition] of entries) {
    if (usedSets.get(key) !== definition.sets.length) {
      throw new LiftosaurValidationError(
        `${label} set count does not match the progressed workout for `
        + `${definition.exercise} #${definition.occurrence}`,
        "scenario"
      );
    }
  }

  const nextExposure = withoutLoggedErrors("scenario-next-exposure", () => (
    api.Program_nextHistoryRecord(
      result.reloaded,
      result.settings,
      result.stats,
      step.day
    )
  ));
  const nextWorkout = withoutLoggedErrors("scenario-next-workout", () => (
    api.Program_nextHistoryRecord(
      result.reloaded,
      result.settings,
      result.stats,
      result.nextDay
    )
  ));
  return {
    result,
    nextExposure: stableBehaviorRecord(nextExposure, result.reloadedEvaluation, api),
    nextWorkout: stableBehaviorRecord(nextWorkout, result.reloadedEvaluation, api),
  };
}

export function snapshotLiftosaurScenario(source, scenario) {
  const api = loadApi();
  if (!scenario || typeof scenario.name !== "string" || scenario.name.trim().length === 0) {
    throw new LiftosaurValidationError("Scenario must have a name", "scenario");
  }

  if (scenario.formatVersion === 1) {
    const completed = completeScenarioStep(source, scenario, api, undefined, "Scenario");
    return {
      snapshot: {
        ...LIFTOSAUR_SCENARIO_SNAPSHOT,
        scenario: { name: scenario.name, day: scenario.day },
        nextExposure: completed.nextExposure,
        nextWorkout: completed.nextWorkout,
      },
      serializedSource: completed.result.serializedSource,
    };
  }

  if (scenario.formatVersion !== 2) {
    throw new LiftosaurValidationError("Scenario formatVersion must be 1 or 2", "scenario");
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length < 2 || scenario.steps.length > 100) {
    throw new LiftosaurValidationError(
      "Scenario formatVersion 2 requires between 2 and 100 steps",
      "scenario"
    );
  }

  const names = new Set();
  for (const [index, step] of scenario.steps.entries()) {
    const label = `Scenario step ${index + 1}`;
    if (!step || typeof step.name !== "string" || step.name.trim().length === 0) {
      throw new LiftosaurValidationError(`${label} must have a name`, "scenario");
    }
    if (names.has(step.name)) {
      throw new LiftosaurValidationError(`Duplicate scenario step name: ${step.name}`, "scenario");
    }
    names.add(step.name);
  }

  let serializedSource = source;
  let context;
  const steps = scenario.steps.map((step, index) => {
    const label = `Scenario step ${index + 1}`;
    const completed = completeScenarioStep(serializedSource, step, api, context, label);
    serializedSource = completed.result.serializedSource;
    context = {
      settings: completed.result.settings,
      stats: completed.result.stats,
    };
    return {
      index: index + 1,
      name: step.name,
      day: step.day,
      nextExposure: completed.nextExposure,
      nextWorkout: completed.nextWorkout,
    };
  });

  return {
    snapshot: {
      ...LIFTOSAUR_SCENARIO_SEQUENCE_SNAPSHOT,
      scenario: { name: scenario.name },
      steps,
    },
    serializedSource,
  };
}

export function validateLiftosaurSource(source) {
  const api = loadApi();
  let original;
  try {
    original = evaluateSource(source, api);
  } catch (error) {
    if (error instanceof LiftosaurValidationError) throw error;
    throw new LiftosaurValidationError(
      error instanceof Error ? error.message : String(error),
      "parse"
    );
  }

  const serializedSource = api.PlannerProgram_generateFullText(
    original.program.planner?.weeks ?? []
  );
  let reloaded;
  try {
    reloaded = evaluateSource(serializedSource, api);
  } catch (error) {
    if (error instanceof LiftosaurValidationError) {
      throw new LiftosaurValidationError(error.message, "reload", error.details);
    }
    throw error;
  }

  if (!isDeepStrictEqual(original.records, reloaded.records)) {
    const firstMismatch = original.records.findIndex(
      (record, index) => !isDeepStrictEqual(record, reloaded.records[index])
    );
    throw new LiftosaurValidationError(
      `Serialized Liftosaur source changed the prescription for day ${firstMismatch + 1}`,
      "semantic-parity",
      [{ day: firstMismatch + 1 }]
    );
  }

  let completedSets = 0;
  for (let day = 1; day <= original.days; day += 1) {
    try {
      completedSets += completeDay(source, day, api, completeNominalSet).completedSets;
    } catch (error) {
      if (error instanceof LiftosaurValidationError) throw error;
      throw new LiftosaurValidationError(
        error instanceof Error ? error.message : String(error),
        "lifecycle",
        [{ day }]
      );
    }
  }

  const exercises = original.records.reduce((count, record) => count + record.entries.length, 0);
  const sets = original.records.reduce(
    (count, record) => count + record.entries.reduce(
      (entryCount, entry) => entryCount + entry.sets.length,
      0
    ),
    0
  );
  return {
    validator: LIFTOSAUR_VALIDATOR,
    serializedSource,
    summary: {
      days: original.days,
      exercises,
      sets,
      completedDays: original.days,
      completedSets,
    },
  };
}
