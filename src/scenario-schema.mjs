function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
}

function requireAllowedKeys(value, allowed, label) {
  requireObject(value, label);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} has unsupported keys: ${unexpected.join(", ")}`);
}

function validateEntries(entries, label) {
  if (!Array.isArray(entries)) return;
  for (const [entryIndex, entry] of entries.entries()) {
    const entryLabel = `${label}.entries[${entryIndex}]`;
    requireAllowedKeys(entry, new Set(["exercise", "occurrence", "sets"]), entryLabel);
    if (!Array.isArray(entry.sets)) continue;
    for (const [setIndex, set] of entry.sets.entries()) {
      const setLabel = `${entryLabel}.sets[${setIndex}]`;
      requireAllowedKeys(
        set,
        new Set(["reps", "repsLeft", "weight", "rpe", "setTime", "skip"]),
        setLabel
      );
      if (Object.hasOwn(set, "skip")) {
        if (set.skip !== true) throw new Error(`${setLabel}.skip must be true when provided`);
        const completionKeys = ["reps", "repsLeft", "weight", "rpe", "setTime"]
          .filter((key) => Object.hasOwn(set, key));
        if (completionKeys.length) {
          throw new Error(`${setLabel}.skip cannot be combined with: ${completionKeys.join(", ")}`);
        }
      }
    }
  }
}

function validateUnits(scenario) {
  if (Object.hasOwn(scenario, "units") && scenario.units !== "kg" && scenario.units !== "lb") {
    throw new Error("Scenario.units must be kg or lb");
  }
}

export function assertScenarioSchema(scenario) {
  requireObject(scenario, "Scenario");
  validateUnits(scenario);
  if (Object.hasOwn(scenario, "steps")) {
    requireAllowedKeys(scenario, new Set(["name", "steps", "units"]), "Scenario");
    if (Array.isArray(scenario.steps)) {
      for (const [index, step] of scenario.steps.entries()) {
        const label = `Scenario.steps[${index}]`;
        requireAllowedKeys(step, new Set(["name", "day", "entries"]), label);
        validateEntries(step.entries, label);
      }
    }
    return scenario;
  }
  requireAllowedKeys(scenario, new Set(["name", "day", "entries", "finish", "units"]), "Scenario");
  validateEntries(scenario.entries, "Scenario");
  return scenario;
}
