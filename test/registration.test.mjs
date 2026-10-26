import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registrationPlan} from '../src/registration.js';
import {createInstaller} from '../src/cli.js';
import {managedWrite} from '../src/files.js';
const github = 'github:Jhonny1024/claude-science-local-for-magpie-windows';
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'science-one-plugin-'));
  const source = path.join(home, 'checkout'),
    root = path.join(home, '.config/magpie/science-local-runtime'),
    registryFile = path.join(home, '.config/magpie/plugins.json');
  fs.mkdirSync(path.join(source, 'src'), {recursive: true});
  fs.mkdirSync(path.dirname(registryFile), {recursive: true});
  fs.writeFileSync(path.join(source, 'src/runtime.js'), '//fixture');
  fs.writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({type: 'module', dependencies: {}, scienceLocal: {modelCatalog: true}}),
  );
  const binary = path.join(home, 'bin');
  fs.writeFileSync(binary, 'fake');
  let fail = false;
  const calls = [];
  const registry = () => JSON.parse(fs.readFileSync(registryFile));
  const store = (r) => fs.writeFileSync(registryFile, JSON.stringify(r));
  const run = (bin, args) => {
    calls.push(args);
    if (args[0] === 'plugin') {
      let r = registry(),
        e = r.plugins.find((x) => x.spec === args[2]);
      if (args[1] === 'add' && !e) {
        e = {spec: args[2]};
        r.plugins.push(e);
      }
      if (args[1] === 'rm') r.plugins = r.plugins.filter((x) => x.spec !== args[2]);
      if (args[1] === 'off' || args[1] === 'on') {
        assert.ok(e, 'registered source');
        e.off = args[1] === 'off';
      }
      if (args[1] === 'options') e.options = JSON.parse(args[3]);
      store(r);
    }
    return {status: 0, stdout: '', stderr: ''};
  };
  const create = (project = source) =>
    createInstaller({
      home,
      project,
      node: binary,
      platform: 'darwin',
      env: {},
      run,
      stopService: async () => {},
      waitHealthy: async () => {
        if (fail) {
          fail = false;
          throw Error('injected startup failure');
        }
      },
      fetch: async (url) => ({
        ok: true,
        json: async () => (url.endsWith('hello') ? {name: 'magpie'} : {data: [{id: 'fake/one'}]}),
      }),
      log: () => {},
    });
  const options = {magpie: binary, science: binary, model: 'fake/one'};
  return {
    home,
    root,
    source,
    binary,
    registryFile,
    registry,
    store,
    create,
    options,
    calls,
    fail: () => {
      fail = true;
    },
    cleanup: () => fs.rmSync(home, {recursive: true, force: true}),
  };
}
for (const kind of ['manual-local', 'marketplace', 'installer-only'])
  test(
    kind + ' retains exactly one source through install, upgrade, rollback and uninstall',
    async () => {
      const f = fixture();
      try {
        const spec = kind === 'marketplace' ? github : f.source;
        const other = {spec: 'other/unrelated-plugin', options: {keep: true}};
        f.store({
          plugins: [
            other,
            ...(kind === 'installer-only' ? [] : [{spec, options: {keep: 'user choice'}}]),
          ],
        });
        const cli = f.create(),
          first = await cli.execute({...f.options, command: 'install'});
        assert.equal(first.registrationSpec, spec);
        assert.notEqual(first.pluginSpec, spec);
        assert.equal(f.registry().plugins.length, 2);
        assert.equal(
          f.calls.some((a) => a[0] === 'plugin' && a[1] === 'add' && a[2] === spec),
          kind === 'installer-only',
        );
        fs.appendFileSync(path.join(f.source, 'src/runtime.js'), '//next');
        const next = await cli.execute({...f.options, command: 'upgrade'});
        assert.notEqual(next.deployment.id, first.deployment.id);
        const rolled = await cli.execute({...f.options, command: 'rollback'});
        assert.equal(rolled.registrationSpec, spec);
        assert.equal(rolled.deployment.id, first.deployment.id);
        assert.deepEqual(
          f.registry().plugins.map((e) => e.spec),
          [other.spec, spec],
        );
        assert.deepEqual(f.registry().plugins[0], other);
        if (kind !== 'installer-only')
          assert.deepEqual(f.registry().plugins[1].options, {keep: 'user choice'});
        await cli.execute({command: 'uninstall'});
        assert.deepEqual(f.registry().plugins, [other]);
        assert.equal(
          fs.existsSync(path.join(f.home, '.config/magpie/science-local-service.json')),
          false,
        );
      } finally {
        f.cleanup();
      }
    },
  );
