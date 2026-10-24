import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {
  selectionFallback,
  patchModelPicker,
  pickerAnchor,
  composerAnchor,
  installModelFallback,
  supportedUI,
  modelPickerAssets,
} from '../src/science-ui.js';

const one = 'claude-science-local-one';
const two = 'claude-science-local-two';
const models = [{id: one}, {id: two}];

test('stale selections use the enabled default, then first enabled model; valid selections stay', () => {
  assert.equal(selectionFallback(models, 'claude-sonnet-4-6', two), two);
  assert.equal(selectionFallback(models, 'claude-science-local-removed', 'removed'), one);
  assert.equal(selectionFallback(models, one, two), null);
  assert.equal(selectionFallback(models, null, two), null, 'native default inheritance stays');
  assert.equal(
    selectionFallback(models, null, 'removed'),
    one,
    'new sessions need a usable default',
  );
  assert.equal(selectionFallback(models, undefined, null), one);
  assert.equal(selectionFallback([{id: one, disabled: true}, {id: two}], one, one), two);
  assert.equal(selectionFallback([{id: one, disabled: true}], 'stale', one), null);
});

test('empty lists and native/offline catalogs never select a substitute', () => {
  assert.equal(selectionFallback([], 'stale', two), null);
  assert.equal(selectionFallback([{id: 'claude-sonnet-4-6'}], 'stale', two), null);
  assert.equal(selectionFallback([...models, {id: 'claude-opus-5'}], 'stale', two), null);
});

// Execute the actual generated hook against a tiny React effect harness. The
// callback models the normal composer selection setter, including its re-render.
const fixture = `${pickerAnchor}return t;}
function composer(o=false,i=false,l=false,u=false,Te=false){
return [a.${composerAnchor}variant:"pill"}),a.${composerAnchor}variant:"pill"})];
}`;
function mount(props = {}, feedProps = {}, script = patchModelPicker(fixture)) {
  const effects = [],
    changes = [];
  const feed = {defaultModelId: two, ...feedProps};
  const context = vm.createContext({
    f: {useEffect: (effect) => effects.push(effect)},
    Jg: () => feed,
    a: {jsx: (component, props) => component(props)},
    st: models,
    be: 'claude-sonnet-4-6',
    Ve: (id) => changes.push(id),
  });
  vm.runInContext(script, context);
  const render = (overrides = {}) => {
    context.toe({
      models,
      selectedModel: 'claude-sonnet-4-6',
      onSelect: context.Ve,
      variant: 'pill',
      ...props,
      ...overrides,
    });
    effects.splice(0).forEach((effect) => effect());
  };
  return {context, changes, effects, render, feed};
}

test('Brotli and gzip responses execute the same fallback as the plain browser asset', () => {
  const assets = modelPickerAssets(fixture);
  const plain = assets.get(supportedUI.asset);
  for (const [suffix, decode] of [
    ['.br', brotliDecompressSync],
    ['.gz', gunzipSync],
  ]) {
    const script = decode(assets.get(supportedUI.asset + suffix));
    assert.deepEqual(script, plain);
    const app = mount({}, {}, script.toString());
    app.render();
    assert.deepEqual(app.changes, [two]);
    app.render({selectedModel: one});
    assert.deepEqual(app.changes, [two]);
  }
});

test('rendered legacy selection changes the actual selection once and keeps later manual choices', () => {
  const app = mount();
  app.render();
  assert.deepEqual(app.changes, [two]);
  app.render({selectedModel: two});
  app.render({selectedModel: one});
  assert.deepEqual(app.changes, [two]);
});

test('no automatic switch while busy, read-only, loading or in error; resume when ready', () => {
  for (const props of [
    {disabled: true},
    {scienceLocalFallbackPaused: true},
    {loading: true},
    {feedError: true},
    {fetchError: 'network'},
    {variant: 'select'},
  ]) {
    const app = mount(props);
    app.render();
    assert.deepEqual(app.changes, []);
  }
  for (const field of ['loading', 'feedError', 'fetchError', 'authError', 'error']) {
    const app = mount({}, {[field]: true});
    app.render();
    assert.deepEqual(app.changes, []);
    app.feed[field] = false;
    app.render();
    assert.deepEqual(app.changes, [two]);
  }
  for (let index = 0; index < 5; index++) {
    const app = mount();
    const flags = Array(5).fill(false);
    flags[index] = true;
    app.context.composer(...flags);
    app.effects.splice(0).forEach((effect) => effect());
    assert.deepEqual(app.changes, [], 'composer busy/read-only state reaches both picker branches');
  }
});

test('unknown picker layouts and modified builds are left untouched', () => {
  assert.throws(() => patchModelPicker('different app'), /layout/);
  assert.throws(() => patchModelPicker(fixture + pickerAnchor), /layout/);
  assert.throws(() => patchModelPicker(patchModelPicker(fixture)), /layout/);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'science-ui-'));
  try {
    assert.equal(installModelFallback({data, version: 'next'}).state, 'unsupported');
    const asset = path.join(
      data,
      'runtime',
      supportedUI.version + '-release',
      'web-dist',
      'assets',
      supportedUI.asset,
    );
    fs.mkdirSync(path.dirname(asset), {recursive: true});
    fs.writeFileSync(asset, fixture);
    assert.equal(installModelFallback({data, version: supportedUI.version}).state, 'unsupported');
    assert.equal(fs.readFileSync(asset, 'utf8'), fixture);
  } finally {
    fs.rmSync(data, {recursive: true, force: true});
  }
});
