import { isDeepStrictEqual } from "node:util";

import { loadLiftosaurRuntime, pinnedRuntimeRevision } from "./runtime.mjs";

export const LIFTOSAUR_VALIDATOR = Object.freeze({
  formatVersion: 1,
  implementation: "liftosaur-native-v1",
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
    exercise: entry.exercise,
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

function evaluationErrors(evaluated) {
  return evaluated.errors.map(({ error, dayData }) => ({
    day: dayData.day,
    week: dayData.week,
    dayInWeek: dayData.dayInWeek,
    message: error instanceof Error ? error.message : String(error),
  }));
}

function loadApi() {
  const runtime = loadLiftosaurRuntime();
  const {
    Program_create,
    Program_evaluate,
    Program_nextHistoryRecord,
    Program_numberOfDays,
  } = runtime.require("src/models/program.ts");
  const { Settings_build } = runtime.require("src/models/settings.ts");
  const { Stats_getEmpty } = runtime.require("src/models/stats.ts");
  const {
    PlannerProgram_evaluateText,
    PlannerProgram_generateFullText,
  } = runtime.require(
    "src/pages/planner/models/plannerProgram.ts"
  );
  return {
    Program_create,
    Program_evaluate,
    Program_nextHistoryRecord,
    Program_numberOfDays,
    Settings_build,
    Stats_getEmpty,
    PlannerProgram_evaluateText,
    PlannerProgram_generateFullText,
  };
}

function evaluateSource(source, api) {
  const program = {
    ...api.Program_create("Validation Program"),
    planner: {
      vtype: "planner",
      name: "Validation Program",
      weeks: api.PlannerProgram_evaluateText(source),
    },
  };
  const settings = api.Settings_build();
  const evaluated = api.Program_evaluate(program, settings);
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
    api.Program_nextHistoryRecord(program, settings, api.Stats_getEmpty(), index + 1)
  ));
  return { program, days, records };
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
    summary: { days: original.days, exercises, sets },
  };
}
