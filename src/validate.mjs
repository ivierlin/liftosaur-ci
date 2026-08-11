import {
  LIFTOSAUR_VALIDATOR,
  LiftosaurValidationError,
  snapshotLiftosaurScenario as snapshotFinishedScenario,
  validateLiftosaurSource,
} from "./validate-core.mjs";
import { snapshotPartialLiftosaurScenario } from "./partial-scenario.mjs";

export { LIFTOSAUR_VALIDATOR, LiftosaurValidationError, validateLiftosaurSource };

export function snapshotLiftosaurScenario(source, scenario) {
  if (Array.isArray(scenario?.steps)) {
    if (scenario.steps.some((step) => step?.finish === false)) {
      throw new LiftosaurValidationError(
        "Partial scenario observations are standalone and cannot be resumed in a sequence",
        "scenario"
      );
    }
    return snapshotFinishedScenario(source, scenario);
  }

  return scenario?.finish === false
    ? snapshotPartialLiftosaurScenario(source, scenario)
    : snapshotFinishedScenario(source, scenario);
}
