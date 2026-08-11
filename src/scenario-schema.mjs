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
      requireAllowedKeys(
        set,
        new Set(["reps", "repsLeft", "weight", "rpe", "setTime"]),
        `${entryLabel}.sets[${setIndex}]`
      );
    }
  }
}

export function assertScenarioSchema(scenario) {
  requireObject(scenario, "Scenario");
  if (Object.hasOwn(scenario, "steps")) {
    requireAllowedKeys(scenario, new Set(["name", "steps"]), "Scenario");
    if (Array.isArray(scenario.steps)) {
      for (const [index, step] of scenario.steps.entries()) {
        const label = `Scenario.steps[${index}]`;
        requireAllowedKeys(step, new Set(["name", "day", "entries"]), label);
        validateEntries(step.entries, label);
      }
    }
    return scenario;
  }
  requireAllowedKeys(scenario, new Set(["name", "day", "entries"]), "Scenario");
  validateEntries(scenario.entries, "Scenario");
  return scenario;
}
