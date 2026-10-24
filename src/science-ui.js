import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync, gzipSync, constants} from 'node:zlib';
import {managedWrite} from './files.js';

// The app keeps a session's previous selection even when the live catalog no
// longer contains it. Repair only the composer selection, through its normal
// state callback; never rewrite the model recorded on historical messages.
// This function is also embedded in Science's isolated web runtime.
export function selectionFallback(models, selected, defaultModel) {
  if (!Array.isArray(models) || !models.length) return null;
  if (!models.every((m) => typeof m.id === 'string' && m.id.startsWith('claude-science-local-')))
    return null;
  const available = models.filter((m) => m.disabled !== true);
  if (available.some((m) => m.id === selected)) return null;
  const fallback = available.find((m) => m.id === defaultModel)?.id;
  // Null means "inherit the default". Keep that choice if the default is valid;
  // otherwise a new session would have nothing usable to inherit.
  if (selected == null && fallback) return null;
  return fallback || available[0]?.id || null;
}

// Deliberately bound to the inspected 0.1.70 asset, not a best-effort rewrite of
// unknown/minified code. A Science update disables this optional UI repair until
// its new asset has been checked. The application bundle itself is never edited.
export const supportedUI = {
  version: '0.1.70',
  asset: 'index-DhEuR7nq.js',
  sha256: 'efede46f82c2c615bfb352c633795e8fe9e86b16406a682046d0f82754cb468d',
};
export const pickerAnchor =
  'function toe({models:e,selectedModel:t,onSelect:n,disabled:r=!1,loading:s=!1,feedError:o=!1,fetchError:i=null,placeholder:l,variant:c="select",via:u,interceptPick:d,"data-testid":h,servedList:m=!1,openRequest:g,useCase:y,useCaseState:v,noticeKey:b}){var W;';
export const composerAnchor = 'jsx(toe,{models:st,selectedModel:be,onSelect:te=>te&&Ve(te),';

export function patchModelPicker(source) {
  if (
    source.split(pickerAnchor).length !== 2 ||
    source.split(composerAnchor).length !== 3 ||
    source.includes('scienceLocalFallbackFeed')
  )
    throw Error('Science model picker does not match the supported layout');
  const hook = `
const scienceLocalFallbackFeed=Jg();
const scienceLocalFallbackNext=(${selectionFallback.toString()})(e,t,scienceLocalFallbackFeed.defaultModelId);
f.useEffect(()=>{
  if(c!=="pill"||scienceLocalFallbackPaused||r||s||o||i||scienceLocalFallbackFeed.loading||scienceLocalFallbackFeed.feedError||scienceLocalFallbackFeed.fetchError||scienceLocalFallbackFeed.authError||scienceLocalFallbackFeed.error||!scienceLocalFallbackNext)return;
  n(scienceLocalFallbackNext);
},[c,scienceLocalFallbackPaused,r,s,o,i,scienceLocalFallbackFeed.loading,scienceLocalFallbackFeed.feedError,scienceLocalFallbackFeed.fetchError,scienceLocalFallbackFeed.authError,scienceLocalFallbackFeed.error,scienceLocalFallbackNext,n]);
`;
  return source
    .replace(
      pickerAnchor,
      pickerAnchor.replace('}){var W;', ',scienceLocalFallbackPaused=!1}){var W;') + hook,
    )
    .replaceAll(
      composerAnchor,
      composerAnchor.replace('{models:', '{scienceLocalFallbackPaused:o||i||l||u||Te,models:'),
    );
}

export function modelPickerAssets(source) {
  const script = Buffer.from(patchModelPicker(source));
  // Science's static server prefers the existing .br/.gz sidecar. Updating only
  // .js would pass plain-fetch tests while browsers still execute the old code.
  return new Map([
    [supportedUI.asset, script],
    [
      supportedUI.asset + '.br',
      brotliCompressSync(script, {params: {[constants.BROTLI_PARAM_QUALITY]: 5}}),
    ],
    [supportedUI.asset + '.gz', gzipSync(script)],
  ]);
}

export function installModelFallback({data, version, journal}) {
  if (version !== supportedUI.version)
    return {state: 'unsupported', reason: 'Science UI version has not been verified'};
  const web = path.join(data, 'runtime', version + '-release', 'web-dist');
  const asset = path.join(web, 'assets', supportedUI.asset);
  const source = fs.readFileSync(asset, 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== supportedUI.sha256)
    return {state: 'unsupported', reason: 'Science UI asset differs from the verified build'};
  const entryAssets = modelPickerAssets(source);
  const hash = createHash('sha256');
  for (const [name, bytes] of entryAssets) hash.update(name).update('\0').update(bytes);
  const revision = hash.digest('hex').slice(0, 24);
  const directory = 'science-local-' + revision;
  const index = path.join(web, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  if (!html.includes('./assets/' + supportedUI.asset) || html.includes('./assets/science-local-'))
    throw Error('Science index does not match the supported layout');
  // Science serves hashed assets as immutable for a year. Copy the public web
  // tree under a new URL, preserving relative imports, CSS and worker paths.
  // Merely changing the entry filename would load duplicate old/new React stores
  // when lazy chunks import the original entry. Never mutate the original JS.
  const files = [];
  function collect(relative = '') {
    const current = path.join(web, relative);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Refusing symlink UI asset');
    for (const item of fs.readdirSync(current, {withFileTypes: true})) {
      if (relative === 'assets' && item.name.startsWith('science-local-')) continue;
      const rel = path.join(relative, item.name);
      if (item.isSymbolicLink()) throw Error('Refusing symlink UI asset');
      if (item.isDirectory()) collect(rel);
      else if (item.isFile()) files.push(rel);
      else throw Error('Unsupported UI asset');
    }
  }
  collect();
  for (const rel of files) {
    managedWrite(
      path.join(web, 'assets', directory, rel),
      (path.dirname(rel) === 'assets' && entryAssets.get(path.basename(rel))) ||
        fs.readFileSync(path.join(web, rel)),
      journal,
    );
  }
  managedWrite(index, html.replaceAll('./assets/', './assets/' + directory + '/assets/'), journal);
  return {state: 'active', version};
}
