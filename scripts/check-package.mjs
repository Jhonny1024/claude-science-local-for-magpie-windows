// Inspect and install the actual package locally. Never publishes or starts Science.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'science-package-')));
const run = (bin, args, cwd = root) => {
  if (bin === 'npm' && process.platform === 'win32') {
    if (!process.env.npm_execpath) throw Error('Run this check with npm run check:package');
    args = [process.env.npm_execpath, ...args];
    bin = process.execPath;
  }
  const r = spawnSync(bin, args, {
    windowsHide: true,
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: {...process.env, npm_config_update_notifier: 'false'},
  });
  assert.equal(r.status, 0, r.error?.message || r.stderr || `${bin} failed`);
  return r.stdout;
};
try {
  const info = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary]),
  )[0];
  const allowed = new Set([
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE.md',
    'COMPATIBILITY.md',
    'CHANGELOG.md',
    'science-local.cmd',
  ]);
  for (const file of info.files) {
    assert.ok(
      allowed.has(file.path) || /^src\/[a-z-]+\.js$/.test(file.path),
      `Unexpected packed file: ${file.path}`,
    );
    assert.ok(!fs.lstatSync(path.join(root, file.path)).isSymbolicLink(), `Symlink: ${file.path}`);
  }
  assert.ok(
    !info.files.some((f) => f.path.endsWith('middleware.js')),
    'Only the Agent should be shipped',
  );
  for (const file of [
    'src/agent.js',
    'src/agent-windows.js',
    'src/windows-service.js',
    'src/windows-launcher.js',
    'science-local.cmd',
    'src/cli.js',
    'src/runtime.js',
    'src/bridge.js',
    'src/models.js',
    'src/science-ui.js',
    'LICENSE',
    'NOTICE.md',
  ])
    assert.ok(
      info.files.some((f) => f.path === file),
      `Missing ${file}`,
    );
  const install = path.join(temporary, 'install');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'package.json'), '{"private":true}');
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, info.filename)],
    install,
  );
  const installed = path.join(install, 'node_modules', 'claude-science-local-for-magpie');
  const meta = JSON.parse(fs.readFileSync(path.join(installed, 'package.json')));
  assert.equal(meta.private, undefined);
  assert.equal(meta.magpie.middleware, undefined);
  assert.equal(meta.main, undefined);
  assert.equal(meta.magpie.agent, './src/agent.js');
  assert.deepEqual(meta.os, ['darwin', 'win32']);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare'])
    assert.equal(meta.scripts?.[hook], undefined, `No automatic install hook: ${hook}`);
  const agent = await import(pathToFileURL(path.join(installed, 'src/agent.js')));
  assert.equal(agent.agent.id, 'science-local');
  assert.equal(agent.agent.model, undefined);
  assert.equal(
    agent.connect({
      gateway: {url: 'http://127.0.0.1:3425', key: 'test'},
      models: [{id: 'fixture/one'}],
    }).models[0].id,
    'fixture/one',
  );
  assert.match(
    run(process.execPath, [path.join(installed, 'src/cli.js'), '--help'], install),
    /Usage:/,
  );
  // Verify copied production dependencies from the installed/hoisted npm layout.
  const {stageDeployment, verifyDeployment} = await import(
    pathToFileURL(path.join(installed, 'src/deployment.js'))
  );
  const deployed = stageDeployment({
    project: installed,
    root: path.join(temporary, 'runtime'),
    node: process.execPath,
  });
  assert.equal(verifyDeployment(deployed), true);
  console.log(
    JSON.stringify(
      {
        name: meta.name,
        version: meta.version,
        files: info.files.length,
        bytes: info.size,
        unpackedBytes: info.unpackedSize,
        installedCli: 'passed',
        agentContract: 'passed',
        dependencyDeployment: 'passed',
        sha512: info.integrity,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
