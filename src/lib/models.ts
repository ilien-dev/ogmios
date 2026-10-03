import type { ModelOption, Settings } from "@shared/domain";

const FAMILIES = ["sonnet", "haiku", "opus", "fable"] as const;

function familyOf(text: string): string | undefined {
  const lower = text.toLowerCase();
  return FAMILIES.find((family) => lower.includes(family));
}

function inFamily(model: ModelOption, family: string): boolean {
  return familyOf(model.id) === family || familyOf(model.name) === family;
}

/**
 * Fits the stored choice to what the provider offers now. A model it names
 * differently (an alias after a switch from the API, an id the API retired)
 * moves to the newest of its family; anything else to Sonnet, then to the
 * first model. An effort the model lacks goes back to automatic. Returns
 * `settings` itself when nothing changes.
 */
export function reconcileModel(
  models: ModelOption[],
  settings: Settings,
): Settings {
  const family = familyOf(settings.model);
  const model =
    models.find((candidate) => candidate.id === settings.model) ??
    (family === undefined
      ? undefined
      : models.find((candidate) => inFamily(candidate, family))) ??
    models.find((candidate) => inFamily(candidate, "sonnet")) ??
    models[0];
  if (model === undefined) {
    return settings;
  }
  const effort =
    settings.effort !== null && model.efforts.includes(settings.effort)
      ? settings.effort
      : null;
  return model.id === settings.model && effort === settings.effort
    ? settings
    : { ...settings, model: model.id, effort };
}
