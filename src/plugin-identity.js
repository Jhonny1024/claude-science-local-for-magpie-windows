// Recognize this package, the original source, and the published Windows port.
export function isPublishedSciencePlugin(spec) {
  if (typeof spec !== 'string') return false;
  if (
    /^(?:claude-science-local-for-magpie|magpie-science-local)(?:@[a-zA-Z0-9^~.*+_-][a-zA-Z0-9.^~*+_-]*)?$/.test(
      spec,
    )
  )
    return true;
  if (
    /^(?:(?:github:)?Jhonny1024\/claude-science-local-for-magpie-windows|(?:git\+)?https:\/\/github\.com\/Jhonny1024\/claude-science-local-for-magpie-windows(?:\.git)?)(?:#[A-Za-z0-9._/-]+)?$/i.test(
      spec,
    )
  )
    return true;
  return /^(?:(?:github:)?nickzhangcomes\/claude-science-local-for-magpie|(?:git\+)?https:\/\/github\.com\/nickzhangcomes\/claude-science-local-for-magpie(?:\.git)?)(?:#[A-Za-z0-9._/-]+)?$/.test(
    spec,
  );
}
export function isSciencePlugin(spec, localSpecs = []) {
  if (typeof spec !== 'string' || !spec) return false;
  if (localSpecs.includes(spec)) return true;
  return isPublishedSciencePlugin(spec);
}
export function enabledSciencePlugins(registry, localSpecs = []) {
  return (registry?.plugins || []).filter(
    (entry) => !entry.off && isSciencePlugin(entry.spec, localSpecs),
  );
}
