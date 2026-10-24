import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const project = path.resolve('.');
test('doctor explains the missing setup after a marketplace-only installation without writing files', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-first-run-')));
  try {
    const registry = path.join(home, '.config/magpie/plugins.json');
    fs.mkdirSync(path.dirname(registry), {recursive: true});
    fs.writeFileSync(registry, JSON.stringify({plugins: [{spec: 'magpie-science-local@latest'}]}));
    const before = fs.readFileSync(registry, 'utf8'),
      output = [];
    await createInstaller({home, log: (line) => output.push(line)}).execute({command: 'doctor'});
    assert.match(output.join('\n'), /node src\/cli.js install/);
    assert.match(output.join('\n'), /Magpie/);
    assert.equal(fs.readFileSync(registry, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.dirname(registry)), ['plugins.json']);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('--help does not create a profile and succeeds cross-platform', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-help-')));
  try {
    const r = spawnSync(process.execPath, ['src/cli.js', '--help'], {
      env: {...process.env, HOME: home},
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--model/);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('install uses stable release; failed upgrade restores previous selection and state', async () => {
  const {createInstaller} = await import('../src/cli.js');
  assert.equal(typeof createInstaller, 'function');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-install-')));
  const calls = [];
  let fail = false;
  const binary = path.join(home, 'fake-bin');
  fs.writeFileSync(binary, 'fake', {mode: 0o700});
  const env = {PATH: home};
  const installer = createInstaller({
    home,
    project,
    platform: 'darwin',
    env,
    node: binary,
    run: (bin, args) => {
      calls.push([bin, ...args]);
      return {status: args[0] === 'print' ? 1 : 0, stdout: '', stderr: ''};
    },
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/api/hello')
          ? {name: 'magpie'}
          : {data: [{id: 'fake/first'}, {id: 'fake/second'}]},
    }),
    waitHealthy: async () => {
      if (fail) {
        fail = false;
        throw Error('startup failed');
      }
    },
    stopService: async () => {
      calls.push(['stop']);
    },
    log: () => {},
  });
  try {
    await installer.execute({
      command: 'install',
      model: 'fake/second',
      gateway: 'http://localhost:4567',
      magpie: binary,
      science: binary,
    });
    const stateFile = path.join(home, '.config/magpie/science-local-runtime/state.json'),
      before = fs.readFileSync(stateFile, 'utf8'),
      s = JSON.parse(before);
    assert.match(s.pluginSpec, /releases\/[a-f0-9]{64}$/);
    assert.ok(s.node.startsWith(s.pluginSpec));
    assert.equal(s.model, 'fake/second');
    assert.equal(s.gatewayOverride, true);
    assert.equal(s.gateway, 'http://127.0.0.1:4567');
    assert.ok(calls.some((c) => c.includes('science-local') && c.includes('magpie')));
    fail = true;
    await assert.rejects(
      installer.execute({command: 'upgrade', model: 'fake/first', magpie: binary, science: binary}),
      /startup failed/,
    );
    assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).model, 'fake/second');
    assert.ok(!fs.existsSync(path.join(home, '.config/magpie/science-local-runtime/install.lock')));
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('npm-style symlink entry executes help', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-symlink-')));
  try {
    const link = path.join(dir, 'cli');
    fs.symlinkSync(path.join(project, 'src', 'cli.js'), link);
    const r = spawnSync(process.execPath, [link, '--help'], {encoding: 'utf8'});
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
test('lock excludes mutations before touching managed journals', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-lock-')));
  try {
    const root = path.join(home, '.config/magpie/science-local-runtime');
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, 'install.lock'), 'existing');
    const cli = createInstaller({home, platform: 'darwin', env: {}});
    await assert.rejects(cli.execute({command: 'uninstall'}), /install.lock/);
    assert.deepEqual(fs.readdirSync(root), ['install.lock']);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('upgrade and rollback retain sessions, and reinstall preserves authentication', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-rollback-')));
  try {
    const source = path.join(home, 'source');
    fs.mkdirSync(path.join(source, 'src'), {recursive: true});
    fs.writeFileSync(path.join(source, 'src', 'runtime.js'), '//one');
    fs.writeFileSync(path.join(source, 'package.json'), '{"type":"module","dependencies":{}}');
    const binary = path.join(home, 'bin');
    fs.writeFileSync(binary, 'fake', {mode: 0o700});
    const installer = createInstaller({
      home,
      project: source,
      platform: 'darwin',
      env: {},
      node: binary,
      run: () => ({status: 0, stdout: '', stderr: ''}),
      fetch: async (url) => ({
        ok: true,
        json: async () => (url.endsWith('hello') ? {name: 'magpie'} : {data: [{id: 'a'}]}),
      }),
      stopService: async () => {},
      waitHealthy: async () => {},
      log: () => {},
    });
    const options = {magpie: binary, science: binary, model: 'a'};
    const first = await installer.execute({...options, command: 'install'});
    const encryption = fs.readFileSync(path.join(first.auth, 'encryption.key'), 'utf8');
    fs.mkdirSync(first.data, {recursive: true});
    fs.writeFileSync(path.join(first.data, 'session'), 'keep');
    fs.appendFileSync(path.join(source, 'src', 'runtime.js'), '//two');
    const second = await installer.execute({...options, command: 'upgrade'});
    assert.notEqual(first.deployment.id, second.deployment.id);
    const restored = await installer.execute({...options, command: 'rollback'});
    assert.equal(restored.deployment.id, first.deployment.id);
    assert.equal(fs.readFileSync(path.join(first.data, 'session'), 'utf8'), 'keep');
    await installer.execute({...options, command: 'uninstall'});
    fs.mkdirSync(path.dirname(first.originalConfig), {recursive: true});
    fs.writeFileSync(first.originalConfig, 'user_setting = "preserve-after-uninstall"\n');
    await installer.execute({...options, command: 'install'});
    assert.match(fs.readFileSync(first.scienceConfig, 'utf8'), /preserve-after-uninstall/);
    assert.match(
      fs.readFileSync(path.join(path.dirname(installer.stateFile), 'original-config.txt'), 'utf8'),
      /preserve-after-uninstall/,
    );
    assert.equal(fs.readFileSync(path.join(first.auth, 'encryption.key'), 'utf8'), encryption);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('state drift during upgrade preserves user edits and restores old Science configuration', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-drift-')));
  try {
    const source = path.join(home, 'source');
    fs.mkdirSync(path.join(source, 'src'), {recursive: true});
    fs.writeFileSync(path.join(source, 'src', 'runtime.js'), '//runtime');
    fs.writeFileSync(path.join(source, 'package.json'), '{"dependencies":{}}');
    const binary = path.join(home, 'bin');
    fs.writeFileSync(binary, 'fake', {mode: 0o700});
    const cli = createInstaller({
      home,
      project: source,
      node: binary,
      platform: 'darwin',
      env: {},
      run: () => ({status: 0}),
      fetch: async (url) => ({
        ok: true,
        json: async () => (url.endsWith('hello') ? {name: 'magpie'} : {data: [{id: 'a'}]}),
      }),
      stopService: async () => {},
      waitHealthy: async () => {},
      log: () => {},
    });
    const options = {magpie: binary, science: binary, model: 'a'};
    const state = await cli.execute({...options, command: 'install'}),
      before = fs.readFileSync(state.scienceConfig, 'utf8');
    fs.writeFileSync(cli.stateFile, JSON.stringify({...state, userNote: 'preserve'}));
    await assert.rejects(cli.execute({...options, command: 'upgrade', sciencePort: 0}), /drift/);
    assert.equal(JSON.parse(fs.readFileSync(cli.stateFile)).userNote, 'preserve');
    assert.equal(fs.readFileSync(state.scienceConfig, 'utf8'), before);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
test('upgrade preserves a published source and failure restores it without reviving the checkout', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-source-')));
  try {
    const source = path.join(home, 'source');
    fs.mkdirSync(path.join(source, 'src'), {recursive: true});
    fs.writeFileSync(path.join(source, 'src/runtime.js'), '//one');
    fs.writeFileSync(path.join(source, 'package.json'), '{"dependencies":{}}');
    const binary = path.join(home, 'bin');
    fs.writeFileSync(binary, 'fake', {mode: 0o700});
    const registryFile = path.join(home, '.config/magpie/plugins.json');
    let fail = false;
    const calls = [];
    const cli = createInstaller({
      home,
      project: source,
      node: binary,
      platform: 'darwin',
      env: {},
      run: (bin, args) => {
        calls.push(args);
        if (args[0] === 'plugin' && ['add', 'on', 'off'].includes(args[1])) {
          const registry = fs.existsSync(registryFile)
            ? JSON.parse(fs.readFileSync(registryFile))
            : {plugins: []};
          let entry = registry.plugins.find((x) => x.spec === args[2]);
          if (args[1] === 'add' && !entry) {
            entry = {spec: args[2]};
            registry.plugins.push(entry);
          }
          if (!entry) throw Error('missing source');
          if (args[1] !== 'add') entry.off = args[1] === 'off';
          fs.writeFileSync(registryFile, JSON.stringify(registry));
        }
        return {status: 0};
      },
      fetch: async (url) => ({
        ok: true,
        json: async () => (url.endsWith('hello') ? {name: 'magpie'} : {data: [{id: 'a'}]}),
      }),
      stopService: async () => {},
      waitHealthy: async () => {
        if (fail) {
          fail = false;
          throw Error('startup failed');
        }
      },
      log: () => {},
    });
    const options = {magpie: binary, science: binary, model: 'a'};
    const first = await cli.execute({...options, command: 'install'});
    const github = 'github:nickzhangcomes/claude-science-local-for-magpie';
    fs.writeFileSync(registryFile, JSON.stringify({plugins: [{spec: github}]}));
    fs.appendFileSync(path.join(source, 'src/runtime.js'), '//two');
    fail = true;
    calls.length = 0;
    await assert.rejects(cli.execute({...options, command: 'upgrade'}), /startup failed/);
    const registry = JSON.parse(fs.readFileSync(registryFile));
    assert.equal(registry.plugins.find((x) => x.spec === github).off, false);
    assert.equal(registry.plugins.filter((x) => !x.off).length, 1);
    assert.ok(!calls.some((args) => args[0] === 'plugin' && args[2] === first.pluginSpec));
    const second = await cli.execute({...options, command: 'upgrade'});
    const enabled = JSON.parse(fs.readFileSync(registryFile)).plugins.filter((x) => !x.off);
    assert.deepEqual(
      enabled.map((x) => x.spec),
      [github],
    );
    assert.equal(second.registrationSpec, github);
    assert.equal(second.sourceSpec, github);
    const rollback = await cli.execute({...options, command: 'rollback'});
    assert.equal(rollback.registrationSpec, first.pluginSpec);
    assert.equal(rollback.sourceSpec, github);
    const upgradedAgain = await cli.execute({...options, command: 'upgrade'});
    assert.equal(upgradedAgain.registrationSpec, github);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(registryFile))
        .plugins.filter((x) => !x.off)
        .map((x) => x.spec),
      [github],
    );
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('catalog upgrade selects magpie; rollback restores the legacy model selection', async () => {
  const {createInstaller} = await import('../src/cli.js');
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-catalog-upgrade-')));
  try {
    const source = path.join(home, 'source');
    fs.mkdirSync(path.join(source, 'src'), {recursive: true});
    fs.writeFileSync(path.join(source, 'src/runtime.js'), '//fixture');
    const pkg = path.join(source, 'package.json');
    fs.writeFileSync(pkg, '{"dependencies":{}}');
    const binary = path.join(home, 'bin');
    fs.writeFileSync(binary, 'fake', {mode: 0o700});
    const calls = [];
    const cli = createInstaller({
      home,
      project: source,
      node: binary,
      platform: 'darwin',
      env: {},
      run: (_, args) => {
        calls.push(args);
        return {status: 0};
      },
      fetch: async (url) => ({
        ok: true,
        json: async () =>
          url.endsWith('hello') ? {name: 'magpie'} : {data: [{id: 'fake/one'}, {id: 'fake/two'}]},
      }),
      stopService: async () => {},
      waitHealthy: async () => {},
      log: () => {},
    });
    const opts = {magpie: binary, science: binary};
    const first = await cli.execute({...opts, command: 'install', model: 'fake/one'});
    fs.writeFileSync(first.agentConfig, JSON.stringify({model: 'fake/two'}));
    fs.writeFileSync(pkg, '{"dependencies":{},"scienceLocal":{"modelCatalog":true}}');
    const upgraded = await cli.execute({...opts, command: 'upgrade'});
    assert.equal(upgraded.model, 'fake/two');
    assert.deepEqual(calls.filter((a) => a[0] === 'science-local').at(-1), [
      'science-local',
      'magpie',
    ]);
    assert.match(
      fs.readFileSync(upgraded.scienceConfig, 'utf8'),
      /default_model = "claude-science-local-/,
    );
    const rolled = await cli.execute({...opts, command: 'rollback'});
    assert.equal(rolled.deployment.id, first.deployment.id);
    assert.deepEqual(calls.filter((a) => a[0] === 'science-local').at(-1), [
      'science-local',
      'fake/two',
    ]);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