test('legacy duplicate migration restores registry on failure then removes internal registrations on success', async () => {
  const f = fixture();
  try {
    f.store({plugins: [{spec: f.source, options: {keep: 1}}]});
    const cli = f.create(),
      first = await cli.execute({...f.options, command: 'install'});
    managedWrite(
      cli.stateFile,
      JSON.stringify({...first, registrationSpec: first.pluginSpec, sourceSpec: undefined}),
      path.join(f.root, 'private-journal.json'),
    );
    const before = {
      plugins: [
        {spec: f.source, off: true, options: {keep: 1}},
        {spec: first.pluginSpec},
        {spec: path.join(f.root, 'releases', 'b'.repeat(64)), off: true},
        {spec: 'other/plugin'},
      ],
    };
    f.store(before);
    f.fail();
    await assert.rejects(
      cli.execute({...f.options, command: 'upgrade'}),
      /injected startup failure/,
    );
    assert.deepEqual(
      f.registry().plugins.map((e) => ({spec: e.spec, off: !!e.off, options: e.options})),
      before.plugins.map((e) => ({spec: e.spec, off: !!e.off, options: e.options})),
    );
    const next = await cli.execute({...f.options, command: 'upgrade'});
    assert.equal(next.registrationSpec, f.source);
    assert.deepEqual(
      f.registry().plugins.map((e) => e.spec),
      [f.source, 'other/plugin'],
    );
    assert.equal(f.registry().plugins[0].off, false);
    assert.deepEqual(f.registry().plugins[0].options, {keep: 1});
  } finally {
    f.cleanup();
  }
});
test('a different package checkout finds the existing runtime instead of installing a second service', async () => {
  const f = fixture();
  try {
    f.store({plugins: [{spec: github}]});
    const first = await f.create().execute({...f.options, command: 'install'});
    const cached = path.join(f.home, 'market-cache');
    fs.cpSync(f.source, cached, {recursive: true});
    const cli = f.create(cached);
    assert.equal(path.dirname(cli.stateFile), f.root);
    const next = await cli.execute({...f.options, command: 'upgrade'});
    assert.equal(next.registrationSpec, github);
    assert.equal(next.data, first.data);
    assert.equal(next.auth, first.auth);
    assert.equal(next.token, first.token);
    assert.deepEqual(
      f.registry().plugins.map((e) => e.spec),
      [github],
    );
  } finally {
    f.cleanup();
  }
});
test('an active marketplace source wins over disabled checkout and internal deployment', () => {
  const root = path.resolve('runtime'),
    project = path.resolve('checkout'),
    release = path.join(root, 'releases', 'a'.repeat(64));
  const p = registrationPlan({
    root,
    project,
    registry: {plugins: [{spec: project, off: true}, {spec: release}, {spec: github}]},
    previous: {registrationSpec: release, sourceProject: project},
  });
  assert.equal(p.spec, github);
  assert.equal(p.existing, true);
  assert.equal(p.duplicates.length, 2);
});

test('Windows marketplace setup stores the service outside the replaceable plugin cache', () => {
  const f = fixture();
  try {
    const cached = path.join(
      f.home,
      '.config/magpie/plugins/node_modules/claude-science-local-for-magpie',
    );
    const cli = createInstaller({home: f.home, project: cached, platform: 'win32', env: {}});
    assert.equal(path.dirname(cli.stateFile), f.root);
    const local = createInstaller({home: f.home, project: f.source, platform: 'win32', env: {}});
    assert.equal(path.dirname(local.stateFile), path.join(f.source, '.science-local-runtime'));
  } finally {
    f.cleanup();
  }
});
