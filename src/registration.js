import path from 'node:path';
import {isSciencePlugin, isPublishedSciencePlugin} from './plugin-identity.js';

// A runtime release is an implementation detail, never a second Agent source.
export function registrationPlan({registry, project, root, previous}) {
  const local = [
    project,
    previous?.sourceProject,
    previous?.registrationSpec,
    previous?.project,
    previous?.pluginSpec,
  ].filter(Boolean);
  const releases = path.join(root, 'releases');
  const isRelease = (spec) =>
    typeof spec === 'string' &&
    path.isAbsolute(spec) &&
    /^[a-f0-9]{64}$/i.test(path.relative(releases, spec));
  const entries = (registry?.plugins || []).filter(
    (e) => isSciencePlugin(e.spec, local) || isRelease(e.spec),
  );
  const sources = entries.filter((e) => !isRelease(e.spec));
  const enabled = sources.filter((e) => !e.off);
  const choose = (list) =>
    list.find((e) => e.spec === previous?.registrationSpec) ||
    list.find((e) => e.spec === project) ||
    list.find((e) => isPublishedSciencePlugin(e.spec)) ||
    list[0];
  const source = choose(enabled) || choose(sources);
  const spec = source?.spec || previous?.sourceSpec || previous?.sourceProject || project;
  if (isRelease(spec)) throw Error('Cannot use an internal runtime release as the plugin source');
  return {
    spec,
    entries,
    existing: entries.some((e) => e.spec === spec),
    duplicates: entries.filter((e) => e.spec !== spec),
  };
}
