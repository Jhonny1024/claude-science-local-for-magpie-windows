import {createHash} from 'node:crypto';

export const aliasPrefix = 'claude-science-local-';
export const validModel = (id) =>
  typeof id === 'string' && /^[-\w.]+\/[-\w./:]+$/.test(id) && !id.startsWith('claude-science/');
export function modelAlias(id) {
  if (!validModel(id)) throw Error('Invalid upstream model');
  return aliasPrefix + createHash('sha256').update(id).digest('hex').slice(0, 24);
}
export function availableModels(config) {
  // An explicitly empty list means no models are enabled. It must not fall back
  // to an old selection that the user removed from the catalog.
  const source = Array.isArray(config.models)
    ? config.models
    : validModel(config.model)
      ? [{id: config.model, name: config.displayName || config.model}]
      : [];
  const seen = new Set();
  return source.filter((m) => m && validModel(m.id) && !seen.has(m.id) && seen.add(m.id));
}
export function displayName(model) {
  const name = String(model.name || model.id);
  // Science hides names that look like lower-case internal Claude slugs.
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(name)
    ? name[0].toUpperCase() + name.slice(1)
    : name;
}
